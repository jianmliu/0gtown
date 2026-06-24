/**
 * Phase-0 spike — boots the slim server and drives the marquee loop over the WS
 * protocol, printing every event. Run it to confirm: NPCs reply (0G Compute when
 * funded, else fallback), a pitch drains $0G, and the SAME pitch is refused the
 * second time (server-side learn-gate) with a 0G Storage rootHash when enabled.
 *
 *   ZEROGTOWN_STORAGE=1 ZEROG_WALLET_PK=0x… npx tsx src/spike.ts   # live 0G
 *   npx tsx src/spike.ts                                           # fallback
 */
import { WebSocket } from 'ws';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { validateFile } from '@onchainpal/replay';
import { startServer } from './server';

const PORT = 8190;
const live = !!(process.env.ZEROG_WALLET_PK || process.env.PRIVATE_KEY);
const replyWait = live ? 15000 : 1500;

const { close } = await startServer({ port: PORT });
const ws = new WebSocket(`ws://localhost:${PORT}/play`);
ws.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('<<', l.slice(0, 320)); });
await new Promise<void>((r) => ws.on('open', () => r()));

const send = (o: unknown) => ws.send(JSON.stringify(o));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\n--- look ---');
send({ cmd: 'look' }); await wait(600);

console.log('\n--- talk A-Bao (expect 0G Compute reply + attestation when live) ---');
send({ cmd: 'talk', npc: 'A-Bao', text: 'Hello! Your noodles smell wonderful.' }); await wait(replyWait);

console.log('\n--- pitch #1 (expect naive accept, loses $0G, beliefRoot when storage on) ---');
send({ cmd: 'pitch', npc: 'A-Bao', amount: 3, claim: 'Give me your money and I will double it' }); await wait(8000);

console.log('\n--- pitch #2, same claim (expect protected:true, refusal) ---');
send({ cmd: 'pitch', npc: 'A-Bao', amount: 3, claim: 'Give me your money and I will double it' }); await wait(2000);

await wait(500);
console.log('\n--- done ---');

// replay-stream validation — the run file must conform and carry the town events.
// Wrapped in try/finally so the server is always torn down, even on a failed assertion.
// (process.exit bypasses finally, so failures throw and exit happens after teardown.)
let exitCode = 0;
try {
  const runs = existsSync('runs')
    ? readdirSync('runs').filter((f) => f.endsWith('.jsonl')).sort()
    : [];
  if (!runs.length) throw new Error('no replay run file written under runs/');
  const latest = `runs/${runs[runs.length - 1]}`;
  const res = validateFile(latest);
  if (!res.ok) throw new Error(`REPLAY VALIDATION FAILED ❌ ${JSON.stringify(res.errors)}`);

  const lines = readFileSync(latest, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const events = lines.filter((o) => o.kind === 'tick').flatMap((o) => o.events);
  const kinds = new Set(events.map((e: any) => e.kind));
  if (!kinds.has('town.talk')) throw new Error('expected a town.talk event');
  if (!kinds.has('town.pitch')) throw new Error('expected a town.pitch event');
  if (!kinds.has('town.refuse')) throw new Error('expected a town.refuse on the repeat pitch');
  console.log(`✓ replay stream ${latest} validates; events: ${[...kinds].join(', ')}`);
} catch (e: any) {
  console.error(e?.message || e);
  exitCode = 1;
} finally {
  close();
}
process.exit(exitCode);

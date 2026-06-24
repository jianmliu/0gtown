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
close();
process.exit(0);

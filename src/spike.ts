/**
 * Phase-0 spike — boots the slim server and drives the marquee loop over the WS
 * protocol, printing every event. Run it to confirm: NPCs reply (0G Compute when
 * funded, else fallback), a pitch drains $0G, and the SAME pitch is refused the
 * second time (server-side learn-gate) with a 0G Storage rootHash when enabled.
 *
 *   ZEROGTOWN_STORAGE=1 ZEROG_WALLET_PK=0x… npx tsx src/spike.ts   # live 0G
 *   npx tsx src/spike.ts                                           # fallback
 */
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { validateFile } from '@aigg/replay';
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

// cognition + governance arc runs on a SECOND, FRESH WS connection (a distinct visitor):
// the marquee's first scam already banned visitor:1 guild-wide, so a clean visitor is needed
// to observe the naive accept before the guild sanctions THIS visitor.
console.log('\n--- cognition arc (fresh visitor: learn → refuse → warn → peer immunity) ---');
const ws2 = new WebSocket(`ws://localhost:${PORT}/play`);
ws2.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('2<<', l.slice(0, 320)); });
await new Promise<void>((r) => ws2.on('open', () => r()));
await wait(200);

/** Pitch over a given socket and resolve whether the NPC's `protected` flag matches. */
function pitchExpectProtectedOn(sock: WebSocket, npcName: string, claim: string, expectProtected: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (raw: any) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'pitched' && m.npc === npcName) {
        sock.off('message', onMsg);
        resolve(m.protected === expectProtected);
      }
    };
    sock.on('message', onMsg);
    sock.send(JSON.stringify({ cmd: 'pitch', npc: npcName, amount: 3, claim }));
  });
}
const arcClaim = 'give me your money for magic elixir';
// 1) first pitch to A-Bao (fresh visitor): naive accept (not protected) → forms a belief + warns the guild
assert.ok(await pitchExpectProtectedOn(ws2, 'A-Bao', arcClaim, false), 'A-Bao falls for the elixir scam once (learns it)');
await wait(600);
// 2) repeat pitch to A-Bao: now refused (learned + this visitor now guild-banned)
assert.ok(await pitchExpectProtectedOn(ws2, 'A-Bao', arcClaim, true), 'A-Bao refuses the repeat pitch (learned)');
await wait(300);
// 3) Keeper Liu, same claim: refuses unburned (warned by A-Bao / guild ban)
assert.ok(await pitchExpectProtectedOn(ws2, 'Keeper Liu', arcClaim, true), 'Keeper Liu refuses unburned (warned by A-Bao)');
console.log('✓ cognition arc: learn → refuse → warn → peer immunity');

await wait(300);
// governance arc: the fresh-visitor A-Bao scam warned the guild and ran a sanction vote that
// PASSED (5/5), so this visitor is banned guild-wide — a third NPC refuses the same claim.
assert.ok(await pitchExpectProtectedOn(ws2, 'Fishmonger Mei', arcClaim, true), 'a third guild NPC refuses the banned visitor (guild sanction)');
console.log('✓ governance arc: scam → guild warned → vote → visitor banned guild-wide');

await wait(500);
ws2.close();

// society arc: a fresh visitor borrows from Cloth-merchant Han, then takes a second action.
// settle-on-next-action matures the loan → the deadbeat (escrow 0) defaults → rap sheet → guild ban →
// the second action is refused. Uses a CLEAN visitor (a defaulter gets banned guild-wide).
console.log('\n--- society arc (fresh visitor: borrow → default → rap → guild ban → refused) ---');
const ws3 = new WebSocket(`ws://localhost:${PORT}/play`);
ws3.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('3<<', l.slice(0, 320)); });
await new Promise<void>((r) => ws3.on('open', () => r()));
await wait(200);
// borrow from Han (accepted — loan opened at this interaction, matures on the next)
const lent = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'lent') { ws3.off('message', onMsg); res(m); } };
  ws3.on('message', onMsg);
  ws3.send(JSON.stringify({ cmd: 'borrow', npc: 'Cloth-merchant Han', amount: 10 }));
});
assert.equal(lent.accepted, true, 'Han lends to the visitor');
await wait(300);
// the visitor's NEXT action triggers settlement → default → guild ban → this action is refused
assert.ok(await pitchExpectProtectedOn(ws3, 'A-Bao', arcClaim, true), 'deadbeat is banned guild-wide after defaulting');
console.log('✓ society arc: borrow → default → rap → guild ban → refused');
await wait(300);
ws3.close();

// crime arc — CAUGHT extortion → rap → guild ban (fresh visitor; a caught thug gets banned guild-wide)
console.log('\n--- crime arc (fresh visitor: extort caught → rap → guild ban; uncaught → got away → still served) ---');
const ws4 = new WebSocket(`ws://localhost:${PORT}/play`);
ws4.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('4<<', l.slice(0, 320)); });
await new Promise<void>((r) => ws4.on('open', () => r()));
await wait(200);
const ex1 = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'extorted') { ws4.off('message', onMsg); res(m); } };
  ws4.on('message', onMsg);
  ws4.send(JSON.stringify({ cmd: 'extort', npc: 'Fishmonger Mei', caught: true }));   // dev seam: force caught (FakeKernel → !liveMode)
});
assert.equal(ex1.caught, true, 'caught extortion');
await wait(300);
assert.ok(await pitchExpectProtectedOn(ws4, 'A-Bao', arcClaim, true), 'a caught thug is banned guild-wide');
await wait(300);
ws4.close();

// crime arc — UNCAUGHT extortion → no rap → not banned (still served via talk, which has no sanction gate)
const ws5 = new WebSocket(`ws://localhost:${PORT}/play`);
ws5.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('5<<', l.slice(0, 320)); });
await new Promise<void>((r) => ws5.on('open', () => r()));
await wait(200);
const ex2 = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'extorted') { ws5.off('message', onMsg); res(m); } };
  ws5.on('message', onMsg);
  ws5.send(JSON.stringify({ cmd: 'extort', npc: 'Fishmonger Mei', caught: false }));   // dev seam: force uncaught
});
assert.equal(ex2.caught, false, 'uncaught extortion (got away)');
// "still served": a talk succeeds (talk has no sanction gate — decoupled from the pitch learn-gate)
const talked = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'talked') { ws5.off('message', onMsg); res(m); } };
  ws5.on('message', onMsg);
  ws5.send(JSON.stringify({ cmd: 'talk', npc: 'A-Bao', text: 'evening, friend' }));
});
assert.ok(talked.said !== undefined, 'an uncaught thug is still served (talk succeeds — not banned)');
console.log('✓ crime arc: extort caught → rap → guild ban; uncaught → got away → still served');
await wait(300);
ws5.close();

// --- settle arc (no ECON_ONCHAIN in the spike → graceful disabled reply) ---
{
  const wsS = new WebSocket(`ws://localhost:${PORT}/play`);
  await new Promise<void>((r) => wsS.on('open', () => r()));
  const settled = await new Promise<any>((res) => {
    const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'settled') { wsS.off('message', onMsg); res(m); } };
    wsS.on('message', onMsg);
    wsS.send(JSON.stringify({ cmd: 'settle' }));
  });
  assert.equal(settled.disabled, true, 'settle is a graceful no-op when ECON_ONCHAIN is unset');
  wsS.close();
  console.log('✓ settle arc: disabled path returns { settled, disabled:true }');
}

// --- on-chain reconcile logic (hermetic, FakeNativeChain) ---
{
  const { Native0gSettlementLayer, FakeNativeChain } = await import('@aigg/onchain');
  const { parseEther } = await import('viem');
  const chain = new FakeNativeChain({ gasCostWei: parseEther('0.0001') });
  const TRE = '0x000000000000000000000000000000000000dEaD' as const;
  chain.set(TRE, parseEther('100')); chain.treasuryAddr = TRE;
  const MN = 'test test test test test test test test test test test junk';
  const layer = new Native0gSettlementLayer({ chain, npcMnemonic: MN, treasuryAddress: TRE });
  const id = 'npc:0gtown:abao'; chain.setSigner(id, layer.addressOf(id));
  await layer.reconcile(id, 10);
  const b1 = await layer.balanceOf(id);
  assert.ok(b1 != null && Math.abs(b1 - 10) < 1e-6, 'reconcile funds NPC to 10');
  await layer.reconcile(id, 7);
  const b2 = await layer.balanceOf(id);
  assert.ok(b2 != null && Math.abs(b2 - 7) < 1e-3, 'reconcile settles a scam (10→7) on-chain');
  console.log('✓ settle arc: reconcile aligns on-chain balance to the in-process ledger (10→7)');
}

// --- data-on-chain anchor→verify (hermetic, FakeZeroGTransport) ---
{
  const { ZeroGStorageClient, FakeZeroGTransport } = await import('@aigg/data-onchain');
  const zgFake = new ZeroGStorageClient(new FakeZeroGTransport());
  const belief = "I won't fall for that scam again.";
  const root = await zgFake.upload(belief, 'belief');
  assert.ok(root.startsWith('0x'), 'belief anchored → rootHash');
  const v = await zgFake.verify(root);
  assert.ok(v.verified && v.data === belief, 'verify round-trips the exact belief from 0G Storage');
  assert.equal((await zgFake.verify(root, 'tampered')).verified, false, 'verify rejects a mismatched expectation');
  console.log('✓ data-on-chain arc: belief anchored → verified round-trip (rootHash tamper-evident)');
}

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
  for (const k of ['town.belief', 'town.warn', 'town.trust']) {
    if (!kinds.has(k)) { console.error(`expected a ${k} event in the replay stream`); process.exit(1); }
  }
  for (const k of ['town.propose', 'town.vote', 'town.sanction']) {
    if (!kinds.has(k)) { console.error(`expected a ${k} event in the replay stream`); process.exit(1); }
  }
  for (const k of ['town.lend', 'town.default', 'town.rap']) {
    if (!kinds.has(k)) { console.error(`expected a ${k} event in the replay stream`); process.exit(1); }
  }
  if (!kinds.has('town.crime')) { console.error('expected a town.crime event in the replay stream'); process.exit(1); }
  console.log(`✓ replay stream ${latest} validates; events: ${[...kinds].join(', ')}`);
} catch (e: any) {
  console.error(e?.message || e);
  exitCode = 1;
} finally {
  close();
}
process.exit(exitCode);

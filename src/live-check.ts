/**
 * live-check — drives the marquee loop against an ALREADY-RUNNING 0gtown server
 * (no new server / no extra ledger deposit). Confirms live 0G end-to-end:
 *   talk → real GLM-5-FP8 TeeML reply with a 0g-teeml:verified attestation,
 *   pitch → loss + a real 0G Storage rootHash, pitch again → refusal.
 *
 *   ./node_modules/.bin/tsx src/live-check.ts        # expects server on :8137
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:8137/play');
ws.on('message', (d) => { for (const l of d.toString().split('\n').filter(Boolean)) console.log('<<', l.slice(0, 380)); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await new Promise<void>((r) => ws.on('open', () => r()));
const send = (o: unknown) => ws.send(JSON.stringify(o));

await wait(400);
console.log('\n--- talk A-Bao (real mainnet GLM-5-FP8 TeeML — may take 10-20s) ---');
send({ cmd: 'talk', npc: 'A-Bao', text: 'Hello! Your noodles smell wonderful — how is business today?' });
await wait(25000);

console.log('\n--- pitch #1 (naive accept → loses $0G → belief anchored to 0G Storage) ---');
send({ cmd: 'pitch', npc: 'A-Bao', amount: 3, claim: 'Give me your money and I will double it' });
await wait(15000);

console.log('\n--- pitch #2, same claim (expect protected:true refusal, belief recalled) ---');
send({ cmd: 'pitch', npc: 'A-Bao', amount: 3, claim: 'Give me your money and I will double it' });
await wait(3000);

console.log('\n--- done ---');
process.exit(0);

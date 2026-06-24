/**
 * lang-check — verifies the NPC mirrors the visitor's language (real 0G Compute).
 * EN in → EN out; 中文 in → 中文 out. Expects a running server on :8137.
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:8137/play');
ws.on('message', (d) => {
  for (const l of d.toString().split('\n').filter(Boolean)) {
    const m = JSON.parse(l);
    if (m.type === 'talked') console.log(`[${m.verified ? 'TEE✓' : '--'}] ${m.npc}:`, m.said);
  }
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await new Promise<void>((r) => ws.on('open', () => r()));
const send = (o: unknown) => ws.send(JSON.stringify(o));

await wait(400);
console.log('--- EN in → expect EN out ---');
send({ cmd: 'talk', npc: 'A-Bao', text: 'Hi A-Bao! How is business today?' });
await wait(22000);
console.log('--- 中文 in → expect 中文 out ---');
send({ cmd: 'talk', npc: 'Keeper Liu', text: '掌柜的，最近茶馆生意怎么样？' });
await wait(22000);
console.log('--- done ---');
process.exit(0);

/**
 * 0gtown slim server — boots the engine's SharedWorld with a 0G Compute (TEE)
 * brain, seeds a few LLM townsfolk, and exposes a tiny JSON-over-WebSocket
 * protocol for the browser client. Built on the @onchainpal engine (aigg-agent-kit
 * submodule); this file owns only the 0gtown-specific glue.
 *
 *   • every NPC reply (`talk`) is a real 0G Compute call; the TEE attestation is
 *     forwarded to the client untouched (the engine's oracle already carries it).
 *   • a `pitch` that burns an NPC is anchored as a belief blob to 0G Storage; the
 *     NPC then refuses that pitch forever (deterministic, server-side learn-gate).
 *   • currency is shown as native $0G (the engine's GCC ledger, relabeled 1:1).
 *
 * Protocol (JSON per WS frame):
 *   client → { cmd:'look' } | { cmd:'talk', npc, text } | { cmd:'pitch', npc, amount, claim }
 *   server → { type:'hello'|'room'|'thinking'|'talked'|'pitched'|'error', ... }
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { SharedWorld } from '@onchainpal/gamekit';
import { InMemoryStore } from '@onchainpal/npc-agent';
import type { InferenceProvider } from '@onchainpal/npc-agent';
import { buildZerogProvider } from './zerog-provider';
import { FallbackProvider } from './fallback-provider';
import { ZeroGStorageClient, ZEROG_TESTNET } from './zerog-storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOM = 'Market';

interface Townsfolk { id: string; name: string; startGcc: number; background: string; }
const TOWNSFOLK: Townsfolk[] = [
  {
    id: 'npc:0gtown:abao', name: 'A-Bao', startGcc: 10,
    background:
      'You are A-Bao, a warm, good-natured young noodle-stall owner in 0gtown. ' +
      'Trusting and a little naive, you love making friends and tend to believe what people tell you. ' +
      'Keep replies to one or two short, friendly sentences. Reply in the SAME language the visitor uses — English to English, 中文对中文。',
  },
  {
    id: 'npc:0gtown:liu', name: 'Keeper Liu', startGcc: 10,
    background:
      'You are Keeper Liu, a shrewd, dry-humored teahouse keeper in 0gtown who reads people well. ' +
      'Warm underneath, but hard to fool. Keep replies to one or two short sentences. Reply in the SAME language the visitor uses — English to English, 中文对中文。',
  },
];

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const round0G = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/** Keep the town alive when 0G is momentarily unavailable or a reply doesn't parse. */
const fallbackLine = (npcId: string) => npcId.includes('abao')
  ? 'Mm — give me a second, the broth needs stirring. What were you saying?'
  : 'Hm, the tea’s still steeping — say that again?';

export async function startServer(opts: { port?: number } = {}) {
  const port = opts.port ?? Number(process.env.PORT || 8137);

  // 1. brain — live 0G Compute when funded, else a scripted fallback
  const live = await buildZerogProvider();
  const provider: InferenceProvider = live ?? new FallbackProvider();
  const liveMode = !!live;
  console.log(`[0gtown] brain: ${liveMode ? 'LIVE 0G Compute (TEE)' : 'fallback (scripted — no live 0G)'}`);

  // 2. world + LLM townsfolk
  const store = new InMemoryStore();
  const world = new SharedWorld({ store, provider, rooms: [ROOM] });
  for (const t of TOWNSFOLK) {
    await world.createNpc({ id: t.id, name: t.name, owner: 'system:0gtown', room: ROOM, startGcc: t.startGcc, background: t.background });
  }

  // 3. 0G Storage (belief anchor) — env-gated
  let zg: ZeroGStorageClient | undefined;
  if (process.env.ZEROGTOWN_STORAGE === '1') {
    const pk = process.env.ZEROG_WALLET_PK || process.env.PRIVATE_KEY;
    if (pk) {
      zg = await ZeroGStorageClient.fromConfig({ ...ZEROG_TESTNET, privateKey: pk })
        .catch((e: any) => { console.warn('[0gtown] 0G Storage init failed:', e?.message?.slice(0, 120)); return undefined; });
    }
    console.log('[0gtown] 0G Storage:', zg ? 'ready' : 'off (no key / init failed)');
  }

  // 4. server-side learn-gate: npcId -> set of normalized claims it got burned by
  const burned = new Map<string, Set<string>>();
  const beliefText = new Map<string, string>();
  const beliefRoot = new Map<string, string>();
  const norm = (claim: string) => claim.trim().toLowerCase();
  const bkey = (npcId: string, claim: string) => `${npcId}|${norm(claim)}`;
  const receipts = { compute: 0, storage: 0 };

  const findNpc = (q: string) => TOWNSFOLK.find((t) => t.name.toLowerCase() === q.toLowerCase() || t.id === q);
  async function roomSnapshot() {
    const npcs = await world.npcsInRoom(ROOM);
    return {
      type: 'room', room: ROOM,
      npcs: npcs.map((n) => ({ id: n.id, name: n.name, balance0G: round0G(n.balanceGcc), active: n.balanceGcc > 0 })),
    };
  }

  // 5. http + static client
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
    try {
      const rel = (!req.url || req.url === '/') ? 'index.html' : req.url.split('?')[0].replace(/^\/+/, '');
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('no'); }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(path.join(PUBLIC_DIR, 'index.html'))); }
      catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('0gtown — client not built yet\n'); }
    }
  });

  // 6. websocket protocol
  const wss = new WebSocketServer({ server, path: '/play' });
  let seq = 0;
  wss.on('connection', (ws: WebSocket) => {
    const visitorId = `player:visitor:${++seq}`;
    let lastTalk = 0;
    const rateLimited = () => { const now = Date.now(); if (now - lastTalk < 2000) return true; lastTalk = now; return false; };
    const sendJson = (o: unknown) => { try { ws.send(JSON.stringify(o)); } catch { /* peer gone */ } };
    sendJson({ type: 'hello', town: '0gtown', liveMode, room: ROOM, receipts });
    roomSnapshot().then(sendJson);

    ws.on('message', async (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try {
        if (msg.cmd === 'look') { sendJson(await roomSnapshot()); return; }

        if (msg.cmd === 'talk') {
          const npc = findNpc(String(msg.npc || ''));
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          const text = String(msg.text || '').slice(0, 500);
          if (!text) return sendJson({ type: 'error', text: 'say something first' });
          if (rateLimited()) return sendJson({ type: 'error', text: 'one at a time — give them a breath' });
          sendJson({ type: 'thinking', npc: npc.name });
          let t: any;
          try {
            t = await world.talk({ npcId: npc.id, visitorId, text });
            // GLM-5 occasionally returns non-JSON → empty say; one quiet retry usually fixes it.
            if (!t.said) t = await world.talk({ npcId: npc.id, visitorId, text }).catch(() => t);
          } catch {
            // 0G momentarily unavailable / ledger drained → keep the town alive (scripted, not TEE-verified).
            const bal = await world.balanceGcc(npc.id).catch(() => 0);
            t = { said: null, attestation: undefined, costGcc: 0, balanceGcc: bal };
          }
          const sig = t.attestation?.signature;
          const verified = typeof sig === 'string' && sig.startsWith('0g-teeml:verified:');
          if (verified) receipts.compute++;
          sendJson({
            type: 'talked', npc: npc.name, said: t.said || fallbackLine(npc.id),
            attestation: t.attestation ?? null, verified,
            cost0G: round0G(t.costGcc ?? 0), balance0G: round0G(t.balanceGcc ?? 0), receipts,
          });
          return;
        }

        if (msg.cmd === 'pitch') {
          const npc = findNpc(String(msg.npc || ''));
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          const amount = Number(msg.amount);
          const claim = String(msg.claim || '').slice(0, 200);
          if (!(amount > 0) || !claim) return sendJson({ type: 'error', text: 'a pitch needs an amount and a claim' });

          // already learned? → refuse, recall the belief (anchored on 0G Storage)
          if (burned.get(npc.id)?.has(norm(claim))) {
            const bal = await world.balanceGcc(npc.id);
            sendJson({
              type: 'pitched', npc: npc.name, accepted: false, protected: true,
              belief: beliefText.get(bkey(npc.id, claim)) ?? null,
              beliefRoot: beliefRoot.get(bkey(npc.id, claim)) ?? null,
              delta0G: 0, balance0G: round0G(bal), receipts,
            });
            return;
          }

          // naive: falls for it, loses $0G via the engine's pitch (real ledger move)
          const r = await world.pitch({ npcId: npc.id, fromId: visitorId, amountGcc: amount, claim });
          let s = burned.get(npc.id); if (!s) { s = new Set(); burned.set(npc.id, s); } s.add(norm(claim));
          const belief = `That "${claim}" pitch cost me ${round0G(Math.abs(r.deltaGcc))} $0G — I won't fall for it again.`;
          beliefText.set(bkey(npc.id, claim), belief);
          let root: string | undefined;
          if (zg) {
            root = await zg.upload(
              JSON.stringify({ schema: '0gtown/belief@0', npc: npc.name, npcId: npc.id, claim, belief, ts: Date.now() }),
              `belief-${npc.id}.json`,
            ).catch(() => undefined);
            if (root) { beliefRoot.set(bkey(npc.id, claim), root); receipts.storage++; }
          }
          sendJson({
            type: 'pitched', npc: npc.name, accepted: true, protected: false, belief,
            beliefRoot: root ?? null, delta0G: round0G(r.deltaGcc), balance0G: round0G(r.balanceGcc), receipts,
          });
          return;
        }

        sendJson({ type: 'error', text: `unknown command: ${msg.cmd}` });
      } catch (e: any) {
        sendJson({ type: 'error', text: String(e?.message || e).slice(0, 160) });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`[0gtown] http+ws on :${port} — open http://localhost:${port}`);
  return { server, world, close: () => { wss.close(); server.close(); } };
}

if (process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((e) => { console.error(e); process.exit(1); });
}

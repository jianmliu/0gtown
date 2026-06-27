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
import { readFileSync as fsRead } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { SharedWorld } from '@aigg/gamekit';
import { createRecorder, viewerDir } from '@aigg/replay';
import { InMemoryStore } from '@aigg/npc-agent';
import type { InferenceProvider } from '@aigg/npc-agent';
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse, Polity, runSanctionVote, RapSheet, LoanBook, recordMisconduct, runRapSanction, misconductTopic, attemptCrime } from '@aigg/cognition';
import { buildZerogProvider } from './zerog-provider';
import { buildSettler } from './native-settler';
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
  {
    id: 'npc:0gtown:mei', name: 'Fishmonger Mei', startGcc: 10,
    background: 'A sharp-eyed fishmonger at the night market who has seen every trick. Wary of strangers, quick to spread word among the stalls.',
  },
  {
    id: 'npc:0gtown:guo', name: 'Fruit-seller Guo', startGcc: 10,
    background: 'A cheerful fruit-seller who trusts his neighbours and listens to the market guild. Easily alarmed by talk of swindlers.',
  },
  {
    id: 'npc:0gtown:han', name: 'Cloth-merchant Han', startGcc: 10,
    background: 'A measured cloth-merchant, respected in the guild, who weighs a claim before judging but stands with his fellow stallholders.',
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
  const settler = await buildSettler(); // null when ECON_ONCHAIN!=='1' or keys missing
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

  // 4. social cognition — memory-backed learn-gate + per-peer trust + warning diffusion.
  //    Live aigg-memory sidecar if MEMORY_URL set, else an in-process FakeKernel (deterministic).
  //    One shared TrustLedger is held here so the server can read back trust values for replay.
  const memKernel = process.env.MEMORY_URL
    ? new AiggMemoryKernel({ baseUrl: process.env.MEMORY_URL, token: process.env.MEMORY_TOKEN })
    : new FakeKernel();
  const trust = new TrustLedger();
  const cognition = new Cognition(memKernel, trust);
  const guildIds = TOWNSFOLK.map((t) => t.id);
  const polity = new Polity();
  const norm = (claim: string) => claim.trim().toLowerCase();
  const receipts = { compute: 0, storage: 0 };

  // 4b. society — server-side lending + public rap sheet (②c-1). Lending is bookkeeping ONLY:
  //     the world has no NPC→visitor $0G transfer, so the lender's world balance is NOT debited and a
  //     deadbeat's repayment escrow is 0 (no `repay` command yet). A global `nowSeq` (one tick per
  //     interaction) drives loan maturity: a loan opened on action N matures on the visitor's action N+1.
  const rapSheet = new RapSheet();
  const loanBook = new LoanBook();
  let nowSeq = 0;
  const lendBalanceOf = (_id: string) => 0;

  // replay recorder — emits a replay@1 town@0 stream alongside the live WS feed.
  const runId = `0gtown-${Date.now()}`;
  const replayEntities = TOWNSFOLK.map((t) => ({ id: t.id, name: t.name, kind: 'npc' as const }));
  const rec = createRecorder({ path: `runs/${runId}.jsonl`, packs: ['town@0'] });
  let replayT = 0; // 0gtown has no sim clock: one interaction = one tick
  rec.run({
    runId,
    title: '0gtown night market',
    entities: replayEntities,
    map: { rooms: [{ id: 'market', name: ROOM }] },
    meta: { liveMode, net: process.env.ZEROG_NET ?? 'testnet' },
  });

  const findNpc = (q: string) => TOWNSFOLK.find((t) => t.name.toLowerCase() === q.toLowerCase() || t.id === q);

  /** Settle every loan matured at the current `nowSeq`. For each default: record the misconduct
   *  (②a belief + rap entry), emit town.default/town.rap, run the rap-gated guild ban, and emit
   *  town.propose/vote/sanction. Best-effort — `rec`/`replayT` are the startup globals; a fresh tick
   *  carries the settlement events. Never throws (callers may be a closing socket). */
  async function settleDue(): Promise<void> {
    const settlements = loanBook.settle(nowSeq, lendBalanceOf);
    for (const s of settlements) {
      if (!s.defaulted) continue;
      try {
        await recordMisconduct(cognition, rapSheet, s.lender, s.borrower, 'default', nowSeq, `defaulted on a ${round0G(s.owed)} $0G loan from ${s.lender}`);
        rec.tick(++replayT);
        rec.event('town.default', { actor: s.lender, target: s.borrower, by: 'engine', data: { lender: s.lender, borrower: s.borrower, owed: round0G(s.owed), recovered: round0G(s.paid) } });
        rec.event('town.rap', { actor: s.borrower, by: 'engine', data: { offender: s.borrower, kind: 'default', victim: s.lender } });
        const round = await runRapSanction(rapSheet, polity, s.lender, s.borrower, guildIds, { until: Infinity });
        if (round) {
          rec.event('town.propose', { actor: s.lender, target: s.borrower, by: 'npc', data: { proposer: s.lender, target: s.borrower, topic: misconductTopic(s.borrower), pid: round.pid } });
          for (const [voter, choice] of Object.entries(round.votes)) {
            if (voter === s.lender) continue;
            rec.event('town.vote', { actor: voter, target: s.borrower, by: 'npc', data: { voter, choice, pid: round.pid } });
          }
          rec.event('town.sanction', { actor: s.lender, target: s.borrower, by: 'engine', data: { target: s.borrower, passed: round.result.passed, shareFor: round.result.shareFor } });
        }
        rec.flush();
      } catch (e: any) {
        console.warn('[0gtown] settlement/replay skipped:', e?.message);
      }
    }
  }

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

    // replay viewer + current run
    if (req.url === '/replay/latest.jsonl') {
      try {
        const body = fsRead(`runs/${runId}.jsonl`);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end(body);
      } catch {
        res.writeHead(404).end('no run yet');
      }
      return;
    }
    if (req.url === '/replay' || req.url === '/replay/') {
      res.writeHead(302, { location: '/replay/index.html?run=/replay/latest.jsonl' }).end();
      return;
    }
    if (req.url?.startsWith('/replay/')) {
      // decode percent-escapes (e.g. %2f) first so encoded traversal is caught by the boundary guard below.
      let name: string;
      try { name = decodeURIComponent(req.url.slice('/replay/'.length).split('?')[0]); }
      catch { res.writeHead(400).end('bad request'); return; }
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      const dir = viewerDir();
      const resolved = path.join(dir, name);
      if (!resolved.startsWith(dir + path.sep)) { res.writeHead(403).end('forbidden'); return; }
      try {
        const body = fsRead(resolved);
        res.writeHead(200, { 'content-type': types[path.extname(name)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
      return;
    }

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
    const rateLimited = (windowMs = 2000) => { const now = Date.now(); if (now - lastTalk < windowMs) return true; lastTalk = now; return false; };
    const sendJson = (o: unknown) => { try { ws.send(JSON.stringify(o)); } catch { /* peer gone */ } };
    sendJson({ type: 'hello', town: '0gtown', liveMode, room: ROOM, receipts });
    roomSnapshot().then(sendJson);

    ws.on('message', async (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try {
        // settle-on-next-action: advance the clock, then mature any due loan BEFORE this command runs —
        // a defaulting deadbeat lands the guild ban first, which the sanction-first checks then refuse.
        nowSeq++;
        await settleDue();

        if (msg.cmd === 'look') { sendJson(await roomSnapshot()); return; }

        if (msg.cmd === 'talk') {
          const npc = findNpc(String(msg.npc || ''));
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          const text = String(msg.text || '').slice(0, 500);
          if (!text) return sendJson({ type: 'error', text: 'say something first' });
          if (rateLimited()) return sendJson({ type: 'error', text: 'one at a time — give them a breath' });
          // Mirror the visitor's language: any CJK char → reply in 中文, otherwise English.
          // SharedWorld.talk defaults lang to 'zh' when unset, so we MUST pass it explicitly.
          const lang: 'zh' | 'en' = /[㐀-鿿]/.test(text) ? 'zh' : 'en';
          sendJson({ type: 'thinking', npc: npc.name });
          let t: any;
          try {
            t = await world.talk({ npcId: npc.id, visitorId, text, lang });
            // GLM-5 occasionally returns non-JSON → empty say; one quiet retry usually fixes it.
            if (!t.said) t = await world.talk({ npcId: npc.id, visitorId, text, lang }).catch(() => t);
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
          // best-effort replay recording — the live reply is already sent; never let this break the interaction
          try {
            rec.tick(++replayT);
            rec.event('town.talk', {
              actor: npc.id,
              target: visitorId,
              by: 'npc',
              data: {
                said: t.said || fallbackLine(npc.id),
                verified,
                attestation: t.attestation ?? null,
                costGcc: round0G(t.costGcc ?? 0),
                balanceGcc: round0G(t.balanceGcc ?? 0),
              },
            });
            rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
            rec.flush();
          } catch (e: any) {
            console.warn('[0gtown] replay write skipped:', e?.message);
          }
          return;
        }

        if (msg.cmd === 'pitch') {
          const npc = findNpc(String(msg.npc || ''));
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          const amount = Number(msg.amount);
          const claim = String(msg.claim || '').slice(0, 200);
          if (!(amount > 0) || !claim) return sendJson({ type: 'error', text: 'a pitch needs an amount and a claim' });

          const topic = norm(claim);

          // guild ban (sanction-first): a visitor the guild has sanctioned is refused outright
          if (polity.sanctioned(visitorId)) {
            const bal = await world.balanceGcc(npc.id);
            const belief = 'The night-market guild has barred you. No deal.';
            sendJson({
              type: 'pitched', npc: npc.name, accepted: false, protected: true,
              belief, beliefRoot: null,
              delta0G: 0, balance0G: round0G(bal), receipts,
            });
            try {
              rec.tick(++replayT);
              rec.event('town.refuse', {
                actor: npc.id,
                target: visitorId,
                by: 'npc',
                data: { protected: true, claim, belief, beliefRoot: null, bannedByGuild: true },
              });
              rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
              rec.flush();
            } catch (e: any) {
              console.warn('[0gtown] replay write skipped:', e?.message);
            }
            return;
          }

          const signal = await cognition.recall(npc.id, visitorId, topic);

          // already learned (a self/peer belief about this topic) or deep distrust → deterministic refusal
          if (shouldRefuse(signal).refuse) {
            const bal = await world.balanceGcc(npc.id);
            const belief = signal.beliefs.bundle || signal.summary || `I won't fall for "${claim}" again.`;
            sendJson({
              type: 'pitched', npc: npc.name, accepted: false, protected: true,
              belief, beliefRoot: null,
              delta0G: 0, balance0G: round0G(bal), receipts,
            });
            // best-effort replay recording — the live reply is already sent; never let this break the interaction
            try {
              rec.tick(++replayT);
              rec.event('town.refuse', {
                actor: npc.id,
                target: visitorId,
                by: 'npc',
                data: { protected: true, claim, belief, beliefRoot: null },
              });
              rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
              rec.flush();
            } catch (e: any) {
              console.warn('[0gtown] replay write skipped:', e?.message);
            }
            return;
          }

          // naive: falls for it, loses $0G via the engine's pitch (real ledger move)
          const r = await world.pitch({ npcId: npc.id, fromId: visitorId, amountGcc: amount, claim });
          const belief = `That "${claim}" pitch cost me ${round0G(Math.abs(r.deltaGcc))} $0G — I won't fall for it again.`;

          // LEARN: record the episode + form a direct belief + drop this visitor's trust
          await cognition.learn(npc.id, visitorId, { topic, description: belief, outcome: 'loss' });

          // keep the 0G Storage belief anchoring (library ⑤) — unchanged
          let root: string | undefined;
          if (zg) {
            root = await zg.upload(
              JSON.stringify({ schema: '0gtown/belief@0', npc: npc.name, npcId: npc.id, claim, belief, ts: Date.now() }),
              `belief-${npc.id}.json`,
            ).catch(() => undefined);
            if (root) receipts.storage++;
          }

          // social demo: warn the whole guild (best-effort), one town.warn per warned member
          const warnedMembers: string[] = [];
          for (const g of guildIds) {
            if (g === npc.id) continue;
            let ok = false;
            try { ok = await cognition.warn(npc.id, g, topic); } catch { /* best-effort */ }
            if (ok) warnedMembers.push(g);
          }

          sendJson({
            type: 'pitched', npc: npc.name, accepted: true, protected: false, belief,
            beliefRoot: root ?? null, delta0G: round0G(r.deltaGcc), balance0G: round0G(r.balanceGcc), receipts,
          });
          // best-effort replay recording — the live reply is already sent; never let this break the interaction
          try {
            rec.tick(++replayT);
            rec.event('town.pitch', {
              actor: npc.id,
              target: visitorId,
              by: 'visitor',
              data: { accepted: true, amount, claim, deltaGcc: round0G(r.deltaGcc), balanceGcc: round0G(r.balanceGcc) },
            });
            if (root) {
              rec.event('town.anchor', {
                actor: npc.id,
                by: 'npc',
                data: { claim, belief, beliefRoot: root },
              });
            }
            // cognition arc events — belief formed, visitor trust dropped, peer warned
            rec.event('town.belief', { actor: npc.id, by: 'npc', data: { topic, belief, source: 'self' } });
            const tv = await trust.get(npc.id, visitorId);   // value already updated by learn()
            rec.event('town.trust', { actor: npc.id, target: visitorId, by: 'npc', data: { peer: visitorId, delta: -0.3, value: tv } });
            for (const g of warnedMembers) {
              rec.event('town.warn', { actor: npc.id, target: g, by: 'npc', data: { from: npc.id, to: g, topic, accepted: true } });
            }
            rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
            rec.flush();
          } catch (e: any) {
            console.warn('[0gtown] replay write skipped:', e?.message);
          }

          // the guild votes whether to ban this visitor (belief-gated, synchronous)
          try {
            const round = await runSanctionVote(cognition, polity, npc.id, visitorId, topic, guildIds, { until: Infinity });
            if (round) {
              rec.tick(++replayT);
              rec.event('town.propose', { actor: npc.id, target: visitorId, by: 'npc', data: { proposer: npc.id, target: visitorId, topic, pid: round.pid } });
              for (const [voter, choice] of Object.entries(round.votes)) {
                if (voter === npc.id) continue;   // proposer's implicit 'for' isn't a cast vote
                rec.event('town.vote', { actor: voter, target: visitorId, by: 'npc', data: { voter, choice, pid: round.pid } });
              }
              rec.event('town.sanction', { actor: npc.id, target: visitorId, by: 'engine', data: { target: visitorId, passed: round.result.passed, shareFor: round.result.shareFor } });
            }
            rec.flush();
          } catch (e: any) {
            console.warn('[0gtown] replay write skipped:', e?.message);
          }
          return;
        }

        if (msg.cmd === 'borrow') {
          const npc = findNpc(String(msg.npc ?? ''));
          const amount = Number(msg.amount ?? 0);
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          if (!(amount > 0)) return sendJson({ type: 'error', text: 'a loan needs an amount' });
          // sanction-first: a banned deadbeat can't borrow either
          if (polity.sanctioned(visitorId)) {
            sendJson({ type: 'lent', npc: npc.name, accepted: false, protected: true, reason: 'The night-market guild has barred you. No credit.', receipts });
            return;
          }
          const loan = loanBook.lend(npc.id, visitorId, { principal: amount }, nowSeq);
          sendJson({ type: 'lent', npc: npc.name, accepted: true, amount: round0G(amount), due: loan.due, receipts });
          // best-effort replay recording — the live reply is already sent
          try {
            rec.tick(++replayT);
            rec.event('town.lend', { actor: npc.id, target: visitorId, by: 'npc', data: { lender: npc.id, borrower: visitorId, amount: round0G(amount), due: loan.due } });
            rec.flush();
          } catch (e: any) {
            console.warn('[0gtown] replay write skipped:', e?.message);
          }
          return;
        }

        if (msg.cmd === 'extort') {
          const npc = findNpc(String(msg.npc ?? ''));
          if (!npc) return sendJson({ type: 'error', text: `no one called "${msg.npc}" here` });
          // sanction-first: a barred thug can't extort either
          if (polity.sanctioned(visitorId)) {
            sendJson({ type: 'extorted', npc: npc.name, caught: false, protected: true, reason: 'The night-market guild has barred you.', receipts });
            return;
          }
          // dev-mode test seam: honor an explicit msg.caught ONLY when NOT in live (0G Compute) mode; else roll.
          // crime is narrative-only — no world $0G move (②c-1 finding).
          const crimeOpts = (!liveMode && typeof msg.caught === 'boolean') ? { force: msg.caught as boolean } : {};
          const { detected } = await attemptCrime(cognition, rapSheet, npc.id, visitorId, 'sabotage', nowSeq, crimeOpts);
          // best-effort replay recording — a fresh tick carries the crime events; never break the interaction
          try {
            rec.tick(++replayT);
            rec.event('town.crime', { actor: visitorId, target: npc.id, by: 'engine', data: { offender: visitorId, kind: 'sabotage', victim: npc.id, caught: detected } });
            if (detected) {
              rec.event('town.rap', { actor: visitorId, by: 'engine', data: { offender: visitorId, kind: 'sabotage', victim: npc.id } });
              const round = await runRapSanction(rapSheet, polity, npc.id, visitorId, guildIds, { until: Infinity });
              if (round) {
                rec.event('town.propose', { actor: npc.id, target: visitorId, by: 'npc', data: { proposer: npc.id, target: visitorId, topic: misconductTopic(visitorId), pid: round.pid } });
                for (const [voter, choice] of Object.entries(round.votes)) {
                  if (voter === npc.id) continue;
                  rec.event('town.vote', { actor: voter, target: visitorId, by: 'npc', data: { voter, choice, pid: round.pid } });
                }
                rec.event('town.sanction', { actor: npc.id, target: visitorId, by: 'engine', data: { target: visitorId, passed: round.result.passed, shareFor: round.result.shareFor } });
              }
            }
            rec.flush();
          } catch (e: any) {
            console.warn('[0gtown] replay write skipped:', e?.message);
          }
          if (detected) sendJson({ type: 'extorted', npc: npc.name, caught: true, banned: true, reason: 'You demanded protection, trashed the stall, and got caught — the night-market guild has barred you.', receipts });
          else sendJson({ type: 'extorted', npc: npc.name, caught: false, reason: 'You shook down the stall and slipped away — this time.', receipts });
          return;
        }

        if (msg.cmd === 'settle') {
          if (!settler) return sendJson({ type: 'settled', disabled: true, reason: 'on-chain settlement not configured' });
          if (rateLimited(8000)) return sendJson({ type: 'error', text: 'settling — give it a moment' });
          const net = (process.env.ZEROG_NET || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
          const explorerTx = (h: string) => `https://chainscan${net === 'mainnet' ? '' : '-galileo'}.0g.ai/tx/${h}`;
          const results: any[] = [];
          for (const t of TOWNSFOLK) {
            try {
              const target = await world.balanceGcc(t.id);
              const before = await settler.balanceOf(t.id);
              const tx = await settler.reconcile(t.id, target);
              const after = await settler.balanceOf(t.id);
              results.push({ npc: t.name, id: t.id, address: settler.addressOf(t.id), target, before, after, tx: tx ? { ...tx, url: explorerTx(tx.txHash) } : null });
              if (tx) {
                try {
                  rec.tick(++replayT);
                  rec.event('town.settle', { actor: t.id, by: 'npc', data: { units: tx.units, direction: tx.direction, txHash: tx.txHash, address: tx.address } });
                  rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
                  rec.flush();
                } catch (e: any) { console.warn('[0gtown] settle replay skipped:', e?.message); }
              }
            } catch (e: any) {
              results.push({ npc: t.name, id: t.id, error: e?.message?.slice(0, 120) ?? 'settle failed' });
            }
          }
          return sendJson({ type: 'settled', net, npcs: results });
        }

        sendJson({ type: 'error', text: `unknown command: ${msg.cmd}` });
      } catch (e: any) {
        sendJson({ type: 'error', text: String(e?.message || e).slice(0, 160) });
      }
    });

    // settle the disconnecting visitor's matured loans (the socket is gone — no ws.send, fully try/caught)
    ws.on('close', () => {
      nowSeq++;
      void settleDue().catch((e: any) => console.warn('[0gtown] close settle skipped:', e?.message));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`[0gtown] http+ws on :${port} — open http://localhost:${port}`);
  return { server, world, close: () => { wss.close(); server.close(); } };
}

if (process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((e) => { console.error(e); process.exit(1); });
}

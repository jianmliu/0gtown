# Phase 2 — A town that lives between visitors, file by file

> **Status: all three steps implemented** (`src/server.ts` + `public/index.html`). Metabolism is
> surfaced ($0G-vitality tiers + `starving`); `FairTick` runs autonomous NPC↔NPC scams/gossip
> behind `FAIRTICK=1`, client-gated, broadcasting street beats + live balances; and Step 3 gives
> the world its own namespaced memory (`MEMORY_URL`) so NPCs **wise up on their own** and warn
> peers. Verified: `pnpm typecheck`; a FairTick smoke (16 autonomous pitches, live balances, loop
> pauses when unwatched); a **live Step-3 integration test against a running `aigg-memory` sidecar**
> — 58 autonomous pitches, 55 refused after learning + gossip, and a fresh visitor's marquee scam
> still lands (not pre-empted); and `pnpm spike` green (both loop and Step-3 inert by default).

Goal: make 0gtown feel alive when no one is typing. Two engine capabilities, both
already in `@aigg/*`:

- **`FairTick`** (`@aigg/gamekit`) — NPCs scam, gossip, and (later) trade *each other* on
  a tick, deterministically (zero LLM in the loop). The market moves on its own.
- **`Metabolism`** (`@aigg/npc-agent`) — an NPC's $0G balance gates whether it can still
  think on 0G; drained NPCs go "drowsy" and stop calling the enclave. Makes $0G visibly
  *the fuel of cognition*.

## What's already true (verified in the engine)

- **Metabolism is already active.** `SharedWorld` applies `opts.metabolism ?? DEFAULT_METABOLISM`
  and `TalkResult` already carries `starving`, `tier`, `costGcc`, `balanceGcc`. 0gtown just
  **never forwards** `starving`/`tier` to the client. So this half is *surfacing*, like Phase 0.
- **`SharedWorld.memory` is unset** in 0gtown (`new SharedWorld({ store, provider, rooms })`).
  Consequence: `world.gossip()` returns `false` (no-op) and `world.pitch()` forms no
  engine-side belief — 0gtown's learn-gate lives entirely in its own server `Cognition`.
  So FairTick's *activity* (GCC movement + events) works today, but its *learning/warning
  arc* needs SharedWorld's memory wired (Step 3, builds on the Phase 1 sidecar).

---

## Step 1 — Surface Metabolism  ·  effort S · risk low

**`src/server.ts`** — forward the fields `world.talk()` already returns:

```ts
sendJson({
  type: 'talked', npc: npc.name, said: t.said || fallbackLine(npc.id),
  attestation: t.attestation ?? null, verified,
  cost0G: round0G(t.costGcc ?? 0), balance0G: round0G(t.balanceGcc ?? 0),
  tier: t.tier, starving: !!t.starving,        // NEW
  receipts,
});
```

Optionally replace `DEFAULT_METABOLISM` (its tiers name Claude models, irrelevant to 0gtown's
single 0G brain) with a $0G-vitality config, and pass it to `SharedWorld`:

```ts
import { Metabolism } from '@aigg/npc-agent';
const metabolism = new Metabolism({
  tiers: [
    { id: 'bright', minBalanceGcc: 3,   model: 'glm-5', label: 'bright' },
    { id: 'steady', minBalanceGcc: 0.5, model: 'glm-5', label: 'steady' },
    { id: 'drowsy', minBalanceGcc: 0.05, model: 'glm-5', label: 'drowsy' },
  ],
  starvingBelowGcc: 0.05,      // below this: too drained to think on 0G → scripted line, no enclave call
  defaultTierId: 'steady',
});
const world = new SharedWorld({ store, provider, rooms: [ROOM], metabolism });
```

The `model` field is cosmetic here (one 0G provider), but `tier.label` + `starving` are real
state tied to the $0G balance — a scammed-dry NPC stops thinking on 0G until refunded.

**`public/index.html`** — show it: a `tier` chip on the stall/whobar, and a "drowsy · low $0G"
/ "drained · dozing" state when `starving`. Reuse the existing `.mood` chip styling. A
starved NPC's `said` is already the scripted fallback line — label it as `local brain`, which
the client already renders for unverified replies.

## Step 2 — FairTick: autonomous street life  ·  effort M · risk med

**`src/server.ts`** — a broadcast helper + a client-gated tick loop.

```ts
import { FairTick, type FairActor } from '@aigg/gamekit';

// track live sockets for broadcast (add ws to a Set on connection, delete on close)
const clients = new Set<WebSocket>();
const broadcast = (o: unknown) => { const s = JSON.stringify(o); for (const c of clients) { try { c.send(s); } catch {} } };

// roles: two pitchers cycle scam claims, one gossip relays, the rest are marks. Single room → all co-located.
const fairActors: FairActor[] = [
  { npcId: 'npc:0gtown:mei', role: 'pitcher', claims: ['double your money in a day', 'a sure-thing rice futures tip'], amountGcc: 2, room: ROOM },
  { npcId: 'npc:0gtown:han', role: 'pitcher', claims: ['lucky charm, never lose again'], amountGcc: 2, room: ROOM },
  { npcId: 'npc:0gtown:liu', role: 'gossip', room: ROOM },
  { npcId: 'npc:0gtown:abao', role: 'townsfolk', room: ROOM },
  { npcId: 'npc:0gtown:guo', role: 'townsfolk', room: ROOM },
];
const fair = new FairTick(world, fairActors, { language: 'en' });

let fairTick = 0, fairTimer: NodeJS.Timeout | undefined;
async function runFair() {
  if (clients.size === 0) return;                 // nobody watching → don't churn the town
  try {
    const r = await fair.runTick(++fairTick, nowSeq);
    for (const p of r.pitches) {
      rec.tick(++replayT);
      rec.event('town.pitch', { actor: p.from, target: p.to, by: 'npc', data: { accepted: p.accepted, claim: p.claim, deltaGcc: round0G(p.deltaGcc) } });
      if (p.protected) rec.event('town.refuse', { actor: p.to, target: p.from, by: 'npc', data: { claim: p.claim, belief: p.belief ?? null } });
    }
    for (const g of r.gossips) rec.event('town.warn', { actor: g.from, target: g.to, by: 'npc', data: { about: g.about } });
    rec.flush();
    broadcast({ type: 'street', pitches: r.pitches, gossips: r.gossips });   // ambient beats
    broadcast(await roomSnapshot());                                          // balances shifted
  } catch (e: any) { console.warn('[0gtown] fair tick skipped:', e?.message); }
}
if (process.env.FAIRTICK === '1') fairTimer = setInterval(() => void runFair(), Number(process.env.FAIRTICK_MS || 8000));
// clear on close: clearInterval(fairTimer)
```

**`public/index.html`** — a `case 'street'` that renders ambient beats in the log ("A traveling
tout fleeced Fruit-seller Guo for 2 $0G", "Keeper Liu warned A-Bao about the charm trick") and
lets the `room` snapshot update stall balances live.

Notes:
- **Cheap & self-limiting.** `world.pitch`/`gossip` are deterministic, zero-LLM, zero-0G-cost.
  As marks learn a claim they refuse it (Step 3), pitchers cycle claims, and the town settles —
  emergent equilibrium, not runaway. The `clients.size` gate stops churn when nobody's watching.
- **No routes/market** needed (single room). Trader roles + `shocks`/`marketRoom` come with the
  Phase 3 AMM.
- If an agent action loop is ever added, pass `opts.skip` so an NPC isn't both passively pitched
  and actively choosing (the engine's cost-doubling guard).

## Step 3 — Full autonomous learning (IMPLEMENTED)  ·  effort M

Give `SharedWorld` its own **namespaced** memory so its learn-gate + `gossip()` persist beliefs.
The namespace (`fairtown`) keeps these engine beliefs apart from the server-side `Cognition`
corpus that handles visitors, and every belief is keyed to a **known counterpart** — so a fresh
visitor's unique id matches nothing, and the marquee scam still lands (verified live). Shipped as:

```ts
import { AiggMemoryClient } from '@aigg/npc-agent';
const worldMemory = process.env.MEMORY_URL
  ? new AiggMemoryClient({ baseUrl: process.env.MEMORY_URL, token: process.env.MEMORY_TOKEN })
  : undefined;
const world = new SharedWorld({
  store, provider, rooms: [ROOM], metabolism, memory: worldMemory,
  ...(reflectUrl ? { memoryModel: { aiggUrl: reflectUrl, model: process.env.MEMORY_REFLECT_MODEL, backend: process.env.MEMORY_REFLECT_BACKEND ?? 'http' } } : {}),
});
```

(Confirm `AiggMemoryClient`'s constructor shape + `SharedWorldOptions.memory` type at implement
time — it's a different adapter from the `AiggMemoryKernel` used by the server `Cognition`, over
the same aigg-memory HTTP service.) With this, FairTick pitches form engine beliefs, marks start
refusing, and `gossip()` diffuses warnings — the learn→refuse→warn arc runs with **no visitor**.
Without it, Step 2 still shows life (GCC drift + events), just no autonomous learning.

## Verification

- Keep the tick loop behind `FAIRTICK=1` and client-gated, so `pnpm spike` (no clients mid-run,
  flag off) is unaffected — run it to confirm no regression, plus `pnpm typecheck`.
- Add a **FairTick smoke**: create the 5 NPCs, run ~5 ticks, assert `pitches.length > 0` and that
  a mark's balance dropped; with Step 3 memory on, assert a repeat claim comes back `protected`.
- Manual: open two browser tabs, watch autonomous scams/gossip + live balance drift; then scam one
  NPC toward 0 and watch it flip to "drowsy/drained" and stop thinking on 0G.

## Risks

- **Draining the town.** Mitigated by the `clients.size` gate + the self-limiting learn-gate; if
  needed, add a slow `world.topup()` drip or a floor. Log any cap (no silent truncation).
- **Cost.** FairTick itself is zero-0G. Step 3's `gossip`/dream reflection calls 0G — throttle the
  interval and/or gate reflection frequency.
- **Effort:** Step 1 S, Step 2 M, Step 3 M (needs the Phase 1 sidecar).

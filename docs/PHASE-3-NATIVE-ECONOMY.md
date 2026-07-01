# Phase 3 — A native-$0G economy on 0G EVM, file by file

Goal: make the town's $0G real and on-chain — per-NPC balances settled in **native $0G on
0G EVM**, with seeded luck swings and an economy replay stream. Fulfills the README's
"0G Chain (later round)" promise.

## Binding decision (recap)

Native $0G on 0G EVM, moved by ordinary native-coin transfers. **No Base, no GCC, no
USDC, no x402/Permit2, no AMM** — a constant-product "spot price" needs a second asset,
and a pure-$0G world has none. Prediction markets (Step 4) are denominated directly in $0G.

## What's already wired (verified in the engine)

0gtown already ships the settlement backbone behind `ECON_ONCHAIN=1`:

- `src/native-settler.ts` builds `Native0gSettlementLayer` over `ViemNativeChain` (0G RPC),
  from `NPC_MNEMONIC` + treasury `ZEROG_WALLET_PK` (+ optional `ECON_WEI_PER_UNIT`).
- The `settle` command already calls `addressOf(id)`, `balanceOf(id)`, `reconcile(id, target)`
  per NPC and returns explorer links.
- **Gas is already auto-managed**: `deposit` tops an NPC EOA up to `gasReserveWei` when it's
  short, and `withdraw` makes the NPC pay its own gas out of the withdrawn amount (sub-gas
  diffs are honest no-ops). **So Phase 3 needs no separate gas funder** — the settler's
  deposit path is the gas funder. (`Native0gSettlementLayer` is SERVICE-SIDE ONLY — the
  mnemonic/treasury key never touch the browser.)

So Phase 3 is: make settlement *first-class* (Step 1), add *luck* (Step 2) and an *econ
replay stream* (Step 3), with prediction markets optional (Step 4).

## Step 1 — First-class native-$0G settlement  ·  effort M

Today `settle` is a manual button that reconciles once. Promote it:

- **Show identity + on-chain balance.** `settle` already returns `{ address, before, after, tx }`
  per NPC; surface each NPC's **0G EOA address + live on-chain $0G balance** in the UI
  persistently (stall/whobar), not just in a post-settle beat. A read-only `balanceOf` sweep
  can refresh them without a write.
- **Auto-reconcile** after balance-changing events (a scam, a luck swing) and/or on a slow
  cadence, instead of only on click:

```ts
async function reconcileAll(reason: string) {
  if (!settler) return;
  for (const t of TOWNSFOLK) {
    try {
      const target = await world.balanceGcc(t.id);
      const tx = await settler.reconcile(t.id, target);   // deposit/withdraw to align chain ↔ ledger
      if (tx) { rec.tick(++replayT); rec.event('town.settle', { actor: t.id, by: 'engine', data: { ...tx, reason } }); rec.flush(); }
    } catch (e: any) { console.warn('[0gtown] reconcile skipped:', e?.message); }
  }
  broadcast(await roomSnapshot());
}
```

  Reuse the existing 8s rate-guard; keep it behind `ECON_ONCHAIN=1` (off by default).
- Config already present: `ECON_ONCHAIN`, `NPC_MNEMONIC`, `ZEROG_WALLET_PK` (treasury),
  `ZEROG_NET`, `ECON_WEI_PER_UNIT`.

## Step 2 — Luck / black-swan events  ·  effort M

Seeded exogenous $0G swings, reproducible from `(seed, config)`:

```ts
import { mulberry32, rollLuck, type LuckConfig } from '@aigg/gamekit';
const luckRng = mulberry32(Number(process.env.LUCK_SEED || 20260701));
const luckCfg: LuckConfig = { mode: 'add', prob: 0.25, good: 1.5, bad: 1.0, goodBias: 0.5 };

async function rollTownLuck(now: number) {
  for (const t of TOWNSFOLK) {
    const ev = rollLuck(luckRng, t.id, luckCfg, now);       // → { gccDelta|gccFactor, label } | null
    if (!ev) continue;
    const delta = 'gccDelta' in ev ? ev.gccDelta : (await world.balanceGcc(t.id)) * ((ev.gccFactor ?? 1) - 1);
    // apply to the in-process ledger …see the debit note below…
    rec.tick(++replayT);
    rec.event(delta >= 0 ? 'econ.blackswan' : 'econ.bill', { actor: t.id, by: 'engine', data: { label: ev.label, delta: round0G(delta) } });
    rec.flush();
  }
  await reconcileAll('luck');   // Step 1 → the swing becomes real $0G on 0G EVM
  broadcast({ type: 'luck', /* … */ });
}
```

**Debit seam (the one real decision).** `SharedWorld` exposes `donate`/`fund` to *add* GCC
(gains → `world.donate('system:luck', id, +x)`), but **no public method to subtract**. Two
options for losses:
1. **Tiny engine seam** — add a `SharedWorld.adjust(npcId, delta)` (or expose a debit) in
   `aigg-agent-kit`; cleanest, but touches the engine.
2. **Route via the existing pitch rail** — `world.pitch({ npcId: id, fromId: 'system:fate',
   amountGcc: -delta, claim: 'a sudden bill', scam: true })` drains the balance. Caveat: `pitch`
   now runs the Step-3 memory gate (Phase 2), so use a **unique `fromId` per bill** so it's
   never "learned"/refused, and accept that it writes an episode. Works with no engine change.

Recommend Option 1 if an engine PR is acceptable; else Option 2. Gains need neither.

## Step 3 — Economy replay stream  ·  effort S

Add the econ pack so economy events validate:

```ts
const rec = createRecorder({ path: `runs/${runId}.jsonl`, packs: ['town@0', 'econ@0'] });
```

`econ@0` allows `econ.blackswan`, `econ.bill`, `econ.dividend`, `econ.bet`, `econ.trade`,
`econ.burn`, `econ.patron`, … Keep `town.*` for social/settlement, use `econ.*` for the money
layer. (Confirm `econ.settle` isn't needed — `town.settle` already exists and validates.)

## Step 4 — Prediction markets in $0G (optional)  ·  effort L

A parimutuel denominated in $0G: visitors stake $0G on a town outcome ("will A-Bao be scammed
this session?", "will Keeper Liu go drowsy?"), the pool pays winners on resolution.

- **Needs a visitor $0G balance** — visitors have none today. Introduce a small per-connection
  faucet/allowance (play-money $0G) or let a visitor bet against an NPC's stake. This is the
  design crux and why it's last.
- Resolve from town events (a `pitched`/`starving` transition); pay from the pool; record
  `econ.bet` + `econ.dividend`.
- **AMM stays dropped** — no second asset to price in a pure-$0G world.
- The engine's market STF (`openMarket`/`bet`/`resolveMarket` in `world-stf.ts`) is a separate
  deterministic state machine 0gtown doesn't use; a small in-process $0G pool is lighter than
  adopting the full `WorldState` STF. Choose at implement time.

## Verification

- **Hermetic** (no chain, no funds): `FakeNativeChain` — `spike.ts` already proves reconcile
  converges (10→7). Extend: apply a luck delta, `reconcile`, assert on-chain balance tracks the
  ledger; assert `mulberry32(seed)` is deterministic (same seed → same stream → same events).
- `pnpm typecheck` + `pnpm spike` green with everything behind `ECON_ONCHAIN` / a `LUCK` flag
  (off by default → no regression).
- **Live** (needs a funded 0G wallet + `NPC_MNEMONIC`, testnet first): real deposits/withdrawals
  — verify explorer txs and that on-chain balances track the in-process ledger after a scam + luck.

## Risks

- **Real funds.** Treasury PK + NPC mnemonic move real $0G — service-side only, low-balance,
  testnet-first. Never import the settler into the browser.
- **Gas.** Handled by the deposit reserve; sub-gas withdraws are honest no-ops (no silently
  stuck diffs).
- **Debit seam.** Negative luck needs the Option 1/2 decision above.
- **Determinism vs live.** LLM replies aren't reproducible, but the luck stream is — record
  `LUCK_SEED` in the run header so a run's economy is replayable.
- **Effort:** Step 1 M · Step 2 M · Step 3 S · Step 4 L (optional).

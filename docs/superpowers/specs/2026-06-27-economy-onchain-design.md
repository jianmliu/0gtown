# Design: ④ economy-on-chain — native $0G checkpoint settlement on 0G Chain

**Date:** 2026-06-27
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Kit home:** `kit/packages/onchain/src/native-0g-settlement.ts` (new), consumed by 0gtown's server
**Branch:** `economy-onchain` (stacks on `main` — ① replay + ② cognition already merged)

---

## 1. Background & motivation

0gtown's economy is **100% in-process** today: gamekit `SharedWorld` stores each NPC's balance at `npc:<id>:gcc` and a scam just lowers the number. The README's biggest "honest note" is *"Economy is in-process today … putting per-NPC $0G on 0G Chain is the next-round upgrade."* ④ closes that gap and activates the **third 0G pillar (0G Chain**, currently "later round") — NPCs hold **real native $0G** in real wallets, verifiable on the explorer.

This is the 4th `@aigg/*` kit extraction (after ① replay, ② cognition). `@aigg/onchain` already exists but is a **Base + GCC-ERC20 + x402-facilitator + ERC-6551** stack; none of that is deployed on 0G Chain. ④ proves the kit's **`SettlementLayer` value-leg seam generalizes** from Base/GCC to **any-EVM-chain native coin** (0G Chain the instance), by adding one new implementation.

### Agreed decisions (from brainstorming, 2026-06-27)

1. **Checkpoint / snapshot settlement**, not real-time per-tx. In-process ledger stays the live fast path; on-chain is reconciled to it.
2. **Native $0G** (not a deployed token) in **per-NPC derived EOAs** (`EoaAgentWallet`, BIP-44 from one master mnemonic). No contract deploy.
3. **On-demand trigger**: a `settle` WS command + a frontend "Settle to 0G Chain" button. No background gas drain on a public demo.
4. **Deliverable shape**: extend `@aigg/onchain` with a `Native0gSettlementLayer` conforming to the engine's existing `SettlementLayer` contract (`deposit`/`withdraw`/`balanceOf`/`anchor`).
5. **Treasury = the existing deployer wallet `0x30B10c22F2b136b3dCcFe8d5904A85FE45426b26`** (holds $0G + pays gas; ~98 OG funded). NPC EOAs derive from a separate `NPC_MNEMONIC`.
6. **`anchor(stateRoot)` = stub this round** (in-memory). Anchoring the ledger snapshot on-chain is left to ⑤ data-on-chain — clean responsibility split.

### Code-grounded facts (verified against the live tree; re-confirm in the audit)

- The seam exists: `kit/packages/gamekit/src/stf/settlement-layer.ts` →
  `interface SettlementLayer { deposit(npcId, n): Promise<void>; withdraw(npcId, n): Promise<{ok; reason?}>; balanceOf(npcId): Promise<number|null>; anchor(root): Promise<void>; }`, with `BaseSettlementLayer` as the reference impl (GCC/Base custody, on-chain bridge stubbed).
- `SharedWorld` accepts `settlementLayer?: SettlementLayer` but only calls `deposit` on the silver→GCC activation/exchange path (`shared-world.ts:1230`) and `balanceOf` at `:1293` — **NOT on `pitch`**. So the checkpoint model does **not** rely on SharedWorld driving settlement per-event; 0gtown drives `settle` explicitly.
- `EoaAgentWallet` (`onchain/src/agent-eoa.ts`) derives a per-NPC EOA from a master mnemonic (`deriveNpcAgentAccount`); its `balanceOf` is a `// TODO` stub returning `null` → we read balance via viem directly, not via `EoaAgentWallet.balanceOf`.
- `@aigg/onchain` deps = `@aigg/npc-agent` only (NOT gamekit). So `Native0gSettlementLayer` is **structurally** compatible with `SettlementLayer` (matching method shape) and does **not** import the gamekit type — avoiding an onchain→gamekit dependency. 0gtown (which depends on both) treats it as the value leg.
- 0G mainnet: chainId **16661**, rpc `https://evmrpc.0g.ai`, native coin **$0G** (18 decimals). `@aigg/onchain` already uses `viem`.
- The world has **no NPC→arbitrary-address transfer** (②c-1 finding) — value only moves NPC↔treasury, so a visitor triggering `settle` cannot extract funds.

### Audit refinements (code-grounded review, 2026-06-27)

A read of the live tree confirmed the design is buildable with no hard blockers. Pin these in the plan:

- **Use viem's predefined 0G chains.** viem `2.53.1` (installed; `onchain` declares `^2.51.3`) exports `zeroGMainnet` (id 16661, rpc `https://evmrpc.0g.ai`, native `0G`/18) and `zeroGTestnet` (id 16602) from `viem/chains`. Import those (select by `chainId`); only fall back to `defineChain` if a custom `rpcUrl` override is supplied.
- **`SettlementLayer` param is named `gcc: number`** (not `units`). `Native0gSettlementLayer` is structurally compatible regardless (TS ignores param names); the spec's "units" is just our label. Method shapes match exactly (`settlement-layer.ts:18-27`).
- **`world.balanceGcc(npcId)` returns `Promise<number>` (never null)** — it coalesces to `?? 0` (`shared-world.ts:1289-1300`). `targetUnits = await world.balanceGcc(id)` needs no null-guard. It can be **fractional** after pitches, so the `units → wei` conversion must be bigint-safe: `parseEther(String(round(units, 1e-9)))` — a raw `Number → BigInt` on a fractional product throws. Round `target` to the `dustUnits` grid first.
- **[gas reserve] `deposit` must over-fund a small gas buffer.** Gas for a `withdraw` is paid by the *NPC EOA itself*, and an EOA can't send 100% of its balance. So `deposit(npc, units)` sends `units×weiPerUnit + GAS_BUFFER`, and `withdraw` sends `min(unitsAsWei, balance − estimatedGas − reserve)` using `publicClient.estimateFeesPerGas()` × 21000. Without the buffer a freshly-funded NPC can't fully withdraw. Per-NPC try/catch turns any residual gas shortfall into a soft `{ok:false, reason:'insufficient-gas'}`.
- **Roster + read are in hand:** iterate `TOWNSFOLK` (`server.ts:37-63`, 5 NPCs) / `guildIds` (`:112`); `balanceGcc` with no `settlementLayer` is a pure in-memory `store.get` (immediate, no network). `rateLimited()` (`:235`) is per-connection — reuse it for `settle` with a longer window.
- **0gtown does NOT wire a `settlementLayer` into its `SharedWorld`** (`server.ts:88`) and won't — the settler is driven explicitly by the `settle` command, so there's no recursive/auto invocation; the in-process store stays the live truth.
- **Replay change = 4 files / 5 edit-spots:** `packs/town.ts` (the `eventKinds` array **and** an optional validator block — 2 spots), `viewer/viewer-core.js` `townLedger` reduce, `viewer/viewer.js` render branch, `__tests__/town-pack.smoke.ts` `eventKinds` deepEqual. The `viewer.js` `town.settle` branch is **mandatory** (the credit loop's fall-through `else` mislabels unknown kinds as "RAP"). Mirror `town.crime`/`town.lend`.
- **`NPC_MNEMONIC` is genuinely new** (only `ZEROG_WALLET_PK` exists today) → NPC EOAs start at 0 on-chain → first `settle` is a pure deposit, handled by `reconcile = diff(target − onchainBalance)`.
- **`@aigg/onchain` imports cleanly into the Node server** (`type:module`, pure-viem, no broken-ESM 0G SDK; 0gtown already lists it as a `workspace:*` dep but `server.ts` doesn't import it yet). Browser-safety warning N/A (server is Node).

### Non-goals (④)

- No GCC ERC-20 / token deploy, no x402 facilitator on 0G Chain, no ERC-6551 TBA NFTs (those are the Base stack; out of scope).
- No real-time per-event settlement (checkpoint only).
- No on-chain anchoring of the ledger snapshot (`anchor` stubbed; that's ⑤).
- No change to the in-process economy logic (pitch/borrow/extort stay server-side bookkeeping; ④ only *reflects* balances on-chain).
- Browser never holds key material (server-side only, like `ZEROG_WALLET_PK`).

---

## 2. The kit library — `@aigg/onchain` `Native0gSettlementLayer`

New file `kit/packages/onchain/src/native-0g-settlement.ts`, re-exported from the package barrel. Chain-agnostic (any EVM chain + native coin); 0G Chain is the configured instance.

```ts
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { deriveNpcAgentAccount } from './agent-eoa';
import { privateKeyToAccount } from 'viem/accounts';

export interface Native0gSettlementOptions {
  rpcUrl: string;                 // e.g. https://evmrpc.0g.ai
  chainId: number;                // e.g. 16661
  npcMnemonic: string;            // master — derives per-NPC EOAs (server-side only)
  treasuryPrivateKey: `0x${string}`; // holds native coin + pays gas
  /** native wei that one in-game balance unit (GCC) represents on-chain.
   *  Default 0.01 $0G/unit → 5 NPCs × ~10 units ≈ 0.5 $0G committed. Set to parseEther('1') for 1:1. */
  weiPerUnit?: bigint;
  /** below this (in units) a diff is treated as dust and skipped. Default 0.000001. */
  dustUnits?: number;
}

export interface SettleTx { npcId: string; direction: 'deposit' | 'withdraw'; units: number; txHash: `0x${string}` }

/** Conforms structurally to gamekit's SettlementLayer (deposit/withdraw/balanceOf/anchor). */
export class Native0gSettlementLayer {
  // addressOf(npcId): the per-NPC derived EOA address (deterministic, no deploy)
  addressOf(npcId: string): `0x${string}`;
  // balanceOf(npcId): on-chain native balance of the NPC EOA, in in-game units (wei / weiPerUnit)
  async balanceOf(npcId: string): Promise<number | null>;
  // deposit: treasury → NPC EOA, `units` worth of native coin. Returns when mined.
  async deposit(npcId: string, units: number): Promise<void>;
  // withdraw: NPC EOA → treasury, `units` worth. ok:false if the EOA can't cover it (incl. gas).
  async withdraw(npcId: string, units: number): Promise<{ ok: boolean; reason?: string }>;
  // anchor: stub this round (records in-memory; on-chain post is ⑤).
  async anchor(stateRoot: string): Promise<void>;
  // reconcileTx(npcId, targetUnits): convenience — diff vs balanceOf, deposit|withdraw, return the tx (or null if within dust)
  async reconcile(npcId: string, targetUnits: number): Promise<SettleTx | null>;
}
```

- `balanceOf` / `deposit` / `withdraw` / `anchor` match `SettlementLayer` exactly (units = the `number` the seam uses) → drop-in value leg.
- `reconcile(npcId, targetUnits)` is the checkpoint helper 0gtown calls per NPC.
- **Gas**: treasury funds the NPC EOA enough to cover its own `withdraw` gas, or `withdraw` leaves a gas reserve. The audit pins the exact gas-handling (a known native-coin edge: an EOA can't send 100% of its balance — must leave gas). Default: `withdraw` sends `min(units, balance − gasReserve)`; `deposit` covers any shortfall first.

---

## 3. 0gtown wiring — the `settle` command

- **`settle` WS command** (new): `{ cmd: 'settle' }` →
  1. rate-limit (reuse the per-visitor `rateLimited()` gate; settle is heavier, so a longer window) — prevents gas abuse.
  2. for each active NPC: `targetUnits = await world.balanceGcc(npc.id)`; `tx = await settler.reconcile(npc.id, targetUnits)`.
  3. collect `{ npcId, name, onchainBefore, target, onchainAfter, address, txHash? }`.
  4. emit replay `town.settle` per reconciled NPC (`{ actor: npc.id, data: { units, direction, txHash, address } }`), best-effort, fresh `rec.tick(++replayT)`.
  5. reply `{ type: 'settled', net: 'mainnet', explorer: '<base>/tx/<hash>', npcs: [...] }`.
- **Frontend** [public/index.html]: a "Settle to 0G Chain" button → sends `{cmd:'settle'}`; renders each NPC's on-chain address + balance + a clickable explorer tx link in the receipts panel. The live balances keep showing the in-process numbers; a "⛓ settled · block …" chip appears after.
- The settler is constructed once at boot (like `buildZerogProvider`): if `NPC_MNEMONIC` + treasury key are present → real settler; else a no-op/disabled settler so the town runs without on-chain (graceful, like the scripted-brain fallback). `settle` then replies `{ type:'settled', disabled:true }`.

### Env (server-side only)

| Var | Purpose |
|-----|---------|
| `NPC_MNEMONIC` | master mnemonic; derives per-NPC EOAs. Never reaches the browser. |
| `ZEROG_WALLET_PK` (reused) | the treasury / deployer wallet `0x30B1…6b26` — holds $0G + pays gas. |
| `ECON_WEI_PER_UNIT` | optional override of `weiPerUnit` (default 0.01 $0G/unit). |
| `ECON_ONCHAIN` | `1` to enable on-chain settle (else the `settle` command is a graceful no-op). |

---

## 4. Error handling & safety

- `settle` reconciles each NPC in its own try/catch — one NPC's tx failing (RPC hiccup, gas) never blocks the others; the reply lists per-NPC ok/failed.
- `balanceOf` RPC failure → that NPC is skipped (reported), not fatal.
- Best-effort throughout: 0G Chain unreachable → `settle` returns a soft error, the town keeps running (mirrors the 0G-Compute scripted fallback).
- **Safety**: funds only move NPC↔treasury (no NPC→arbitrary-address path exists). A visitor triggering `settle` only writes the *current honest in-process balances* on-chain — they cannot extract value. `settle` is rate-limited so it can't be spammed to burn treasury gas. Keys are server-side env only.
- Real $0G committed is bounded: `Σ targetUnits × weiPerUnit` (≈ 0.5 $0G at the default scale), all recoverable to the treasury via `withdraw`.

---

## 5. Testing

- **kit `native-0g-settlement.smoke`** (against a local/anvil-style EVM or a viem mock): `addressOf` deterministic; `deposit(npc, n)` then `balanceOf(npc) === n` (within dust); `withdraw` debits + conserves (treasury balance returns); `reconcile` picks the right direction; over-withdraw → `{ok:false}`; never sends 100%-of-balance (gas reserve respected).
- **0gtown spike — settle arc**: fresh visitor scams A-Bao (in-process 10→7) → `settle` → `town.settle` shows a `withdraw` of the dropped units → `settler.balanceOf('A-Bao')` now matches 7 (within dust) → reply carries an explorer tx link → replay stream validates with `town.settle`.
- Typecheck both packages; run the existing 22 cognition+replay smokes + the 0gtown spike to confirm no regression.

Before claiming done: run the spike with `ECON_ONCHAIN=1` against 0G mainnet (or testnet) and confirm a real on-chain reconciliation tx + that `balanceOf` matches the in-process balance.

---

## 6. Why this is the right seam

`SettlementLayer` was authored "interface-first so [a chain] stays the settlement anchor regardless of whether we ever build a bespoke domain." ④ proves that thesis: a wholly different settlement target (0G Chain native coin) drops into the **same four-method contract** with zero engine change — only a new implementation + a thin 0gtown `settle` command. It closes the README's largest honest-note, lights up the 0G Chain pillar, and extracts a reusable `@aigg/onchain` capability (native-coin checkpoint settlement on any EVM chain), satisfying the initiative's "reusable AND 0gtown consumes it" rule.

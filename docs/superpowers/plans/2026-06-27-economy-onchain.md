# ④ economy-on-chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 0gtown NPCs real native `$0G` balances on 0G Chain via an on-demand checkpoint `settle` that reconciles each NPC's in-process balance to its on-chain derived EOA, using a new reusable `@aigg/onchain` settlement layer.

**Architecture:** New `Native0gSettlementLayer` in `@aigg/onchain` conforms structurally to the engine's `SettlementLayer` seam (`deposit`/`withdraw`/`balanceOf`/`anchor`) but settles **native coin on any EVM chain** through an injectable `NativeChain` port (production = `ViemNativeChain` on `viem/chains`' `zeroGMainnet`; tests = `FakeNativeChain`). 0gtown constructs it at boot (`buildSettler`, mirroring `buildZerogProvider`) and a `settle` WS command reconciles all NPCs, emitting a new `town.settle` replay event. The in-process store stays the live truth; on-chain is reconciled only on demand.

**Tech Stack:** TypeScript (ESM), `viem` 2.53.1, `@aigg/onchain` (`EoaAgentWallet` derivation), `@aigg/replay` (`town@0` pack), `tsx` smoke tests with `node:assert/strict`, `ws`.

**Spec:** `docs/superpowers/specs/2026-06-27-economy-onchain-design.md`

**Conventions to match (from the audit):**
- `weiPerUnit` default `parseEther('0.01')` (1 in-game unit = 0.01 $0G on-chain).
- `GAS_RESERVE_WEI` default `parseEther('0.001')` — kept in each NPC EOA for its own withdraw gas and **excluded from the reported balance**, so reconcile is stable.
- `dustUnits` default `1e-6` — diffs below this are skipped.
- All `units → wei` math is bigint-safe (no `Number → BigInt` on a fractional product).
- Run kit smokes with `node --import tsx <file>` from the kit root; run 0gtown via `pnpm spike` / `pnpm typecheck`.

---

### Task 1: `Native0gSettlementLayer` core + `FakeNativeChain` + smoke

**Files:**
- Create: `kit/packages/onchain/src/native-0g-settlement.ts`
- Test: `kit/packages/onchain/src/__tests__/native-0g-settlement.smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `kit/packages/onchain/src/__tests__/native-0g-settlement.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import { Native0gSettlementLayer, FakeNativeChain } from '../native-0g-settlement';

// A fixed test mnemonic (NEVER a real key) + an arbitrary treasury address.
const MNEMONIC = 'test test test test test test test test test test test junk';
const TREASURY = '0x000000000000000000000000000000000000dEaD' as const;

async function main() {
  const chain = new FakeNativeChain({ gasCostWei: parseEther('0.0001') });
  // fund the treasury generously + tell the fake which address 'treasury' resolves to
  chain.set(TREASURY, parseEther('100'));
  chain.treasuryAddr = TREASURY;
  const layer = new Native0gSettlementLayer({
    chain, npcMnemonic: MNEMONIC, treasuryAddress: TREASURY,
    weiPerUnit: parseEther('0.01'), gasReserveWei: parseEther('0.001'), dustUnits: 1e-6,
  });

  const npc = 'npc:0gtown:abao';
  const addr = layer.addressOf(npc);
  chain.setSigner(npc, addr); // let the fake resolve npcId → its EOA address (for withdraw)
  assert.ok(addr.startsWith('0x') && addr.length === 42, 'addressOf is a 0x address');
  assert.equal(layer.addressOf(npc), layer.addressOf(npc), 'addressOf deterministic');

  // fresh NPC reads 0 units on-chain
  assert.equal(await layer.balanceOf(npc), 0, 'fresh NPC balanceOf 0');

  // reconcile a fresh NPC to 10 units → a deposit; balanceOf becomes ~10 (reserve excluded)
  const tx1 = await layer.reconcile(npc, 10);
  assert.ok(tx1 && tx1.direction === 'deposit', 'reconcile fresh → deposit');
  assert.ok(Math.abs((await layer.balanceOf(npc)) - 10) < 1e-6, 'balanceOf ~10 after deposit (reserve excluded)');

  // a small scam: target drops to 7 → a withdraw of ~3
  const tx2 = await layer.reconcile(npc, 7);
  assert.ok(tx2 && tx2.direction === 'withdraw', 'reconcile down → withdraw');
  assert.ok(Math.abs((await layer.balanceOf(npc)) - 7) < 1e-3, 'balanceOf ~7 after withdraw');

  // already aligned → no tx
  assert.equal(await layer.reconcile(npc, 7), null, 'aligned → no tx (within dust)');

  // over-withdraw guard: target below 0 is clamped; withdrawing more than held returns ok with capped send
  const tx3 = await layer.reconcile(npc, 0);
  assert.ok(tx3 === null || tx3.direction === 'withdraw', 'reconcile to 0 withdraws the rest');
  assert.ok((await layer.balanceOf(npc)) < 1e-3, 'balanceOf ~0 after settling to 0');

  // anchor is a no-op stub that resolves
  await layer.anchor('0xdeadbeef');

  console.log('NATIVE-0G SETTLEMENT SMOKE OK ✅');
}
main().catch((e) => { console.error('NATIVE-0G SETTLEMENT SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd kit && node --import tsx packages/onchain/src/__tests__/native-0g-settlement.smoke.ts`
Expected: FAIL — `Cannot find module '../native-0g-settlement'`.

- [ ] **Step 3: Implement `native-0g-settlement.ts`**

Create `kit/packages/onchain/src/native-0g-settlement.ts`:

```ts
/**
 * Native0gSettlementLayer — settles in-game NPC balances to REAL native coin
 * (e.g. $0G on 0G Chain) in per-NPC derived EOAs. Conforms structurally to the
 * engine's SettlementLayer seam (deposit/withdraw/balanceOf/anchor) but for the
 * native coin of any EVM chain, via an injectable NativeChain port.
 *
 * SERVICE-SIDE ONLY: holds the master mnemonic + (via the chain port) the
 * treasury signer. Never import into a browser bundle.
 */
import { parseEther } from 'viem';
import { deriveNpcAgentAccount } from './agent-eoa';

/** Injectable chain port — production = ViemNativeChain; tests = FakeNativeChain. */
export interface NativeChain {
  /** native balance of `address`, in wei. */
  getBalanceWei(address: `0x${string}`): Promise<bigint>;
  /** worst-case gas cost (wei) of one native transfer (21000 × maxFeePerGas). */
  estimateGasCostWei(): Promise<bigint>;
  /** send `valueWei` native coin. `from` is 'treasury' or an npcId (the port owns/derives the signer). Returns the tx hash. */
  sendNative(from: 'treasury' | string, to: `0x${string}`, valueWei: bigint): Promise<`0x${string}`>;
}

export interface Native0gSettlementOptions {
  chain: NativeChain;
  npcMnemonic: string;
  treasuryAddress: `0x${string}`;
  /** wei that one in-game balance unit represents. Default 0.01 $0G/unit. */
  weiPerUnit?: bigint;
  /** native wei kept in each NPC EOA for its own withdraw gas; excluded from reported balance. Default 0.001 $0G. */
  gasReserveWei?: bigint;
  /** diffs below this many units are skipped. Default 1e-6. */
  dustUnits?: number;
}

export interface SettleTx {
  npcId: string;
  address: `0x${string}`;
  direction: 'deposit' | 'withdraw';
  units: number;
  txHash: `0x${string}`;
}

const clampMin0 = (x: bigint) => (x > 0n ? x : 0n);

export class Native0gSettlementLayer {
  private readonly chain: NativeChain;
  private readonly mnemonic: string;
  private readonly treasury: `0x${string}`;
  private readonly weiPerUnit: bigint;
  private readonly gasReserveWei: bigint;
  private readonly dustUnits: number;

  constructor(opts: Native0gSettlementOptions) {
    this.chain = opts.chain;
    this.mnemonic = opts.npcMnemonic;
    this.treasury = opts.treasuryAddress;
    this.weiPerUnit = opts.weiPerUnit ?? parseEther('0.01');
    this.gasReserveWei = opts.gasReserveWei ?? parseEther('0.001');
    this.dustUnits = opts.dustUnits ?? 1e-6;
  }

  /** the deterministic on-chain address for an NPC (no deploy needed). */
  addressOf(npcId: string): `0x${string}` {
    return deriveNpcAgentAccount(this.mnemonic, npcId).address as `0x${string}`;
  }

  // ── bigint-safe unit <-> wei (units can be fractional; never Number→BigInt a fractional product) ──
  private unitsToWei(units: number): bigint {
    const u = Math.max(0, units);
    const scaled = BigInt(Math.round(u * 1e9));      // units × 1e9 (integer)
    return (scaled * this.weiPerUnit) / 1_000_000_000n;
  }
  private weiToUnits(wei: bigint): number {
    return Number((wei * 1_000_000_000n) / this.weiPerUnit) / 1e9;
  }

  /** reported balance EXCLUDES the gas reserve, so a freshly-funded NPC reconciles cleanly. */
  async balanceOf(npcId: string): Promise<number | null> {
    const raw = await this.chain.getBalanceWei(this.addressOf(npcId));
    return this.weiToUnits(clampMin0(raw - this.gasReserveWei));
  }

  // ── capturing primitives (return the tx hash) ──
  /** treasury → NPC; tops up the gas reserve if absent. Returns the tx hash (or null if nothing to send). */
  private async depositTx(npcId: string, units: number): Promise<`0x${string}` | null> {
    if (units <= 0) return null;
    const addr = this.addressOf(npcId);
    const raw = await this.chain.getBalanceWei(addr);
    let send = this.unitsToWei(units);
    if (raw < this.gasReserveWei) send += this.gasReserveWei - raw; // bring the reserve up to floor
    if (send <= 0n) return null;
    return this.chain.sendNative('treasury', addr, send);
  }
  /** NPC → treasury, always leaving gas. Returns the tx hash (or null if nothing sendable). */
  private async withdrawTx(npcId: string, units: number): Promise<`0x${string}` | null> {
    if (units <= 0) return null;
    const addr = this.addressOf(npcId);
    const raw = await this.chain.getBalanceWei(addr);
    const gas = await this.chain.estimateGasCostWei();
    const want = this.unitsToWei(units);
    const maxSendable = clampMin0(raw - gas);          // must leave gas for THIS tx
    const send = want < maxSendable ? want : maxSendable;
    if (send <= 0n) return null;
    return this.chain.sendNative(npcId, this.treasury, send);
  }

  // ── SettlementLayer-shaped wrappers (seam conformance) ──
  async deposit(npcId: string, units: number): Promise<void> { await this.depositTx(npcId, units); }
  async withdraw(npcId: string, units: number): Promise<{ ok: boolean; reason?: string }> {
    const tx = await this.withdrawTx(npcId, units);
    return tx ? { ok: true } : { ok: false, reason: 'insufficient-gas' };
  }
  /** stub this round — anchoring the ledger snapshot on-chain is ⑤ data-on-chain. */
  async anchor(_stateRoot: string): Promise<void> { /* no-op */ }

  /** checkpoint helper: align the NPC's on-chain balance to `targetUnits`; returns the tx (or null if within dust). */
  async reconcile(npcId: string, targetUnits: number): Promise<SettleTx | null> {
    const current = (await this.balanceOf(npcId)) ?? 0;
    const diff = targetUnits - current;
    if (Math.abs(diff) < this.dustUnits) return null;
    const addr = this.addressOf(npcId);
    if (diff > 0) {
      const txHash = await this.depositTx(npcId, diff);
      return txHash ? { npcId, address: addr, direction: 'deposit', units: diff, txHash } : null;
    }
    const txHash = await this.withdrawTx(npcId, -diff);
    return txHash ? { npcId, address: addr, direction: 'withdraw', units: -diff, txHash } : null;
  }
}

/** In-memory NativeChain for hermetic tests. Models gas as a fixed debit from the sender. */
export class FakeNativeChain implements NativeChain {
  private readonly bal = new Map<string, bigint>();
  private readonly gasCostWei: bigint;
  private readonly signers = new Map<string, `0x${string}`>(); // npcId → its EOA address
  private nonce = 0;
  /** the address 'treasury' resolves to; tests set this to their treasury address. */
  treasuryAddr: `0x${string}` = '0x0000000000000000000000000000000000000000';

  constructor(opts: { gasCostWei: bigint }) { this.gasCostWei = opts.gasCostWei; }
  set(addr: string, wei: bigint) { this.bal.set(addr.toLowerCase(), wei); }
  setSigner(npcId: string, address: `0x${string}`) { this.signers.set(npcId, address); }

  async getBalanceWei(address: `0x${string}`): Promise<bigint> { return this.bal.get(address.toLowerCase()) ?? 0n; }
  async estimateGasCostWei(): Promise<bigint> { return this.gasCostWei; }
  async sendNative(from: 'treasury' | string, to: `0x${string}`, valueWei: bigint): Promise<`0x${string}`> {
    const fromAddr = this.resolve(from);
    const fb = this.bal.get(fromAddr.toLowerCase()) ?? 0n;
    const total = valueWei + this.gasCostWei;                 // sender pays value + gas
    if (fb < total) throw new Error(`FakeNativeChain: insufficient ${fromAddr} has ${fb} needs ${total}`);
    this.bal.set(fromAddr.toLowerCase(), fb - total);
    this.bal.set(to.toLowerCase(), (this.bal.get(to.toLowerCase()) ?? 0n) + valueWei);
    this.nonce += 1;
    return (`0x${this.nonce.toString(16).padStart(64, '0')}`) as `0x${string}`;
  }
  private resolve(from: string): `0x${string}` {
    if (from === 'treasury') return this.treasuryAddr;
    const a = this.signers.get(from);
    if (!a) throw new Error(`FakeNativeChain: no signer for ${from}`);
    return a;
  }
}
```

- [ ] **Step 4: Run the smoke to verify it passes**

Run: `cd kit && node --import tsx packages/onchain/src/__tests__/native-0g-settlement.smoke.ts`
Expected: `NATIVE-0G SETTLEMENT SMOKE OK ✅`

- [ ] **Step 5: Typecheck the package**

Run: `cd kit && pnpm -C packages/onchain exec tsc --noEmit`
Expected: no errors (a pre-existing `baseUrl` deprecation NOTE is fine; exit 0).

- [ ] **Step 6: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/onchain/src/native-0g-settlement.ts packages/onchain/src/__tests__/native-0g-settlement.smoke.ts
git commit -m "feat(onchain): Native0gSettlementLayer — native-coin checkpoint settlement (SettlementLayer-shaped)"
```

---

### Task 2: `ViemNativeChain` production adapter + barrel export

**Files:**
- Create: `kit/packages/onchain/src/viem-native-chain.ts`
- Modify: `kit/packages/onchain/src/index.ts`
- Test: `kit/packages/onchain/src/__tests__/native-0g-settlement.smoke.ts` (extend with a construction-only check)

- [ ] **Step 1: Implement `ViemNativeChain`**

Create `kit/packages/onchain/src/viem-native-chain.ts`:

```ts
/**
 * ViemNativeChain — the production NativeChain port for Native0gSettlementLayer.
 * Reads native balances and sends native coin on an EVM chain (0G Chain by
 * default) via viem. Owns the treasury signer + derives per-NPC signers from the
 * master mnemonic. SERVICE-SIDE ONLY (holds keys).
 */
import {
  createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { zeroGMainnet, zeroGTestnet } from 'viem/chains';
import { npcAddressIndex } from './agent-eoa';
import type { NativeChain } from './native-0g-settlement';

export interface ViemNativeChainOptions {
  /** 'mainnet' (16661) | 'testnet' (16602). Default mainnet. */
  net?: 'mainnet' | 'testnet';
  /** override RPC url (else the viem chain default). */
  rpcUrl?: string;
  npcMnemonic: string;
  treasuryPrivateKey: `0x${string}`;
}

export class ViemNativeChain implements NativeChain {
  private readonly chain: Chain;
  private readonly pub: PublicClient;
  private readonly wallet: WalletClient;
  private readonly mnemonic: string;
  private readonly treasuryPk: `0x${string}`;

  constructor(opts: ViemNativeChainOptions) {
    this.chain = (opts.net === 'testnet' ? zeroGTestnet : zeroGMainnet) as Chain;
    const transport = http(opts.rpcUrl); // undefined → viem uses the chain's default rpc
    this.pub = createPublicClient({ chain: this.chain, transport });
    this.wallet = createWalletClient({ chain: this.chain, transport });
    this.mnemonic = opts.npcMnemonic;
    this.treasuryPk = opts.treasuryPrivateKey;
  }

  async getBalanceWei(address: `0x${string}`): Promise<bigint> {
    return this.pub.getBalance({ address });
  }

  async estimateGasCostWei(): Promise<bigint> {
    const fees = await this.pub.estimateFeesPerGas();
    const maxFee = fees.maxFeePerGas ?? fees.gasPrice ?? 1_000_000_000n;
    return 21_000n * maxFee;
  }

  async sendNative(from: 'treasury' | string, to: `0x${string}`, valueWei: bigint): Promise<`0x${string}`> {
    const account = from === 'treasury'
      ? privateKeyToAccount(this.treasuryPk)
      : mnemonicToAccount(this.mnemonic, { addressIndex: npcAddressIndex(from) });
    const hash = await this.wallet.sendTransaction({ account, to, value: valueWei, chain: this.chain });
    await this.pub.waitForTransactionReceipt({ hash });
    return hash;
  }
}
```

- [ ] **Step 2: Export from the barrel**

In `kit/packages/onchain/src/index.ts`, append after the existing exports:

```ts
// Native-coin checkpoint settlement (any EVM chain; 0G Chain default)
export { Native0gSettlementLayer, FakeNativeChain } from './native-0g-settlement';
export type { NativeChain, Native0gSettlementOptions, SettleTx } from './native-0g-settlement';
export { ViemNativeChain } from './viem-native-chain';
export type { ViemNativeChainOptions } from './viem-native-chain';
```

- [ ] **Step 3: Add a construction-only check to the smoke (no network)**

Append to `main()` in `native-0g-settlement.smoke.ts`, before the final `console.log`:

```ts
  // ViemNativeChain constructs against the predefined 0G chains without hitting the network.
  const { ViemNativeChain } = await import('../viem-native-chain');
  const vc = new ViemNativeChain({ net: 'mainnet', npcMnemonic: MNEMONIC, treasuryPrivateKey: ('0x' + '11'.repeat(32)) as `0x${string}` });
  const layer2 = new Native0gSettlementLayer({ chain: vc, npcMnemonic: MNEMONIC, treasuryAddress: TREASURY });
  assert.ok(layer2.addressOf(npc).startsWith('0x'), 'viem-backed layer derives an address');
```

- [ ] **Step 4: Run smoke + typecheck**

Run: `cd kit && node --import tsx packages/onchain/src/__tests__/native-0g-settlement.smoke.ts && pnpm -C packages/onchain exec tsc --noEmit`
Expected: smoke prints OK; tsc exit 0. If `zeroGMainnet`/`zeroGTestnet` are not found, run `pnpm -C packages/onchain ls viem` to confirm 2.53.1, then import from `viem/chains` is correct.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/onchain/src/viem-native-chain.ts packages/onchain/src/index.ts packages/onchain/src/__tests__/native-0g-settlement.smoke.ts
git commit -m "feat(onchain): ViemNativeChain (0G Chain) + barrel exports for native settlement"
```

---

### Task 3: replay `town.settle` event (4 files / 5 spots)

**Files:**
- Modify: `kit/packages/replay/src/packs/town.ts` (eventKinds + validator)
- Modify: `kit/packages/replay/viewer/viewer-core.js` (townLedger reduce)
- Modify: `kit/packages/replay/viewer/viewer.js` (render branch — MANDATORY, before the rap `else`)
- Modify: `kit/packages/replay/src/__tests__/town-pack.smoke.ts` (eventKinds deepEqual)

- [ ] **Step 1: Add `town.settle` to the failing smoke first**

In `kit/packages/replay/src/__tests__/town-pack.smoke.ts`, find the `deepEqual` of the `town@0` `eventKinds` array (audit: line ~19) and append `'town.settle'` as the LAST element of the expected array. Then add a validation case after the existing event assertions:

```ts
// town.settle validates with offender/amount fields
{
  const ev = { v: 1, t: 1, seq: 1, kind: 'town.settle', actor: 'npc:0gtown:abao',
    data: { units: 3, direction: 'withdraw', txHash: '0xabc', address: '0x1234567890123456789012345678901234567890' } };
  const errs = pack.validateEvent(ev as any);
  assert.deepEqual(errs, [], 'valid town.settle has no errors');
}
{
  const bad = { v: 1, t: 1, seq: 1, kind: 'town.settle', actor: 'npc:0gtown:abao', data: { direction: 'withdraw' } };
  assert.ok(pack.validateEvent(bad as any).length > 0, 'town.settle missing units/txHash errors');
}
```
(Match the exact local variable name the smoke uses for the town pack — it may be `townPack`/`pack`; mirror the existing `town.crime` assertions in the same file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd kit && node --import tsx packages/replay/src/__tests__/town-pack.smoke.ts`
Expected: FAIL — eventKinds deepEqual mismatch (or `town.settle` unknown).

- [ ] **Step 3: Add the eventKind + validator in `packs/town.ts`**

In `kit/packages/replay/src/packs/town.ts`: (a) append `'town.settle'` to the `eventKinds` array (audit: line ~8). (b) In `validateEvent`, after the `town.crime` block, add:

```ts
  if (ev.kind === 'town.settle') {
    const d: any = ev.data ?? {};
    if (typeof d.units !== 'number' || (d.direction !== 'deposit' && d.direction !== 'withdraw') || !d.txHash)
      errs.push('town.settle requires numeric data.units, data.direction deposit|withdraw, and data.txHash');
  }
```
(Use the exact `errs` accumulator name + push style the file already uses for `town.crime`.)

- [ ] **Step 4: Run the smoke to verify it passes**

Run: `cd kit && node --import tsx packages/replay/src/__tests__/town-pack.smoke.ts`
Expected: PASS.

- [ ] **Step 5: Add the viewer ledger reduce + render**

In `kit/packages/replay/viewer/viewer-core.js` `townLedger` reduce (audit: after the `town.crime` case ~line 78), add:

```js
      if (e.kind === 'town.settle') { credit.push({ kind: 'settle', actor: e.actor, units: e.data.units, direction: e.data.direction, txHash: e.data.txHash, address: e.data.address, t: e.t }); }
```
In `kit/packages/replay/viewer/viewer.js` credit loop (audit: ~lines 51-61), insert a branch BEFORE the final `else` (rap catch-all):

```js
      } else if (c.kind === 'settle') {
        line = `⛓ ${short(c.actor)} ${c.direction === 'deposit' ? 'funded' : 'settled'} ${c.units} $0G on-chain (${c.txHash.slice(0,10)}…)`;
```
(Match the surrounding `if/else if` chain + the `short()` helper the file already uses; if a render helper differs, mirror the `crime` branch exactly.)

- [ ] **Step 6: Run the replay viewer-core smoke + validate smoke**

Run: `cd kit && node --import tsx packages/replay/src/__tests__/viewer-core.smoke.ts && node --import tsx packages/replay/src/__tests__/validate.smoke.ts`
Expected: both PASS (no regression from the new kind).

- [ ] **Step 7: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/viewer/viewer-core.js packages/replay/viewer/viewer.js packages/replay/src/__tests__/town-pack.smoke.ts
git commit -m "feat(replay): town.settle event (on-chain checkpoint) in the town@0 pack + viewer"
```

---

### Task 4: bump 0gtown's kit submodule to include Tasks 1–3

**Files:**
- Modify: the `kit` submodule pointer in the 0gtown repo

- [ ] **Step 1: Push the kit branch + bump the pointer**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git push origin HEAD:refs/heads/economy-onchain   # or the agreed kit branch
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — Native0gSettlementLayer + town.settle"
```

- [ ] **Step 2: Reinstall so 0gtown links the new kit**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm install`
Expected: `@aigg/onchain` relinks; no errors.

- [ ] **Step 3: Verify 0gtown can import the new symbols**

Run: `node --input-type=module -e "import('@aigg/onchain').then(m => console.log(typeof m.Native0gSettlementLayer, typeof m.ViemNativeChain))"`
Expected: `function function`.

---

### Task 5: `buildSettler` boot helper

**Files:**
- Create: `src/native-settler.ts`

- [ ] **Step 1: Implement `buildSettler`**

Create `/Volumes/T7-Data/aigg-0gtown/src/native-settler.ts`:

```ts
/**
 * buildSettler — construct the on-chain settlement layer from env, mirroring
 * buildZerogProvider. Returns null when ECON_ONCHAIN!=='1' or the keys are
 * missing, so the `settle` command degrades to a graceful no-op (the town runs
 * fine without on-chain settlement).
 */
import { Native0gSettlementLayer, ViemNativeChain } from '@aigg/onchain';
import { privateKeyToAccount } from 'viem/accounts';
import { parseEther } from 'viem';

export async function buildSettler(): Promise<Native0gSettlementLayer | null> {
  if (process.env.ECON_ONCHAIN !== '1') return null;
  const npcMnemonic = process.env.NPC_MNEMONIC;
  const treasuryPk = (process.env.ZEROG_WALLET_PK || process.env.PRIVATE_KEY) as `0x${string}` | undefined;
  if (!npcMnemonic || !treasuryPk) {
    console.warn('[0gtown] ECON_ONCHAIN=1 but NPC_MNEMONIC / ZEROG_WALLET_PK missing → settle disabled');
    return null;
  }
  const net = (process.env.ZEROG_NET || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
  const treasuryAddress = privateKeyToAccount(treasuryPk).address;
  const chain = new ViemNativeChain({ net, rpcUrl: process.env.ZEROG_RPC, npcMnemonic, treasuryPrivateKey: treasuryPk });
  const weiPerUnit = process.env.ECON_WEI_PER_UNIT ? parseEther(process.env.ECON_WEI_PER_UNIT) : undefined;
  console.log('[0gtown] on-chain settlement ON · net', net, '· treasury', treasuryAddress);
  return new Native0gSettlementLayer({ chain, npcMnemonic, treasuryAddress, weiPerUnit });
}
```

(`buildSettler` is `async` because `server.ts` already `await`s it alongside `buildZerogProvider`.)

- [ ] **Step 2: Typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/native-settler.ts
git commit -m "feat: buildSettler boot helper (env → Native0gSettlementLayer or disabled)"
```

---

### Task 6: `settle` WS command in the server

**Files:**
- Modify: `src/server.ts` (import + construct settler at boot; add the `settle` handler)

- [ ] **Step 1: Import + construct the settler at boot**

In `src/server.ts`, add near the other imports:
```ts
import { buildSettler } from './native-settler';
```
After the `const live = await buildZerogProvider();` line (~server.ts:81), add:
```ts
  const settler = await buildSettler(); // null when ECON_ONCHAIN!=='1' or keys missing
```

- [ ] **Step 2: Add the `settle` command handler**

In the `ws.on('message')` switch, after the `extort` block and before the final `unknown command` line (~server.ts:499), add:

```ts
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
```

- [ ] **Step 3: Confirm `rateLimited` accepts a window arg**

Check `rateLimited()` (server.ts:235). If it takes no argument, change its definition to `const rateLimited = (windowMs = 2000) => { const now = nowSeq /* or Date.now */; ...; }` preserving current behavior for the `talk` call (which passes nothing → 2000ms). Mirror the existing implementation exactly; only parameterize the window. (If it already keys off `Date.now()`, keep that; do NOT introduce `Date.now()` into kit code — this is 0gtown server code where it's allowed.)

- [ ] **Step 4: Typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/server.ts
git commit -m "feat: settle WS command — reconcile NPC balances to 0G Chain, emit town.settle"
```

---

### Task 7: spike settle arc (hermetic — disabled settler path + reconcile unit proof)

**Files:**
- Modify: `src/spike.ts` (add a settle arc that proves the wiring without real on-chain)

- [ ] **Step 1: Add a disabled-path assertion to the spike**

In `src/spike.ts`, after the crime arc, add a block that confirms the `settle` command returns the graceful disabled shape when `ECON_ONCHAIN` is unset (the spike runs without on-chain):

```ts
// --- settle arc (no ECON_ONCHAIN in the spike → graceful disabled reply) ---
{
  const wsS = new WebSocket(`ws://127.0.0.1:${port}/play`);
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
```
(Match the spike's existing WebSocket/import style; reuse its `port`, `assert`, `WebSocket`.)

- [ ] **Step 2: Add a kit-level reconcile proof to the spike's imports (hermetic on-chain logic)**

At the END of `src/spike.ts`, add a pure-logic check using `FakeNativeChain` (proves reconcile aligns balances without a real chain):

```ts
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
  assert.ok(Math.abs((await layer.balanceOf(id)) - 10) < 1e-6, 'reconcile funds NPC to 10');
  await layer.reconcile(id, 7);
  assert.ok(Math.abs((await layer.balanceOf(id)) - 7) < 1e-3, 'reconcile settles a scam (10→7) on-chain');
  console.log('✓ settle arc: reconcile aligns on-chain balance to the in-process ledger (10→7)');
}
```

- [ ] **Step 3: Run the spike**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm spike`
Expected: all existing arcs pass + the two new `✓ settle arc:` lines.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/spike.ts
git commit -m "test: spike settle arc — disabled-path reply + hermetic reconcile proof"
```

---

### Task 8: frontend "Settle to 0G Chain" button

**Files:**
- Modify: `public/index.html` (button + receipts rendering of the `settled` reply)

- [ ] **Step 1: Add the button + handler**

In `public/index.html`, near the existing action buttons (e.g. the "Try a scam 🎣" button), add a button `<button id="settle-btn">Settle to 0G Chain ⛓</button>` and, in the WebSocket message handler, a case for the `settled` reply that renders each NPC's address + before/after + a clickable explorer link (or, when `disabled`, a small "on-chain settlement not configured" note). Mirror the existing button-wiring + `ws.send(JSON.stringify({cmd:'...'}))` pattern and the receipts-panel DOM the page already uses. Concretely:

```html
<button id="settle-btn" class="action">Settle to 0G Chain ⛓</button>
```
```js
document.getElementById('settle-btn').addEventListener('click', () => ws.send(JSON.stringify({ cmd: 'settle' })));
// in onmessage:
if (msg.type === 'settled') {
  if (msg.disabled) { appendReceipt('⛓ on-chain settlement not configured (set ECON_ONCHAIN=1)'); return; }
  for (const n of msg.npcs) {
    if (n.error) { appendReceipt(`⛓ ${n.npc}: ${n.error}`); continue; }
    const link = n.tx ? `<a href="${n.tx.url}" target="_blank">${n.tx.txHash.slice(0,10)}…</a>` : '(already aligned)';
    appendReceipt(`⛓ ${n.npc} → ${n.after} $0G on-chain ${link}`);
  }
}
```
(Use the page's actual receipt-append helper / DOM ids; if `appendReceipt` doesn't exist, mirror however the page renders the `pitched.beliefRoot` chip.)

- [ ] **Step 2: Manual smoke (optional, local)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm 0gtown` → open `http://localhost:8137` → the "Settle to 0G Chain ⛓" button appears and (without `ECON_ONCHAIN`) clicking it logs the "not configured" note. (No on-chain needed for this check.)

- [ ] **Step 3: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add public/index.html
git commit -m "feat(ui): Settle to 0G Chain button + on-chain balance receipts"
```

---

### Task 9: full verification + live settle (1 real on-chain reconcile)

**Files:** none (verification only)

- [ ] **Step 1: Run the whole kit + 0gtown test suite**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
for f in packages/cognition/src/__tests__/*.smoke.ts packages/replay/src/__tests__/*.smoke.ts packages/onchain/src/__tests__/native-0g-settlement.smoke.ts; do node --import tsx "$f" >/dev/null 2>&1 && echo "ok $(basename $f)" || echo "FAIL $(basename $f)"; done
cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck && pnpm spike 2>&1 | grep -E "✓|FAIL"
```
Expected: all `ok` / `✓`, no `FAIL`.

- [ ] **Step 2: One real on-chain settle (testnet first)**

With a funded test treasury + a throwaway `NPC_MNEMONIC`:
```bash
ECON_ONCHAIN=1 ZEROG_NET=testnet NPC_MNEMONIC="<throwaway 12 words>" ZEROG_WALLET_PK=0x… ECON_WEI_PER_UNIT=0.001 pnpm 0gtown
```
Connect, run a scam on A-Bao (in-process 10→7), click "Settle to 0G Chain", and confirm: the reply carries a real `tx.url`; opening it shows the transfer; a second `settle` reports `tx: null` (already aligned within dust); `settler.balanceOf('npc:0gtown:abao')` ≈ 7. Then repeat on `ZEROG_NET=mainnet` if desired.

- [ ] **Step 3: Final review dispatch**

Per subagent-driven-development, dispatch a final whole-implementation code review before finishing the branch.

---

## Notes for the implementer

- **Never commit a private key / mnemonic.** `NPC_MNEMONIC` + `ZEROG_WALLET_PK` are env-only; the spike + smokes use the public throwaway `test … junk` mnemonic.
- **bigint discipline:** all `units → wei` goes through `unitsToWei` (no `Number(bigint)` on large values; no `BigInt(float)`).
- **Two repos:** Tasks 1–3 commit inside `kit/`; Tasks 5–8 in 0gtown; Task 4 bumps the submodule pointer. Push the kit branch before bumping.
- **Graceful degradation is load-bearing:** with `ECON_ONCHAIN` unset the town and the spike must pass unchanged — `settle` just replies `{ disabled: true }`.

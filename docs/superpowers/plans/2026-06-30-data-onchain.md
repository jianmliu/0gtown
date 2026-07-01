# ⑤ data-on-chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 0gtown's vendored 0G Storage client into a reusable `@aigg/data-onchain` kit package (implementing the existing `AutoDriveClient` port), add a hermetic `FakeZeroGTransport` + a `verify(rootHash)` tamper-check, and have 0gtown consume it with a clickable verifiable rootHash chip.

**Architecture:** `@aigg/data-onchain` holds a `ZeroGStorageClient` (upload/download/verify) over an injectable `ZeroGTransport` byte-seam (`put`/`get`/`contentId`). Production = the lazy-loaded 0G Storage SDK (`fromConfig`); tests = `FakeZeroGTransport` (content-id = `keccak256`). `verify` recomputes the content-id from downloaded bytes and compares to the rootHash — it does NOT trust the SDK's `proof:true` (a no-op in 0g-storage-ts-sdk@1.2.10). 0gtown deletes its local copy, imports the kit version, and adds a `verify` WS command + clickable chip.

**Tech Stack:** TypeScript (ESM), `@aigg/npc-agent` (`AutoDriveClient` port), `@0gfoundation/0g-storage-ts-sdk@1.2.10` (lazy), `ethers@6.17.0` (`keccak256`, peer), `tsx` smokes with `node:assert/strict`, `ws`.

**Spec:** `docs/superpowers/specs/2026-06-30-data-onchain-design.md`

**Conventions (from the audit):**
- New package auto-discovered via root `pnpm-workspace.yaml` (`kit/packages/*`). Copy `kit/packages/cognition/{package.json,tsconfig.json}` as the template.
- `verify` = `get(rootHash)` → `contentId(bytes) === rootHash` (+ optional `expected` compare). Never rely on `proof:true`.
- The fake's `keccak256` content-id need only be internally consistent (tests never cross fake↔real).
- `@0gfoundation/0g-storage-ts-sdk` is a NORMAL `dependency` of the kit package (lazy-imported but must exist at runtime). `ethers` is also a direct `dependency` (not peer) — `transport.ts` imports `keccak256` from it at module-load, so it must resolve standalone; this matches how `@aigg/onchain` declares `viem` directly.
- Kit commits run with cwd inside `kit/`. 0gtown commits in the parent repo.

---

### Task 1: `@aigg/data-onchain` package (transport + client + verify + smoke)

**Files:**
- Create: `kit/packages/data-onchain/package.json`, `tsconfig.json`, `src/transport.ts`, `src/zerog-storage.ts`, `src/config.ts`, `src/index.ts`
- Test: `kit/packages/data-onchain/src/__tests__/data-onchain.smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `kit/packages/data-onchain/src/__tests__/data-onchain.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import { ZeroGStorageClient, FakeZeroGTransport } from '../index';

const BELIEF = "I won't fall for that scam again.";

async function main() {
  const t = new FakeZeroGTransport();
  const zg = new ZeroGStorageClient(t);

  const root = await zg.upload(BELIEF, 'belief');
  assert.ok(typeof root === 'string' && root.startsWith('0x'), 'upload → 0x rootHash');
  assert.equal(await zg.download(root), BELIEF, 'download round-trips the exact data');

  // contentId is deterministic + content-addressed (same bytes → same id)
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(await t.contentId(enc('x')), await t.contentId(enc('x')), 'contentId deterministic');
  assert.notEqual(await t.contentId(enc('x')), await t.contentId(enc('y')), 'different bytes → different id');

  // verify intact
  const v = await zg.verify(root);
  assert.equal(v.verified, true, 'verify intact → true');
  assert.equal(v.data, BELIEF, 'verify returns the recovered data');
  assert.equal((await zg.verify(root, BELIEF)).verified, true, 'verify matches expected → true');
  assert.equal((await zg.verify(root, 'something else')).verified, false, 'verify wrong expected → false');

  // verify TAMPERED content: store different bytes under the same rootHash → content-id mismatch
  t._putRaw(root, enc('evil'));
  assert.equal((await zg.verify(root)).verified, false, 'verify tampered content → false');

  console.log('DATA-ONCHAIN SMOKE OK ✅');
}
main().catch((e) => { console.error('DATA-ONCHAIN SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Volumes/T7-Data/aigg-0gtown/kit && node --import tsx packages/data-onchain/src/__tests__/data-onchain.smoke.ts`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 3: Scaffold the package (package.json + tsconfig.json)**

Copy the cognition templates and adjust:
```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
mkdir -p packages/data-onchain/src/__tests__
cp packages/cognition/tsconfig.json packages/data-onchain/tsconfig.json
```
Create `kit/packages/data-onchain/package.json` (mirror `packages/cognition/package.json`'s shape — same `type`/`version`/`private`/`main`/`exports` fields — with these values):
```json
{
  "name": "@aigg/data-onchain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@aigg/npc-agent": "workspace:*",
    "@0gfoundation/0g-storage-ts-sdk": "^1.2.10",
    "ethers": "^6.16.0"
  },
  "scripts": {
    "test": "node --import tsx src/__tests__/data-onchain.smoke.ts"
  }
}
```
(If `packages/cognition/package.json` uses a different `main`/`exports` form, match it exactly — it's the proven working shape.)

- [ ] **Step 4: Implement `src/transport.ts`**

Create `kit/packages/data-onchain/src/transport.ts`:
```ts
/**
 * ZeroGTransport — the byte-level seam under ZeroGStorageClient. Real = the 0G
 * Storage SDK (built in zerog-storage.ts:fromConfig); Fake = content-addressed
 * in-memory for hermetic tests. `contentId` is what makes `verify` faithful for
 * both transports without the client knowing 0G internals.
 */
import { keccak256 } from 'ethers';

export interface ZeroGTransport {
  /** store bytes → return the rootHash (0G Merkle content-id). */
  put(bytes: Uint8Array): Promise<string>;
  /** fetch the bytes stored under a rootHash. */
  get(rootHash: string): Promise<Uint8Array>;
  /** the rootHash these bytes WOULD get (real: SDK merkle root; fake: keccak256) — used by verify. */
  contentId(bytes: Uint8Array): Promise<string>;
}

/** In-memory content-addressed transport for hermetic tests. content-id = keccak256(bytes). */
export class FakeZeroGTransport implements ZeroGTransport {
  private readonly store = new Map<string, Uint8Array>();
  async contentId(bytes: Uint8Array): Promise<string> { return keccak256(bytes); }
  async put(bytes: Uint8Array): Promise<string> {
    const id = await this.contentId(bytes);
    this.store.set(id, bytes);
    return id;
  }
  async get(rootHash: string): Promise<Uint8Array> {
    const b = this.store.get(rootHash);
    if (!b) throw new Error(`FakeZeroGTransport: no blob for ${rootHash}`);
    return b;
  }
  /** TEST-ONLY: store mismatched bytes under `rootHash` (simulates a tampered blob). */
  _putRaw(rootHash: string, bytes: Uint8Array): void { this.store.set(rootHash, bytes); }
}
```

- [ ] **Step 5: Implement `src/config.ts`**

Create `kit/packages/data-onchain/src/config.ts`:
```ts
/** 0G Galileo testnet defaults (verify the indexer URL against current 0G docs before mainnet). */
export const ZEROG_TESTNET = {
  evmRpc: 'https://evmrpc-testnet.0g.ai',
  indexerRpc: 'https://indexer-storage-testnet-turbo.0g.ai',
} as const;
```

- [ ] **Step 6: Implement `src/zerog-storage.ts`**

Create `kit/packages/data-onchain/src/zerog-storage.ts`:
```ts
/**
 * ZeroGStorageClient — 0G Storage data-anchoring. upload(data,name)→rootHash and
 * download(rootHash)→data; the rootHash is 0G's Merkle content-id, so the
 * round-trip is tamper-evident. verify(rootHash) re-derives the content-id from
 * the downloaded bytes and checks it equals the rootHash (the SDK's proof:true
 * download is a no-op in 0g-storage-ts-sdk@1.2.10, so verification is client-side).
 *
 * SERVICE-SIDE: fromConfig holds a signer key and lazy-imports the 0G SDK + ethers
 * (both optional at import time; required only on the real path).
 */
import type { AutoDriveClient } from '@aigg/npc-agent';
import type { ZeroGTransport } from './transport';

export interface ZeroGConfig {
  /** 0G Storage indexer RPC. */
  indexerRpc: string;
  /** 0G EVM RPC (the storage tx is posted here). */
  evmRpc: string;
  /** signer key (env only) — pays the storage tx. */
  privateKey: string;
}

export class ZeroGStorageClient implements AutoDriveClient {
  constructor(private readonly transport: ZeroGTransport) {}

  /** Real client over @0gfoundation/0g-storage-ts-sdk (lazy-imported). */
  static async fromConfig(cfg: ZeroGConfig): Promise<ZeroGStorageClient> {
    const sdk: any = await import('@0gfoundation/0g-storage-ts-sdk' as string);
    const { ethers }: any = await import('ethers' as string);
    const provider = new ethers.JsonRpcProvider(cfg.evmRpc);
    const signer = new ethers.Wallet(cfg.privateKey, provider);
    const indexer = new sdk.Indexer(cfg.indexerRpc);
    const merkleRoot = async (bytes: Uint8Array): Promise<string> => {
      const mem = new sdk.MemData(bytes);
      const [tree, treeErr] = await mem.merkleTree();
      if (treeErr) throw treeErr;
      const root = tree?.rootHash?.();
      if (!root) throw new Error('0G Storage: empty merkle root');
      return root as string;
    };
    return new ZeroGStorageClient({
      contentId: merkleRoot,
      async put(bytes: Uint8Array): Promise<string> {
        const mem = new sdk.MemData(bytes);
        const [, treeErr] = await mem.merkleTree();
        if (treeErr) throw treeErr;
        const [tx, err] = await indexer.upload(mem, cfg.evmRpc, signer);
        if (err) throw err;
        return tx.rootHash as string;
      },
      async get(rootHash: string): Promise<Uint8Array> {
        const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
        if (err) throw err;
        return new Uint8Array(await blob.arrayBuffer());
      },
    });
  }

  async upload(data: string, _name: string): Promise<string> {
    return this.transport.put(new TextEncoder().encode(data));
  }

  async download(cid: string): Promise<string> {
    return new TextDecoder().decode(await this.transport.get(cid));
  }

  /** download by rootHash, confirm the bytes hash back to it (tamper-evident); optionally compare to `expected`. */
  async verify(rootHash: string, expected?: string): Promise<{ verified: boolean; data: string }> {
    const bytes = await this.transport.get(rootHash);
    const id = await this.transport.contentId(bytes);
    const data = new TextDecoder().decode(bytes);
    const verified = id === rootHash && (expected === undefined || data === expected);
    return { verified, data };
  }
}
```

- [ ] **Step 7: Implement `src/index.ts` (barrel)**

Create `kit/packages/data-onchain/src/index.ts`:
```ts
/** @aigg/data-onchain — 0G Storage data anchoring (upload/download/verify) for AI agents. */
export { ZeroGStorageClient } from './zerog-storage';
export type { ZeroGConfig } from './zerog-storage';
export { FakeZeroGTransport } from './transport';
export type { ZeroGTransport } from './transport';
export { ZEROG_TESTNET } from './config';
```

- [ ] **Step 8: Install (link the new workspace package) + run the smoke**

Run:
```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && pnpm install >/dev/null 2>&1
node --import tsx packages/data-onchain/src/__tests__/data-onchain.smoke.ts
```
Expected: `DATA-ONCHAIN SMOKE OK ✅`. (If `pnpm install` from the kit root errors because the kit isn't a standalone workspace in this checkout, run `pnpm install` from `/Volumes/T7-Data/aigg-0gtown` instead — the 0gtown workspace globs `kit/packages/*`.)

- [ ] **Step 9: Typecheck the package**

Run: `cd /Volumes/T7-Data/aigg-0gtown/kit && pnpm -C packages/data-onchain exec tsc --noEmit`
Expected: exit 0 (a pre-existing `baseUrl` deprecation NOTE is fine).

- [ ] **Step 10: Commit (inside kit)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git checkout -B data-onchain   # if not already on a kit data-onchain branch
git add packages/data-onchain
git commit -m "feat(data-onchain): @aigg/data-onchain — 0G Storage anchoring + verify (AutoDriveClient impl)"
```

---

### Task 2: bump 0gtown submodule + add the dep

**Files:**
- Modify: 0gtown `package.json` (add dep), the `kit` submodule pointer

- [ ] **Step 1: Push the kit branch + add the dep + bump the pointer**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git push -u origin data-onchain 2>&1 | tail -2
cd /Volumes/T7-Data/aigg-0gtown
git checkout data-onchain 2>/dev/null || true   # parent repo should already be on data-onchain (spec/plan branch)
```
Add `"@aigg/data-onchain": "workspace:*"` to the `dependencies` block of `/Volumes/T7-Data/aigg-0gtown/package.json` (alongside the other `@aigg/*` deps), then:
```bash
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @aigg/data-onchain"
pnpm install
```

- [ ] **Step 2: Verify 0gtown can import the kit package under tsx**

Run:
```bash
cd /Volumes/T7-Data/aigg-0gtown
node --import tsx --input-type=module -e "import('@aigg/data-onchain').then(m=>console.log('ZeroGStorageClient:', typeof m.ZeroGStorageClient, '| FakeZeroGTransport:', typeof m.FakeZeroGTransport))"
```
Expected: `ZeroGStorageClient: function | FakeZeroGTransport: function`.

- [ ] **Step 3: Commit the dep add**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add package.json pnpm-lock.yaml
git commit -m "feat: depend on @aigg/data-onchain (workspace)"
```

---

### Task 3: 0gtown consumes the kit — delete local copy, import, `verify` command

**Files:**
- Delete: `src/zerog-storage.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Delete the vendored copy + repoint the import**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git rm src/zerog-storage.ts
```
In `src/server.ts`, change the import line (currently `import { ZeroGStorageClient, ZEROG_TESTNET } from './zerog-storage';`) to:
```ts
import { ZeroGStorageClient, ZEROG_TESTNET } from '@aigg/data-onchain';
```

- [ ] **Step 2: Typecheck (confirms the move didn't break the belief-anchoring boot path)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck`
Expected: exit 0. (The `zg.upload(...)` belief-anchor site + `ZeroGStorageClient.fromConfig(...)` now resolve from the kit — identical types.)

- [ ] **Step 3: Add the `verify` WS command**

In `src/server.ts`, in the `ws.on('message')` switch (after the `settle` branch, before the final `unknown command` reply), add:
```ts
        if (msg.cmd === 'verify') {
          if (!zg) return sendJson({ type: 'verified', disabled: true });
          const rootHash = String(msg.rootHash ?? '');
          if (!rootHash) return sendJson({ type: 'error', text: 'verify needs a rootHash' });
          try {
            const { verified, data } = await zg.verify(rootHash);
            return sendJson({ type: 'verified', rootHash, verified, data });
          } catch (e: any) {
            return sendJson({ type: 'verified', rootHash, verified: false, error: e?.message?.slice(0, 120) });
          }
        }
```
(`zg` is the `ZeroGStorageClient | undefined` constructed at boot under the `ZEROGTOWN_STORAGE` gate — already in scope where the other commands are.)

- [ ] **Step 4: Typecheck + spike (no regression)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck && pnpm spike 2>&1 | grep -E "✓|FAIL"`
Expected: exit 0; all existing spike arcs `✓`, no FAIL. (The spike runs without `ZEROGTOWN_STORAGE`, so `zg` is undefined and `verify` would reply `disabled` — Task 5 adds the hermetic verify assertion.)

- [ ] **Step 5: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/server.ts src/zerog-storage.ts
git commit -m "feat: consume @aigg/data-onchain (delete local copy) + verify WS command"
```

---

### Task 4: frontend — clickable verifiable rootHash chip

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Read the current chip rendering**

Read `public/index.html` and locate: the `stamp(root, label)` helper that renders the `beliefRoot` chip (the audit found it at ~line 296-298 with `onclick="copyRoot(...)"`), the `send({cmd:...})` wrapper, the `dispatch(m)` `switch(m.type)`, the `esc()` escaper, and the per-NPC log render (`pushLog`/`render`) — the same surfaces Task 8 of ④ used. Mirror them.

- [ ] **Step 2: Make the chip verifiable + handle the `verified` reply**

Add a verify affordance to the belief chip — a small "verify ⛓" link/button next to the existing rootHash `stamp`, wired to `send({ cmd:'verify', rootHash })`. Then add a `case 'verified': onVerified(m); break;` to the `dispatch` switch, with:
```js
function onVerified(m) {
  if (m.disabled) { pushLog(state.cur || (state.npcs[0] && state.npcs[0].id), { k: 'verify-note', text: '0G Storage verify not configured' }); return; }
  const id = state.cur || (state.npcs[0] && state.npcs[0].id); if (!id) return;
  pushLog(id, { k: 'verify', ok: m.verified, root: m.rootHash, data: m.data || '', err: m.error || '' });
}
```
And in `render(e)`, add branches mirroring the existing chip/beat style (use `esc()` on every interpolated value):
```js
  if (e.k === 'verify-note') return `<div class="beat"><div class="line">⛓ ${esc(e.text)}</div></div>`;
  if (e.k === 'verify') return `<div class="beat ${e.ok ? 'learn' : ''}"><div class="line">${e.ok ? '✓ verified against 0G Storage' : '✗ could not verify'}${e.err ? ' ('+esc(e.err)+')' : ''}</div>${e.ok && e.data ? '<div class="line">“'+esc(e.data)+'”</div>' : ''}</div>`;
```
(Adapt the exact class names / DOM to what the page actually uses — the GOAL: clicking the chip sends `{cmd:'verify',rootHash}` and the page renders ✓/✗ + the recovered belief text.)

- [ ] **Step 3: Sanity — well-formed HTML + button served**

Run:
```bash
cd /Volumes/T7-Data/aigg-0gtown
node -e "const s=require('fs').readFileSync('public/index.html','utf8'); if(!/cmd:\s*'verify'/.test(s)) throw new Error('verify wiring missing'); if((s.match(/<script/g)||[]).length!==(s.match(/<\/script>/g)||[]).length) throw new Error('unbalanced script'); console.log('html ok')"
```
Expected: `html ok`.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add public/index.html
git commit -m "feat(ui): clickable verifiable rootHash chip (pull belief from 0G Storage + verify)"
```

---

### Task 5: spike — anchor→verify arc (hermetic)

**Files:**
- Modify: `src/spike.ts`

- [ ] **Step 1: Add a hermetic anchor→verify block**

Read `src/spike.ts` (note its import style + assert usage). At the END (after the settle arc), add a pure-logic block using the fake transport — it proves the upload→verify round-trip without 0G:
```ts
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
```
(Reuse the spike's top-level `assert`; `@aigg/data-onchain` / dynamic import mirrors the ④ settle arc's `import('@aigg/onchain')` style.)

- [ ] **Step 2: Run the spike**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm spike 2>&1 | grep -E "✓|FAIL"`
Expected: all existing arcs `✓` + the new `✓ data-on-chain arc:` line, no FAIL.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/spike.ts
git commit -m "test: spike data-on-chain arc — anchor→verify round-trip (hermetic)"
```

---

### Task 6: full verification + live testnet verify

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
for f in packages/cognition/src/__tests__/*.smoke.ts packages/replay/src/__tests__/*.smoke.ts packages/onchain/src/__tests__/*.smoke.ts packages/data-onchain/src/__tests__/*.smoke.ts; do node --import tsx "$f" >/dev/null 2>&1 && echo "ok $(basename $f)" || echo "FAIL $(basename $f)"; done
cd /Volumes/T7-Data/aigg-0gtown && pnpm typecheck && pnpm spike 2>&1 | grep -E "✓|FAIL"
```
Expected: all `ok` / `✓`, no `FAIL`.

- [ ] **Step 2: One real 0G testnet anchor→verify (the data analog of ④'s live settle)**

With a funded testnet key:
```bash
cd /Volumes/T7-Data/aigg-0gtown
node --import tsx --input-type=module -e "
import { ZeroGStorageClient, ZEROG_TESTNET } from '@aigg/data-onchain';
const zg = await ZeroGStorageClient.fromConfig({ ...ZEROG_TESTNET, privateKey: process.env.ZEROG_WALLET_PK });
const root = await zg.upload('live belief '+Date.now(), 'belief');
console.log('rootHash:', root);
const v = await zg.verify(root);
console.log('verify:', v.verified, JSON.stringify(v.data));
"
```
(Run with `ZEROG_WALLET_PK=0x…`.) Confirm a real `0x` rootHash + `verify: true` with the exact uploaded text. (Storage uploads cost a little testnet $0G + take a few seconds.)

- [ ] **Step 3: Final review dispatch**

Per subagent-driven-development, dispatch a final whole-implementation code review before finishing the branch.

---

## Notes for the implementer

- **bytes vs string:** `AutoDriveClient` is string-in/string-out; the `ZeroGTransport` is bytes. `upload`/`download` do the UTF-8 encode/decode; `verify` compares decoded strings + the raw-bytes content-id.
- **Never rely on `proof:true`** — it's a no-op in `0g-storage-ts-sdk@1.2.10`. `verify` is the content-id recompute.
- **Two repos:** Task 1 commits inside `kit/`; Tasks 2-5 in 0gtown; Task 2 bumps the submodule (push the kit branch first).
- **Graceful:** the spike + the always-on path run without `ZEROGTOWN_STORAGE`, so `zg` is undefined and `verify` replies `{disabled:true}` — the town is unaffected.
- **Behavior preserved:** the moved `upload`/`download`/`fromConfig` bodies are byte-identical to the deleted 0gtown file; only `contentId` (transport) + `verify` (client) are new.

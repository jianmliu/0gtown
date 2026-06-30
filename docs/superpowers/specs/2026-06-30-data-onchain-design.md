# Design: ⑤ data-on-chain — `@aigg/data-onchain` (0G Storage data anchoring)

**Date:** 2026-06-30
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Kit home:** new package `kit/packages/data-onchain/`
**Branch:** `data-onchain` (stacks on `main` — ①/②/④ already merged)

---

## 1. Background & motivation

0gtown anchors each learned belief to **0G Storage** (`src/zerog-storage.ts`): a losing pitch uploads the belief blob, gets back a **rootHash** (0G's Merkle content-id), and shows it as a tamper-evident chip. That client was **vendored verbatim from aigg-mud-demo** because "the engine doesn't house a storage client yet." ⑤ extracts it into a reusable kit package and adds the **verification** half (download-by-rootHash + confirm the content matches), so the tamper-evidence is demonstrated, not just claimed.

This is the 5th `@aigg/*` extraction (after ① replay, ② cognition, ④ economy). It is the **data** counterpart to ④'s **value** on-chain: ④ moves real `$0G` on **0G Chain (EVM)**; ⑤ anchors **data** to **0G Storage** (rootHash). The kit already defines the **port** — `AutoDriveClient` in `@aigg/npc-agent` (`upload(data,name)→CID` / `download(cid)`) consumed by `AutoDriveStore` — but ships **no implementation**. ⑤ supplies the 0G Storage implementation.

### Agreed decisions (brainstorming, 2026-06-30)

1. **New package `@aigg/data-onchain`** (not folded into `@aigg/onchain`) — clean separation of "data/storage" from ④'s "economy/wallet". Same service-side profile (holds the storage signer key, lazy-loads the 0G SDK + ethers; **not** browser-safe).
2. **Scope = extraction + `verify`.** Move `ZeroGStorageClient` + the `ZeroGTransport` seam into the package, add a hermetic fake, add a `verify(rootHash)` tamper-check, and wire 0gtown to consume the kit version (delete its local copy) + make its rootHash chip verifiable.
3. **verify mechanism:** real path leans on the 0G SDK's `proof:true` download (the Merkle proof IS the verification); the fake recomputes a `keccak256` content-id. The code-grounded audit pins the exact mechanism.

### Non-goals (⑤)

- No on-chain keccak-anchor **contract** — the 0G Storage rootHash already IS the content-id; verification is the Merkle proof, not a separate contract.
- No `aigg-mud-demo` / `onchainpal` migration to the kit package (follow-up, like ④'s scope-migration debt).
- No wiring of ④'s stubbed `Native0gSettlementLayer.anchor(stateRoot)` (deferred — a clean future tie-in, out of ⑤ scope).
- No change to the kit's `AutoDriveClient` port or `AutoDriveStore` (the package *implements* the port; it doesn't alter it).

### Code-grounded facts (verified; re-confirm in the audit)

- The port: `@aigg/npc-agent/src/store/auto-drive-store.ts` → `interface AutoDriveClient { upload(data: string, name: string): Promise<string>; download(cid: string): Promise<string>; }`. `ZeroGStorageClient` already `implements AutoDriveClient`.
- Current client: `src/zerog-storage.ts` — `ZeroGTransport { put(bytes)→rootHash; get(rootHash)→bytes }`; `fromConfig(cfg)` builds the real transport over `@0gfoundation/0g-storage-ts-sdk` (lazy `import`) + `ethers` (lazy); `get` already uses `downloadToBlob(rootHash, { proof: true })`; `ZEROG_TESTNET` defaults (`evmRpc`, `indexerRpc`).
- Server usage: env-gated on `ZEROGTOWN_STORAGE === '1'` + a key (`server.ts:95-104`); the only upload site is `zg.upload(...)` (~`server.ts:376`), whose `root` rides the `pitched` reply (`beliefRoot`) and emits `town.anchor` (~`server.ts:406`).
- `@0gfoundation/0g-storage-ts-sdk` + `ethers` are already 0gtown deps; they must become deps (ethers peer, SDK optional/lazy) of the new package.

---

## 2. The kit library — `@aigg/data-onchain`

New `kit/packages/data-onchain/` (package.json `@aigg/data-onchain`, `type:module`, dep `@aigg/npc-agent`, peer `ethers`, optional `@0gfoundation/0g-storage-ts-sdk`). Files:

- `src/transport.ts` — the byte-level seam + fake:
  ```ts
  export interface ZeroGTransport {
    put(bytes: Uint8Array): Promise<string>;          // → rootHash (content-id)
    get(rootHash: string): Promise<Uint8Array>;        // proof-verified fetch
    contentId(bytes: Uint8Array): Promise<string>;     // the rootHash bytes WOULD get (for verify)
  }
  /** content-addressed in-memory transport for hermetic tests: contentId = keccak256(bytes). */
  export class FakeZeroGTransport implements ZeroGTransport { /* Map<rootHash, bytes> */ }
  ```
- `src/zerog-storage.ts` — `ZeroGStorageClient implements AutoDriveClient` (moved from 0gtown, generalized comments): `upload(data,name)`/`download(cid)` over the transport; `static fromConfig(cfg)` = the real 0G-SDK transport (the SDK path also implements `contentId` via `mem.merkleTree()`); plus:
  ```ts
  /** download by rootHash and confirm the content hashes back to it; optionally compare to `expected`. */
  async verify(rootHash: string, expected?: string): Promise<{ verified: boolean; data: string }>;
  ```
  `verify` = `get(rootHash)` (real: proof-verified; fake: from the map) → `contentId(bytes) === rootHash` → if `expected` given also `data === expected`.
- `src/config.ts` — `ZEROG_TESTNET` defaults (moved).
- `src/index.ts` — barrel (`ZeroGStorageClient`, `ZeroGTransport`, `FakeZeroGTransport`, `ZeroGConfig`, `ZEROG_TESTNET`).

**Why `contentId` on the seam:** it makes `verify` faithful for BOTH transports without the client knowing 0G internals — the real transport returns the SDK Merkle root, the fake returns keccak. The audit confirms the real SDK can compute the root of arbitrary bytes (`mem.merkleTree()`), and whether `proof:true` download already guarantees the match (in which case `verify` on the real path is "download succeeded" + the optional `expected` compare).

---

## 3. 0gtown — consume the kit + a verifiable chip

- **Delete `src/zerog-storage.ts`**; import `ZeroGStorageClient`, `ZEROG_TESTNET` from `@aigg/data-onchain`. The boot (`ZEROGTOWN_STORAGE` gate, `fromConfig`) and the belief-upload site are otherwise **unchanged** — behavior identical, just sourced from the kit.
- **New `verify` WS command:** `{ cmd: 'verify', rootHash }` → if no storage client, reply `{ type:'verified', disabled:true }`; else `const { verified, data } = await zg.verify(rootHash)` → reply `{ type:'verified', rootHash, verified, data }` (best-effort try/catch, like the other 0G paths).
- **Frontend:** the `beliefRoot` rootHash chip becomes clickable → sends `{cmd:'verify', rootHash}` → renders `✓ verified · "<belief pulled from 0G Storage>"` (or `✗ could not verify`). Mirrors the existing chip/escaping pattern.
- Replay: `town.anchor` (upload) is unchanged; `verify` is a read — **no new replay event**.

---

## 4. Error handling & testing

- The package is best-effort at the call sites (0gtown try/catches the storage paths today; keep that). `fromConfig` lazy-imports the SDK so the package is usable (fake transport) without the heavy dep installed.
- **kit `data-onchain.smoke`** (FakeZeroGTransport, no network): `upload("hi","n")` → a rootHash; `download(rootHash) === "hi"`; `verify(rootHash)` → `{verified:true, data:"hi"}`; `verify(rootHash, "hi")` true, `verify(rootHash, "tampered")` → `verified:false`; a rootHash whose stored bytes were swapped (content-id mismatch) → `verified:false`; `contentId` deterministic (same bytes → same id).
- **0gtown spike** — anchor→verify arc (hermetic): inject a `FakeZeroGTransport`-backed client, upload a belief, assert `verify(root)` round-trips the exact belief and `verified:true`; assert a wrong rootHash / tampered content yields `verified:false`.
- Typecheck both packages; run the existing kit smokes + 0gtown spike to confirm no regression (the moved client must keep the belief-anchoring green).

Before claiming done: with real 0G testnet creds, upload a belief and `verify` it round-trips against the live rootHash (the data analog of ④'s live settle).

---

## 5. Why this is the right seam

The kit already split storage into a **port** (`AutoDriveClient`) + a **consumer** (`AutoDriveStore`) but left the implementation stranded in 0gtown. ⑤ completes the seam: the 0G Storage adapter becomes a reusable package any kit consumer can anchor data through, the byte-level `ZeroGTransport` + fake make it hermetically testable, and `verify` turns the tamper-evidence from a claim into a demonstrated round-trip. It closes the README's "data on 0G Storage" story as the clean counterpart to ④'s value-on-0G-Chain.

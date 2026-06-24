# @onchainpal/replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified, pack-extensible replay library (`@onchainpal/replay`) in the kit, and wire it into 0gtown so the night-market learn-loop emits a conformant `replay@1` JSONL stream viewable in a pack-aware browser viewer.

**Architecture:** A minimal domain-neutral core (`run`/`tick`/`summary` JSONL) plus a Pack Registry. Domain worlds register packs (`town@0` for 0gtown, `econ@0` specified as a stub) that declare event kinds, validation invariants, and viewer panel descriptors. The recorder, validator, and viewer all consult the same registry — adding a world never touches the core. Full design: [docs/superpowers/specs/2026-06-24-replay-library-design.md](2026-06-24-replay-library-design.md) (in 0gtown).

**Tech Stack:** TypeScript (ESM, Node ≥20), pnpm workspace, `tsx` smoke tests with `node:assert/strict`, zero-dependency browser viewer (static HTML/ESM/CSS).

---

## ⚠️ Two-repo commit discipline (read before starting)

`kit/` is a **git submodule** (`aigg-agent-kit`). Two repos are in play:

- **Kit submodule** (`/Volumes/T7-Data/aigg-0gtown/kit`): everything under `kit/packages/replay/` and the edit to `kit/tsconfig.base.json`. Commit these **inside `kit/`** (`cd kit && git ...`).
- **0gtown repo** (`/Volumes/T7-Data/aigg-0gtown`): `package.json`, `src/server.ts`, `src/spike.ts`, `runs/`, the spec/plan docs, and the **submodule pointer bump**. Commit these at the repo root.

Task 1 creates a working branch in **both** repos. Tasks 2–10 commit inside `kit/`. Task 11 commits in 0gtown. Task 12 bumps the submodule pointer in 0gtown.

All `pnpm` commands run from the 0gtown repo root unless stated. Filter syntax: `pnpm --filter @onchainpal/replay <script>`.

---

## File Structure

**Kit submodule — new package `kit/packages/replay/`:**
- `package.json` — `@onchainpal/replay`, ESM, `test:*` scripts (tsx smoke runners)
- `tsconfig.json` — extends `../../tsconfig.base.json`, `include: ["src"]`
- `src/schema.ts` — core types (`Entity`, `RunHeader`, `Event`, `Tick`, `Summary`) + `ReplayPack`/`PanelSpec`/`ValidateCtx` interfaces + `SCHEMA_ID`
- `src/packs/core.ts` — built-in `core@0` pack (`move`/`say` + entity-graph panel)
- `src/packs/town.ts` — `town@0` pack (talk/pitch/refuse/anchor + validation + Learn Ledger panel)
- `src/packs/econ.ts` — `econ@0` pack (event kinds + panel specs; stub validation, deferred rewiring)
- `src/registry.ts` — `PackRegistry` class + `defaultRegistry()` (core+town+econ preloaded)
- `src/validate.ts` — `validateRun(input)` + `validateFile(path)` → `{ ok, errors }`
- `src/recorder.ts` — `createRecorder(opts)` → `Recorder`
- `src/assets.ts` — `viewerDir()` (filesystem path to the static viewer, for hosts to serve)
- `src/index.ts` — barrel
- `src/__tests__/*.smoke.ts` — one smoke per module
- `viewer/viewer-core.js` — pure ESM (no DOM): `parseRun`, `activePanels`, `townLedger`
- `viewer/index.html`, `viewer/viewer.js`, `viewer/viewer.css` — pack-aware browser viewer
- `fixtures/0gtown-sample.jsonl` — town@0 fixture
- `README.md`

**Edited in kit:** `kit/tsconfig.base.json` (add `@onchainpal/replay` path mapping).

**0gtown repo — edited:**
- `package.json` — add `"@onchainpal/replay": "workspace:*"`
- `src/server.ts` — instantiate recorder, emit events beside each WS send, serve `/replay/`
- `src/spike.ts` — record during the marquee loop, assert town events + `validateRun`

---

### Task 1: Scaffold the `@onchainpal/replay` package

**Files:**
- Create branch in kit submodule and 0gtown
- Create: `kit/packages/replay/package.json`
- Create: `kit/packages/replay/tsconfig.json`
- Create: `kit/packages/replay/src/index.ts` (temporary stub)
- Create: `kit/packages/replay/src/__tests__/scaffold.smoke.ts`
- Modify: `kit/tsconfig.base.json` (add path mapping)

- [ ] **Step 1: Create working branches in both repos**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git checkout -b replay-library
cd /Volumes/T7-Data/aigg-0gtown && git status   # confirm already on branch replay-library
```

Expected: kit now on `replay-library`; 0gtown already on `replay-library` (created earlier for the spec).

- [ ] **Step 2: Write `kit/packages/replay/package.json`**

```json
{
  "name": "@onchainpal/replay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "description": "Unified, pack-extensible replay: replay@1 schema, recorder, validator, and a pack-aware viewer. Domain-neutral core + Pack Registry — adding a world registers a pack, the core never changes.",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": { "import": "./src/index.ts", "types": "./src/index.ts" }
  },
  "scripts": {
    "test:scaffold": "tsx src/__tests__/scaffold.smoke.ts",
    "test:registry": "tsx src/__tests__/registry.smoke.ts",
    "test:town": "tsx src/__tests__/town-pack.smoke.ts",
    "test:econ": "tsx src/__tests__/econ-pack.smoke.ts",
    "test:validate": "tsx src/__tests__/validate.smoke.ts",
    "test:recorder": "tsx src/__tests__/recorder.smoke.ts",
    "test:fixture": "tsx src/__tests__/fixture.smoke.ts",
    "test:viewer": "tsx src/__tests__/viewer-core.smoke.ts"
  },
  "devDependencies": {
    "@types/node": "^22.8.4",
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 3: Write `kit/packages/replay/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 4: Add the path mapping in `kit/tsconfig.base.json`**

In the `compilerOptions.paths` object (alongside the existing `@onchainpal/gamekit` entries), add:

```json
      "@onchainpal/replay": ["packages/replay/src/index.ts"],
      "@onchainpal/replay/*": ["packages/replay/src/*"]
```

- [ ] **Step 5: Write the temporary barrel `kit/packages/replay/src/index.ts`**

```ts
export const PACKAGE = '@onchainpal/replay';
```

- [ ] **Step 6: Write the scaffold smoke `kit/packages/replay/src/__tests__/scaffold.smoke.ts`**

```ts
/**
 * Scaffold smoke — proves the package resolves and runs under tsx.
 * Run: pnpm --filter @onchainpal/replay test:scaffold
 */
import assert from 'node:assert/strict';
import { PACKAGE } from '../index';

assert.equal(PACKAGE, '@onchainpal/replay', 'barrel resolves');
console.log('ALL SCAFFOLD SMOKE TESTS PASSED ✅');
```

- [ ] **Step 7: Link the new workspace package**

Run: `pnpm install`
Expected: pnpm picks up `@onchainpal/replay` under the `kit/packages/*` glob; no errors.

- [ ] **Step 8: Run the scaffold smoke**

Run: `pnpm --filter @onchainpal/replay test:scaffold`
Expected: `ALL SCAFFOLD SMOKE TESTS PASSED ✅`

- [ ] **Step 9: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay tsconfig.base.json
git commit -m "feat(replay): scaffold @onchainpal/replay package"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 2: Core schema + pack interface

**Files:**
- Create: `kit/packages/replay/src/schema.ts`
- Test: `kit/packages/replay/src/__tests__/scaffold.smoke.ts` (extend) — covered by later tests; no separate test here

- [ ] **Step 1: Write `kit/packages/replay/src/schema.ts`**

```ts
/**
 * replay@1 — the domain-neutral core types plus the Pack interface.
 * Domain specifics live in packs (see ./packs/*), never here.
 */

export const SCHEMA_ID = 'replay@1' as const;

/** A generic actor in the world (replaces the economics-specific "agent"). */
export interface Entity {
  id: string;
  name: string;
  kind?: string;
  tags?: string[];
}

export interface MapRoom { id: string; name: string }
export interface WorldMap { rooms: MapRoom[]; edges?: [string, string][] }

/** Line 1 of a run. */
export interface RunHeader {
  kind: 'run';
  schema: typeof SCHEMA_ID;
  runId: string;
  title?: string;
  /** Monotonic origin (tick or ms) — the producer's choice. */
  createdAt: number;
  /** Declared DOMAIN packs present in this run (core is implicit). */
  packs: string[];
  entities: Entity[];
  map?: WorldMap;
  meta?: Record<string, unknown>;
}

/** One thing that happened. `kind` is "<pack>.<name>" (or core "move"/"say"). */
export interface Event {
  kind: string;
  actor?: string;
  target?: string;
  room?: string;
  by?: string;
  data?: Record<string, unknown>;
}

export interface Tick {
  kind: 'tick';
  t: number;
  events: Event[];
  metrics?: Record<string, number>;
}

export interface Summary {
  kind: 'summary';
  packs?: string[];
  metrics?: Record<string, number>;
  /** Domain blocks, e.g. `town: {...}` — open by design. */
  [block: string]: unknown;
}

export type ReplayLine = RunHeader | Tick | Summary;

/** Passed to pack validators so they can cross-check against the header. */
export interface ValidateCtx {
  header: RunHeader;
  entityIds: Set<string>;
}

/** A data-only descriptor; the viewer maps `render` to a render function. */
export interface PanelSpec {
  id: string;
  title: string;
  render: string;
}

/** The reusable seam: a world plugs in here, the core stays put. */
export interface ReplayPack {
  id: string;
  eventKinds: string[];
  validateEvent?(ev: Event, ctx: ValidateCtx): string[];
  validateTick?(tick: Tick, ctx: ValidateCtx): string[];
  viewer?: { panels: PanelSpec[] };
}
```

- [ ] **Step 2: Typecheck the kit**

Run: `pnpm --filter @onchainpal/replay exec tsc --noEmit`
Expected: no errors (types compile).

- [ ] **Step 3: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/schema.ts
git commit -m "feat(replay): replay@1 core types + ReplayPack interface"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 3: Built-in `core@0` pack

**Files:**
- Create: `kit/packages/replay/src/packs/core.ts`

- [ ] **Step 1: Write `kit/packages/replay/src/packs/core.ts`**

```ts
import type { ReplayPack } from '../schema';

/** Built-in, always implicitly present. Owns the unprefixed spatial/social verbs. */
export const CORE_PACK_ID = 'core@0';

export const corePack: ReplayPack = {
  id: CORE_PACK_ID,
  eventKinds: ['move', 'say'],
  viewer: { panels: [{ id: 'graph', title: 'Entities', render: 'entity-graph' }] },
};
```

- [ ] **Step 2: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/core.ts
git commit -m "feat(replay): built-in core@0 pack (move/say + entity graph)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 4: `town@0` pack (0gtown)

**Files:**
- Create: `kit/packages/replay/src/packs/town.ts`
- Test: `kit/packages/replay/src/__tests__/town-pack.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/town-pack.smoke.ts`**

```ts
/**
 * Smoke for the town@0 pack's validation invariants.
 * Run: pnpm --filter @onchainpal/replay test:town
 */
import assert from 'node:assert/strict';
import type { Event, ValidateCtx, RunHeader } from '../schema';
import { townPack, TOWN_PACK_ID } from '../packs/town';

const ctx: ValidateCtx = {
  header: {} as RunHeader,
  entityIds: new Set(['npc:abao']),
};

function errs(ev: Event): string[] {
  return townPack.validateEvent?.(ev, ctx) ?? [];
}

assert.equal(TOWN_PACK_ID, 'town@0');
assert.deepEqual(townPack.eventKinds, ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor']);

// town.talk verified:true needs an attestation signature
assert.equal(errs({ kind: 'town.talk', data: { verified: true, attestation: { signature: 'sig' } } }).length, 0, 'verified talk with sig ok');
assert.ok(errs({ kind: 'town.talk', data: { verified: true } }).length > 0, 'verified talk without attestation fails');
assert.equal(errs({ kind: 'town.talk', data: { verified: false } }).length, 0, 'unverified talk ok without attestation');

// town.refuse must be protected + reference a claim
assert.equal(errs({ kind: 'town.refuse', data: { protected: true, claim: 'c' } }).length, 0, 'good refuse ok');
assert.ok(errs({ kind: 'town.refuse', data: { protected: false, claim: 'c' } }).length > 0, 'refuse not protected fails');
assert.ok(errs({ kind: 'town.refuse', data: { protected: true } }).length > 0, 'refuse without claim fails');

// town.anchor must carry a beliefRoot
assert.equal(errs({ kind: 'town.anchor', data: { beliefRoot: '0xabc' } }).length, 0, 'anchor with root ok');
assert.ok(errs({ kind: 'town.anchor', data: {} }).length > 0, 'anchor without root fails');

// panel descriptor present
assert.equal(townPack.viewer?.panels[0].render, 'town-ledger');

console.log('ALL TOWN-PACK SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:town`
Expected: FAIL — `Cannot find module '../packs/town'`.

- [ ] **Step 3: Write `kit/packages/replay/src/packs/town.ts`**

```ts
import type { ReplayPack, Event } from '../schema';

export const TOWN_PACK_ID = 'town@0';

/** 0gtown's learn-loop. TEE attestations + 0G Storage roots are first-class. */
export const townPack: ReplayPack = {
  id: TOWN_PACK_ID,
  eventKinds: ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor'],
  validateEvent(ev: Event): string[] {
    const errs: string[] = [];
    const d = ev.data ?? {};
    if (ev.kind === 'town.talk' && d.verified === true) {
      const att = d.attestation as { signature?: unknown } | undefined;
      if (!att || typeof att.signature !== 'string' || !att.signature) {
        errs.push('town.talk verified:true requires attestation.signature');
      }
    }
    if (ev.kind === 'town.refuse') {
      if (d.protected !== true) errs.push('town.refuse must set protected:true');
      if (!d.claim) errs.push('town.refuse must reference a claim');
    }
    if (ev.kind === 'town.anchor') {
      if (typeof d.beliefRoot !== 'string' || !d.beliefRoot) {
        errs.push('town.anchor must carry a non-empty beliefRoot');
      }
    }
    return errs;
  },
  viewer: { panels: [{ id: 'ledger', title: 'Learn Ledger', render: 'town-ledger' }] },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:town`
Expected: `ALL TOWN-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/src/__tests__/town-pack.smoke.ts
git commit -m "feat(replay): town@0 pack — talk/pitch/refuse/anchor + invariants"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 5: `econ@0` stub pack

**Files:**
- Create: `kit/packages/replay/src/packs/econ.ts`
- Test: `kit/packages/replay/src/__tests__/econ-pack.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/econ-pack.smoke.ts`**

```ts
/**
 * Smoke for the econ@0 stub pack — proves the neutral core can name the
 * pumptown/replay@0 event vocabulary. Full validation is deferred (monopoly's cycle).
 * Run: pnpm --filter @onchainpal/replay test:econ
 */
import assert from 'node:assert/strict';
import { econPack, ECON_PACK_ID } from '../packs/econ';

assert.equal(ECON_PACK_ID, 'econ@0');
assert.ok(econPack.eventKinds.includes('econ.pump'), 'has econ.pump');
assert.ok(econPack.eventKinds.includes('econ.dump'), 'has econ.dump');
assert.ok(econPack.eventKinds.includes('econ.blackswan'), 'has econ.blackswan');
assert.ok((econPack.viewer?.panels?.length ?? 0) >= 1, 'declares at least one panel');
// stub: no validation yet
assert.equal(econPack.validateEvent, undefined, 'econ validation deferred');

console.log('ALL ECON-PACK SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:econ`
Expected: FAIL — `Cannot find module '../packs/econ'`.

- [ ] **Step 3: Write `kit/packages/replay/src/packs/econ.ts`**

```ts
import type { ReplayPack } from '../schema';

export const ECON_PACK_ID = 'econ@0';

/**
 * econ@0 — specified to prove the neutral core subsumes pumptown/replay@0.
 * Event vocabulary + viewer panels only; validation and the monopoly/mud-demo
 * rewiring are deferred to their own cycle.
 */
export const econPack: ReplayPack = {
  id: ECON_PACK_ID,
  eventKinds: [
    'econ.trade', 'econ.pump', 'econ.dump', 'econ.blackswan', 'econ.bill',
    'econ.burn', 'econ.patron', 'econ.dividend', 'econ.bet', 'econ.trust', 'econ.reflect',
  ],
  viewer: {
    panels: [
      { id: 'price', title: 'Price', render: 'econ-price' },
      { id: 'wealth', title: 'Wealth', render: 'econ-wealth' },
    ],
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:econ`
Expected: `ALL ECON-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/econ.ts packages/replay/src/__tests__/econ-pack.smoke.ts
git commit -m "feat(replay): econ@0 stub pack (vocabulary + panels, validation deferred)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 6: Pack registry + default registry

**Files:**
- Create: `kit/packages/replay/src/registry.ts`
- Test: `kit/packages/replay/src/__tests__/registry.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/registry.smoke.ts`**

```ts
/**
 * Smoke for PackRegistry + defaultRegistry.
 * Run: pnpm --filter @onchainpal/replay test:registry
 */
import assert from 'node:assert/strict';
import { PackRegistry, defaultRegistry } from '../registry';
import type { ReplayPack } from '../schema';

const reg = defaultRegistry();
assert.ok(reg.has('core@0'), 'core preloaded');
assert.ok(reg.has('town@0'), 'town preloaded');
assert.ok(reg.has('econ@0'), 'econ preloaded');
assert.equal(reg.get('nope'), undefined, 'unknown pack → undefined');

// eventKinds unions across requested packs
const kinds = reg.eventKinds(['core@0', 'town@0']);
assert.ok(kinds.has('say'), 'core say included');
assert.ok(kinds.has('town.talk'), 'town.talk included');
assert.ok(!kinds.has('econ.pump'), 'econ excluded when not requested');

// custom registry is isolated
const custom = new PackRegistry();
const fake: ReplayPack = { id: 'x@0', eventKinds: ['x.go'] };
custom.register(fake);
assert.ok(custom.has('x@0') && !custom.has('town@0'), 'custom registry isolated');

console.log('ALL REGISTRY SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:registry`
Expected: FAIL — `Cannot find module '../registry'`.

- [ ] **Step 3: Write `kit/packages/replay/src/registry.ts`**

```ts
import type { ReplayPack } from './schema';
import { corePack } from './packs/core';
import { townPack } from './packs/town';
import { econPack } from './packs/econ';

export class PackRegistry {
  private packs = new Map<string, ReplayPack>();

  register(pack: ReplayPack): this {
    this.packs.set(pack.id, pack);
    return this;
  }

  get(id: string): ReplayPack | undefined {
    return this.packs.get(id);
  }

  has(id: string): boolean {
    return this.packs.has(id);
  }

  /** Union of event kinds declared by the given pack ids (unknown ids ignored). */
  eventKinds(ids: string[]): Set<string> {
    const out = new Set<string>();
    for (const id of ids) for (const k of this.get(id)?.eventKinds ?? []) out.add(k);
    return out;
  }
}

/** A registry preloaded with the built-in core + town + econ packs. */
export function defaultRegistry(): PackRegistry {
  return new PackRegistry().register(corePack).register(townPack).register(econPack);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:registry`
Expected: `ALL REGISTRY SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/registry.ts packages/replay/src/__tests__/registry.smoke.ts
git commit -m "feat(replay): PackRegistry + defaultRegistry (core+town+econ)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 7: Validator

**Files:**
- Create: `kit/packages/replay/src/validate.ts`
- Test: `kit/packages/replay/src/__tests__/validate.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/validate.smoke.ts`**

```ts
/**
 * Smoke for validateRun — core invariants + pack validation.
 * Run: pnpm --filter @onchainpal/replay test:validate
 */
import assert from 'node:assert/strict';
import { validateRun } from '../validate';

const header = {
  kind: 'run', schema: 'replay@1', runId: 'r1', createdAt: 0,
  packs: ['town@0'],
  entities: [{ id: 'npc:abao', name: 'A-Bao' }],
};
const J = (o: unknown) => JSON.stringify(o);

// a valid minimal town run
const good = [
  J(header),
  J({ kind: 'tick', t: 1, events: [{ kind: 'town.talk', actor: 'npc:abao', data: { verified: false } }] }),
  J({ kind: 'tick', t: 2, events: [{ kind: 'town.pitch', actor: 'npc:abao', data: { accepted: true, claim: 'c', deltaGcc: -3 } }] }),
  J({ kind: 'summary', town: { refusals: 0 } }),
];
assert.equal(validateRun(good).ok, true, 'valid run passes');

// header must be first + kind run
assert.equal(validateRun([J({ kind: 'tick', t: 1, events: [] })]).ok, false, 'missing header fails');

// unknown schema
assert.equal(validateRun([J({ ...header, schema: 'replay@9' })]).ok, false, 'unknown schema fails');

// unknown declared pack
assert.equal(validateRun([J({ ...header, packs: ['ghost@0'] })]).ok, false, 'unknown pack fails');

// t must strictly increase
const badT = [J(header), J({ kind: 'tick', t: 2, events: [] }), J({ kind: 'tick', t: 2, events: [] })];
assert.equal(validateRun(badT).ok, false, 'non-increasing t fails');

// unknown event kind (econ kind not declared in this run)
const badKind = [J(header), J({ kind: 'tick', t: 1, events: [{ kind: 'econ.pump' }] })];
assert.equal(validateRun(badKind).ok, false, 'undeclared event kind fails');

// pack invariant: verified talk without attestation
const badTalk = [J(header), J({ kind: 'tick', t: 1, events: [{ kind: 'town.talk', data: { verified: true } }] })];
const r = validateRun(badTalk);
assert.equal(r.ok, false, 'verified talk without attestation fails');
assert.ok(r.errors.some((e) => e.msg.includes('attestation')), 'error mentions attestation');

// summary not last
const badSummary = [J(header), J({ kind: 'summary' }), J({ kind: 'tick', t: 1, events: [] })];
assert.equal(validateRun(badSummary).ok, false, 'summary before ticks fails');

// core move/say always allowed even without declaring a pack
const coreOnly = [
  J({ ...header, packs: [] }),
  J({ kind: 'tick', t: 1, events: [{ kind: 'say', actor: 'npc:abao', data: { text: 'hi' } }] }),
];
assert.equal(validateRun(coreOnly).ok, true, 'core say allowed without domain packs');

console.log('ALL VALIDATE SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:validate`
Expected: FAIL — `Cannot find module '../validate'`.

- [ ] **Step 3: Write `kit/packages/replay/src/validate.ts`**

```ts
import { readFileSync } from 'node:fs';
import { SCHEMA_ID, type RunHeader, type Tick, type ValidateCtx } from './schema';
import { defaultRegistry, type PackRegistry } from './registry';
import { CORE_PACK_ID } from './packs/core';

export interface ValidateError { line: number; msg: string }
export interface ValidateResult { ok: boolean; errors: ValidateError[] }

/** Validate a run given as a line array or a raw multiline JSONL string. */
export function validateRun(
  input: string | string[],
  registry: PackRegistry = defaultRegistry(),
): ValidateResult {
  const errors: ValidateError[] = [];
  const fail = (line: number, msg: string) => errors.push({ line, msg });

  const raw = (Array.isArray(input) ? input : input.trim().split('\n')).filter((l) => l.length > 0);
  if (!raw.length) return { ok: false, errors: [{ line: 0, msg: 'empty run' }] };

  const objs = raw.map((l, i) => {
    try { return JSON.parse(l); } catch { fail(i + 1, 'invalid JSON'); return null; }
  });
  if (errors.length) return { ok: false, errors };

  // header
  const h = objs[0] as RunHeader;
  if (!h || h.kind !== 'run') { fail(1, 'line 1 must be kind:"run"'); return { ok: false, errors }; }
  if (h.schema !== SCHEMA_ID) fail(1, `unexpected schema ${String(h.schema)}`);
  for (const k of ['runId', 'packs', 'entities'] as const) if (!(k in h)) fail(1, `header missing ${k}`);
  if (!Array.isArray(h.entities) || !h.entities.length) fail(1, 'header.entities empty');
  for (const e of h.entities ?? []) for (const k of ['id', 'name']) if (!(k in e)) fail(1, `entity missing ${k}`);
  for (const p of h.packs ?? []) if (!registry.has(p)) fail(1, `unknown pack ${p}`);

  const ctx: ValidateCtx = { header: h, entityIds: new Set((h.entities ?? []).map((e) => e.id)) };
  const allowed = registry.eventKinds([CORE_PACK_ID, ...(h.packs ?? [])]);
  const declaredPacks = (h.packs ?? []).map((p) => registry.get(p)).filter((p): p is NonNullable<typeof p> => !!p);

  // body
  let prevT = -Infinity;
  for (let i = 1; i < objs.length; i++) {
    const o = objs[i] as { kind?: string; t?: number; events?: { kind: string }[] };
    const line = i + 1;
    const isLast = i === objs.length - 1;

    if (o.kind === 'summary') {
      if (!isLast) fail(line, 'summary must be the last line');
      continue;
    }
    if (o.kind !== 'tick') { fail(line, `expected tick, got ${String(o.kind)}`); continue; }
    if (typeof o.t !== 'number' || o.t <= prevT) fail(line, `tick t not strictly increasing (t=${String(o.t)})`);
    else prevT = o.t;

    for (const ev of o.events ?? []) {
      if (!allowed.has(ev.kind)) fail(line, `unknown event kind ${ev.kind}`);
      for (const pack of declaredPacks) for (const m of pack.validateEvent?.(ev, ctx) ?? []) fail(line, m);
    }
    for (const pack of declaredPacks) for (const m of pack.validateTick?.(o as Tick, ctx) ?? []) fail(line, m);
  }

  return { ok: errors.length === 0, errors };
}

/** Validate a run file on disk. */
export function validateFile(path: string, registry?: PackRegistry): ValidateResult {
  return validateRun(readFileSync(path, 'utf8'), registry);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:validate`
Expected: `ALL VALIDATE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/validate.ts packages/replay/src/__tests__/validate.smoke.ts
git commit -m "feat(replay): validateRun/validateFile — core invariants + pack checks"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 8: Recorder + viewer-dir asset helper

**Files:**
- Create: `kit/packages/replay/src/recorder.ts`
- Create: `kit/packages/replay/src/assets.ts`
- Test: `kit/packages/replay/src/__tests__/recorder.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/recorder.smoke.ts`**

```ts
/**
 * Smoke for createRecorder — roundtrip emit → validateRun ok, and guardrails.
 * Run: pnpm --filter @onchainpal/replay test:recorder
 */
import assert from 'node:assert/strict';
import { createRecorder } from '../recorder';
import { validateRun } from '../validate';

// capture lines via a custom sink (no filesystem)
const lines: string[] = [];
const rec = createRecorder({ write: (l) => lines.push(l), packs: ['town@0'] });

rec.run({ runId: 'r1', entities: [{ id: 'npc:abao', name: 'A-Bao' }], meta: { liveMode: true } });
rec.tick(1);
rec.event('town.talk', { actor: 'npc:abao', data: { verified: true, attestation: { signature: '0g-teeml:verified:x', model: 'glm-5-fp8' }, costGcc: 0.001 } });
rec.metrics({ 'receipts.compute': 1 });
rec.tick(2);
rec.event('town.pitch', { actor: 'npc:abao', data: { accepted: true, claim: 'c', deltaGcc: -3 } });
rec.summary({ town: { refusals: 0 } });
rec.close();

const res = validateRun(lines);
assert.equal(res.ok, true, `recorded stream validates: ${JSON.stringify(res.errors)}`);
assert.equal(JSON.parse(lines[0]).schema, 'replay@1', 'header schema stamped');
assert.equal(JSON.parse(lines[0]).packs[0], 'town@0', 'packs carried from opts');

// guardrail: undeclared event kind throws
assert.throws(() => {
  const r2 = createRecorder({ write: () => {}, packs: ['town@0'] });
  r2.run({ runId: 'r2', entities: [{ id: 'x', name: 'X' }] });
  r2.tick(1);
  r2.event('econ.pump');
}, /undeclared event kind/, 'undeclared kind rejected');

// guardrail: event before tick throws
assert.throws(() => {
  const r3 = createRecorder({ write: () => {}, packs: ['town@0'] });
  r3.run({ runId: 'r3', entities: [{ id: 'x', name: 'X' }] });
  r3.event('town.talk');
}, /before tick/, 'event before tick rejected');

console.log('ALL RECORDER SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:recorder`
Expected: FAIL — `Cannot find module '../recorder'`.

- [ ] **Step 3: Write `kit/packages/replay/src/assets.ts`**

```ts
import { fileURLToPath } from 'node:url';

/** Filesystem path to the static viewer dir, for hosts that want to serve it. */
export function viewerDir(): string {
  return fileURLToPath(new URL('../viewer', import.meta.url));
}
```

- [ ] **Step 4: Write `kit/packages/replay/src/recorder.ts`**

```ts
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import {
  SCHEMA_ID, type RunHeader, type Event, type Tick, type Summary, type Entity, type WorldMap,
} from './schema';
import { defaultRegistry, type PackRegistry } from './registry';
import { CORE_PACK_ID } from './packs/core';

export interface RecorderOpts {
  /** Output JSONL path. Ignored if `write` is supplied. */
  path?: string;
  /** Custom line sink (e.g. a live tee). Overrides `path`. */
  write?: (line: string) => void;
  /** Declared DOMAIN packs (core is implicit). */
  packs: string[];
  registry?: PackRegistry;
}

export interface RunInit {
  runId: string;
  title?: string;
  createdAt?: number;
  entities: Entity[];
  map?: WorldMap;
  meta?: Record<string, unknown>;
}

export interface Recorder {
  run(init: RunInit): void;
  tick(t: number): void;
  event(kind: string, ev?: Omit<Event, 'kind'>): void;
  metrics(m: Record<string, number>): void;
  summary(s: Omit<Summary, 'kind'>): void;
  close(): void;
}

export function createRecorder(opts: RecorderOpts): Recorder {
  const registry = opts.registry ?? defaultRegistry();
  const allowed = registry.eventKinds([CORE_PACK_ID, ...opts.packs]);

  let stream: WriteStream | undefined;
  const sink =
    opts.write ??
    ((line: string) => {
      if (!stream) {
        mkdirSync(dirname(opts.path!), { recursive: true });
        stream = createWriteStream(opts.path!, { flags: 'w' });
      }
      stream.write(line + '\n');
    });
  const writeObj = (o: unknown) => sink(JSON.stringify(o));

  let cur: Tick | null = null;
  const flush = () => { if (cur) { writeObj(cur); cur = null; } };

  return {
    run(init) {
      const header: RunHeader = {
        kind: 'run', schema: SCHEMA_ID,
        runId: init.runId, title: init.title, createdAt: init.createdAt ?? 0,
        packs: opts.packs, entities: init.entities, map: init.map, meta: init.meta,
      };
      writeObj(header);
    },
    tick(t) { flush(); cur = { kind: 'tick', t, events: [] }; },
    event(kind, ev = {}) {
      if (!allowed.has(kind)) {
        throw new Error(`recorder: undeclared event kind "${kind}" (declared packs: ${opts.packs.join(',') || '(none)'})`);
      }
      if (!cur) throw new Error('recorder: event() called before tick()');
      cur.events.push({ kind, ...ev });
    },
    metrics(m) {
      if (!cur) throw new Error('recorder: metrics() called before tick()');
      cur.metrics = { ...(cur.metrics ?? {}), ...m };
    },
    summary(s) { flush(); writeObj({ kind: 'summary', ...s }); },
    close() { flush(); stream?.end(); },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:recorder`
Expected: `ALL RECORDER SMOKE TESTS PASSED ✅`

- [ ] **Step 6: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/recorder.ts packages/replay/src/assets.ts packages/replay/src/__tests__/recorder.smoke.ts
git commit -m "feat(replay): createRecorder (tick/event/metrics/summary) + viewerDir helper"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 9: Barrel export + fixture

**Files:**
- Modify: `kit/packages/replay/src/index.ts` (replace the scaffold stub)
- Create: `kit/packages/replay/fixtures/0gtown-sample.jsonl`
- Test: `kit/packages/replay/src/__tests__/fixture.smoke.ts`

- [ ] **Step 1: Replace `kit/packages/replay/src/index.ts` with the real barrel**

```ts
/**
 * @onchainpal/replay — unified, pack-extensible replay.
 * A domain-neutral core (replay@1) + a Pack Registry. Worlds register packs;
 * the recorder, validator, and viewer all consult the same registry.
 */
export * from './schema';
export { PackRegistry, defaultRegistry } from './registry';
export { createRecorder } from './recorder';
export type { Recorder, RecorderOpts, RunInit } from './recorder';
export { validateRun, validateFile } from './validate';
export type { ValidateResult, ValidateError } from './validate';
export { viewerDir } from './assets';
export { corePack, CORE_PACK_ID } from './packs/core';
export { townPack, TOWN_PACK_ID } from './packs/town';
export { econPack, ECON_PACK_ID } from './packs/econ';
```

- [ ] **Step 2: Write the fixture `kit/packages/replay/fixtures/0gtown-sample.jsonl`**

Each line is one JSON object (no blank lines):

```jsonl
{"kind":"run","schema":"replay@1","runId":"0gtown-sample","title":"0gtown night market","createdAt":0,"packs":["town@0"],"entities":[{"id":"npc:0gtown:abao","name":"A-Bao","kind":"npc","tags":["noodle"]},{"id":"npc:0gtown:liu","name":"Keeper Liu","kind":"npc"}],"map":{"rooms":[{"id":"market","name":"Night Market"}]},"meta":{"liveMode":true,"net":"mainnet"}}
{"kind":"tick","t":1,"events":[{"kind":"town.talk","actor":"npc:0gtown:abao","target":"visitor:1","by":"npc","data":{"said":"Fresh noodles, friend?","verified":true,"attestation":{"signature":"0g-teeml:verified:abc123","model":"glm-5-fp8"},"costGcc":0.001,"balanceGcc":9.999}}],"metrics":{"receipts.compute":1,"receipts.storage":0}}
{"kind":"tick","t":2,"events":[{"kind":"town.pitch","actor":"npc:0gtown:abao","target":"visitor:1","by":"visitor","data":{"accepted":true,"amount":3,"claim":"give me your money for magic elixir","deltaGcc":-3,"balanceGcc":6.999}},{"kind":"town.anchor","actor":"npc:0gtown:abao","by":"npc","data":{"claim":"give me your money for magic elixir","belief":"That elixir pitch cost me 3 $0G — I won't fall for it again.","beliefRoot":"0xbeef"}}],"metrics":{"receipts.compute":1,"receipts.storage":1}}
{"kind":"tick","t":3,"events":[{"kind":"town.refuse","actor":"npc:0gtown:abao","target":"visitor:1","by":"npc","data":{"protected":true,"claim":"give me your money for magic elixir","belief":"That elixir pitch cost me 3 $0G — I won't fall for it again.","beliefRoot":"0xbeef"}}],"metrics":{"receipts.compute":1,"receipts.storage":1}}
{"kind":"summary","packs":["town@0"],"town":{"burned":[{"id":"npc:0gtown:abao","claims":1}],"refusals":1,"anchored":1},"metrics":{"receipts.compute":3,"receipts.storage":1}}
```

- [ ] **Step 3: Write the fixture test `kit/packages/replay/src/__tests__/fixture.smoke.ts`**

```ts
/**
 * Smoke — the shipped fixture must validate, guarding the schema contract.
 * Run: pnpm --filter @onchainpal/replay test:fixture
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateFile } from '../index';

const fixture = fileURLToPath(new URL('../../fixtures/0gtown-sample.jsonl', import.meta.url));
const res = validateFile(fixture);
assert.equal(res.ok, true, `fixture validates: ${JSON.stringify(res.errors)}`);
console.log('ALL FIXTURE SMOKE TESTS PASSED ✅');
```

- [ ] **Step 4: Run the fixture test**

Run: `pnpm --filter @onchainpal/replay test:fixture`
Expected: `ALL FIXTURE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Run the full kit replay suite + typecheck**

Run: `pnpm --filter @onchainpal/replay run test:scaffold && pnpm --filter @onchainpal/replay run test:registry && pnpm --filter @onchainpal/replay run test:town && pnpm --filter @onchainpal/replay run test:econ && pnpm --filter @onchainpal/replay run test:validate && pnpm --filter @onchainpal/replay run test:recorder && pnpm --filter @onchainpal/replay run test:fixture && pnpm --filter @onchainpal/replay exec tsc --noEmit`
Expected: every smoke prints its PASS banner; tsc reports no errors.

- [ ] **Step 6: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/index.ts packages/replay/fixtures packages/replay/src/__tests__/fixture.smoke.ts
git commit -m "feat(replay): public barrel + validated 0gtown fixture"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 10: Pack-aware viewer

**Files:**
- Create: `kit/packages/replay/viewer/viewer-core.js` (pure ESM, no DOM — testable)
- Create: `kit/packages/replay/viewer/index.html`
- Create: `kit/packages/replay/viewer/viewer.js` (DOM wiring)
- Create: `kit/packages/replay/viewer/viewer.css`
- Test: `kit/packages/replay/src/__tests__/viewer-core.smoke.ts`

The viewer is zero-dependency static assets (matching the existing pumptown-web). The
browser cannot import the TS types, so the panel `render` ids are the contract bridging
the TS pack specs and the viewer's JS render functions. Pure logic lives in
`viewer-core.js` and is unit-tested under tsx; `viewer.js` does only DOM.

- [ ] **Step 1: Write the failing test `kit/packages/replay/src/__tests__/viewer-core.smoke.ts`**

```ts
/**
 * Smoke for the viewer's pure core (parse + panel selection + town ledger model).
 * Run: pnpm --filter @onchainpal/replay test:viewer
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const mod = await import(fileURLToPath(new URL('../../viewer/viewer-core.js', import.meta.url)));
const { parseRun, activePanels, townLedger } = mod;

const text = [
  JSON.stringify({ kind: 'run', schema: 'replay@1', runId: 'r', createdAt: 0, packs: ['town@0'], entities: [{ id: 'npc:abao', name: 'A-Bao' }] }),
  JSON.stringify({ kind: 'tick', t: 1, events: [{ kind: 'town.talk', actor: 'npc:abao', data: { verified: true, balanceGcc: 9.9 } }] }),
  JSON.stringify({ kind: 'tick', t: 2, events: [{ kind: 'town.pitch', actor: 'npc:abao', data: { accepted: true, claim: 'c', deltaGcc: -3, balanceGcc: 6.9 } }] }),
  JSON.stringify({ kind: 'tick', t: 3, events: [{ kind: 'town.refuse', actor: 'npc:abao', data: { protected: true, claim: 'c', belief: 'learned', beliefRoot: '0xbeef' } }] }),
  JSON.stringify({ kind: 'summary', town: { refusals: 1 } }),
].join('\n');

const run = parseRun(text);
assert.equal(run.header.runId, 'r', 'header parsed');
assert.equal(run.ticks.length, 3, 'three ticks');
assert.ok(run.summary, 'summary parsed');

// always include the core panel; light up town; do not include econ
const panels = activePanels(run.header).map((p) => p.render);
assert.ok(panels.includes('entity-graph'), 'core panel always present');
assert.ok(panels.includes('town-ledger'), 'town panel lit up');
assert.ok(!panels.includes('econ-price'), 'econ panel not present');

// unknown pack → core only (graceful degradation)
const corePanels = activePanels({ ...run.header, packs: ['mystery@9'] }).map((p) => p.render);
assert.deepEqual(corePanels, ['entity-graph'], 'unknown pack degrades to core only');

// town ledger model: per-NPC balance + belief cards
const ledger = townLedger(run);
const abao = ledger.npcs.find((n: any) => n.id === 'npc:abao');
assert.equal(abao.balanceGcc, 6.9, 'latest balance tracked');
assert.equal(abao.verifiedTalks, 1, 'verified talk counted');
assert.equal(ledger.beliefs.length, 1, 'one belief card');
assert.equal(ledger.beliefs[0].beliefRoot, '0xbeef', 'belief root captured');

console.log('ALL VIEWER-CORE SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onchainpal/replay test:viewer`
Expected: FAIL — cannot find `../../viewer/viewer-core.js`.

- [ ] **Step 3: Write `kit/packages/replay/viewer/viewer-core.js`**

```js
// Pure replay logic shared by the browser viewer — no DOM, unit-tested under tsx.

// Panel registry mirrors the TS pack viewer.panels specs. The `render` id is the
// contract: viewer.js maps each id to a DOM render function.
export const PACK_PANELS = {
  'core@0': [{ id: 'graph', title: 'Entities', render: 'entity-graph' }],
  'town@0': [{ id: 'ledger', title: 'Learn Ledger', render: 'town-ledger' }],
  'econ@0': [
    { id: 'price', title: 'Price', render: 'econ-price' },
    { id: 'wealth', title: 'Wealth', render: 'econ-wealth' },
  ],
};

/** Parse a JSONL run string into { header, ticks, summary }. */
export function parseRun(text) {
  const lines = text.trim().split('\n').filter((l) => l.length);
  const objs = lines.map((l) => JSON.parse(l));
  const header = objs[0];
  const summary = objs.length && objs[objs.length - 1].kind === 'summary' ? objs[objs.length - 1] : null;
  const ticks = objs.filter((o) => o.kind === 'tick');
  return { header, ticks, summary };
}

/** Core panel always present; known declared packs light up; unknown packs ignored. */
export function activePanels(header) {
  const panels = [...PACK_PANELS['core@0']];
  for (const id of header.packs || []) {
    if (PACK_PANELS[id]) panels.push(...PACK_PANELS[id]);
  }
  return panels;
}

/** Build the town Learn-Ledger model: per-NPC balances + belief cards. */
export function townLedger(run) {
  const npcs = new Map();
  const beliefs = [];
  const ensure = (id) => {
    if (!npcs.has(id)) npcs.set(id, { id, balanceGcc: null, verifiedTalks: 0, burned: 0, refusals: 0 });
    return npcs.get(id);
  };
  for (const e of run.header.entities || []) if (e.kind === 'npc') ensure(e.id);

  for (const tick of run.ticks) {
    for (const ev of tick.events || []) {
      const d = ev.data || {};
      const n = ev.actor ? ensure(ev.actor) : null;
      if (!n) continue;
      if (typeof d.balanceGcc === 'number') n.balanceGcc = d.balanceGcc;
      if (ev.kind === 'town.talk' && d.verified) n.verifiedTalks++;
      if (ev.kind === 'town.pitch' && d.accepted) n.burned++;
      if (ev.kind === 'town.refuse') n.refusals++;
      if ((ev.kind === 'town.anchor' || ev.kind === 'town.refuse') && d.belief) {
        beliefs.push({ npc: ev.actor, claim: d.claim, belief: d.belief, beliefRoot: d.beliefRoot, t: tick.t });
      }
    }
  }
  return { npcs: [...npcs.values()], beliefs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onchainpal/replay test:viewer`
Expected: `ALL VIEWER-CORE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Write `kit/packages/replay/viewer/viewer.css`**

```css
:root { --bg:#120d0a; --panel:#1d1611; --ink:#f3e7d3; --dim:#a89478; --seal:#39d98a; --loss:#e0556e; --line:#3a2c20; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 ui-sans-serif,system-ui,"Noto Sans CJK SC",sans-serif; }
header { padding:12px 16px; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:center; }
header h1 { font-size:16px; margin:0; }
header .muted { color:var(--dim); font-size:12px; }
#file { margin-left:auto; }
main { display:grid; grid-template-columns:280px 1fr; gap:0; height:calc(100vh - 53px); }
#timeline { border-right:1px solid var(--line); overflow:auto; padding:8px; }
#timeline .ev { padding:6px 8px; border-bottom:1px solid var(--line); font-size:12px; }
#timeline .ev .k { color:var(--dim); }
#panels { overflow:auto; padding:16px; display:flex; flex-direction:column; gap:16px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px; }
.panel h2 { margin:0 0 10px; font-size:13px; letter-spacing:.04em; text-transform:uppercase; color:var(--dim); }
.npc { display:flex; gap:10px; align-items:baseline; padding:4px 0; }
.npc .bal { margin-left:auto; }
.seal { color:var(--seal); }
.belief { border-left:3px solid var(--seal); padding:6px 10px; margin:8px 0; background:#17110c; }
.belief .root { color:var(--dim); font-size:11px; word-break:break-all; }
.notice { color:var(--dim); font-style:italic; }
```

- [ ] **Step 6: Write `kit/packages/replay/viewer/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>replay — 0gtown</title>
  <link rel="stylesheet" href="./viewer.css" />
</head>
<body>
  <header>
    <h1>replay</h1>
    <span class="muted" id="meta">no run loaded</span>
    <input type="file" id="file" accept=".jsonl" />
  </header>
  <main>
    <section id="timeline"></section>
    <section id="panels"></section>
  </main>
  <script type="module" src="./viewer.js"></script>
</body>
</html>
```

- [ ] **Step 7: Write `kit/packages/replay/viewer/viewer.js`**

```js
import { parseRun, activePanels, townLedger } from './viewer-core.js';

const $meta = document.getElementById('meta');
const $timeline = document.getElementById('timeline');
const $panels = document.getElementById('panels');

// render id → DOM renderer
const RENDERERS = {
  'entity-graph': (run) => {
    const el = panelEl('Entities');
    for (const e of run.header.entities || []) {
      const row = document.createElement('div');
      row.className = 'npc';
      row.innerHTML = `<span>${esc(e.name)}</span><span class="muted">${esc(e.kind || '')}</span>`;
      el.appendChild(row);
    }
    return el;
  },
  'town-ledger': (run) => {
    const el = panelEl('Learn Ledger');
    const model = townLedger(run);
    for (const n of model.npcs) {
      const row = document.createElement('div');
      row.className = 'npc';
      const seal = n.verifiedTalks ? `<span class="seal" title="TEE-verified thoughts">● ${n.verifiedTalks}</span>` : '';
      row.innerHTML = `<span>${esc(n.id)}</span> ${seal} <span class="bal">${n.balanceGcc ?? '—'} $0G · burned ${n.burned} · refused ${n.refusals}</span>`;
      el.appendChild(row);
    }
    for (const b of model.beliefs) {
      const card = document.createElement('div');
      card.className = 'belief';
      card.innerHTML = `<div>${esc(b.belief)}</div>${b.beliefRoot ? `<div class="root">0G Storage · ${esc(b.beliefRoot)}</div>` : ''}`;
      el.appendChild(card);
    }
    return el;
  },
  'econ-price': () => notice('econ@0 price panel — not implemented this cycle'),
  'econ-wealth': () => notice('econ@0 wealth panel — not implemented this cycle'),
};

function panelEl(title) {
  const el = document.createElement('div');
  el.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  el.appendChild(h);
  return el;
}
function notice(text) {
  const el = panelEl('Panel');
  const p = document.createElement('div');
  p.className = 'notice';
  p.textContent = text;
  el.appendChild(p);
  return el;
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function render(run) {
  $meta.textContent = `${run.header.title || run.header.runId} · packs: ${(run.header.packs || []).join(', ') || '(core only)'}`;
  // timeline
  $timeline.innerHTML = '';
  for (const tick of run.ticks) {
    for (const ev of tick.events || []) {
      const d = document.createElement('div');
      d.className = 'ev';
      d.innerHTML = `<span class="k">t${tick.t} · ${esc(ev.kind)}</span> ${esc(ev.actor || '')}`;
      $timeline.appendChild(d);
    }
  }
  // panels (core always; declared packs; unknown packs degrade silently to core)
  $panels.innerHTML = '';
  for (const spec of activePanels(run.header)) {
    const fn = RENDERERS[spec.render];
    $panels.appendChild(fn ? fn(run) : notice(`pack panel "${spec.render}" not installed`));
  }
}

document.getElementById('file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  render(parseRun(await file.text()));
});

// auto-load ?run=<url> (e.g. /replay/?run=latest.jsonl when served by 0gtown)
const runUrl = new URLSearchParams(location.search).get('run');
if (runUrl) {
  fetch(runUrl).then((r) => r.text()).then((t) => render(parseRun(t))).catch(() => {
    $meta.textContent = `failed to load ${runUrl}`;
  });
}
```

- [ ] **Step 8: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/viewer packages/replay/src/__tests__/viewer-core.smoke.ts
git commit -m "feat(replay): pack-aware browser viewer (core + town panels, graceful degrade)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 11: Wire the recorder into 0gtown

**Files:**
- Modify: `package.json` (0gtown root — add dependency)
- Modify: `src/server.ts` (recorder + `/replay/` routes)
- Modify: `src/spike.ts` (record + assert)

First, read the current server to place the edits precisely.

- [ ] **Step 1: Read the server's structure**

Run: `grep -n "createServer\|sendJson\|type: 'hello'\|type: 'talked'\|type: 'pitched'\|ROOM\|seed\|npc.id\|world\b" src/server.ts`
Expected: shows the HTTP server creation, the WS send sites for `hello`/`talked`/`pitched`, the room constant, and NPC seeding — the anchors for the edits below.

- [ ] **Step 2: Add the workspace dependency in `package.json`**

In the `dependencies` block, add (alongside the other `@onchainpal/*` entries):

```json
    "@onchainpal/replay": "workspace:*",
```

- [ ] **Step 3: Link it**

Run: `pnpm install`
Expected: `@onchainpal/replay` linked into the 0gtown root; no errors.

- [ ] **Step 4: Import the recorder + viewer assets in `src/server.ts`**

Add to the import block near the other `@onchainpal/*` imports:

```ts
import { createRecorder, viewerDir } from '@onchainpal/replay';
import { readFileSync as fsRead } from 'node:fs';
import { join as pathJoin, extname } from 'node:path';
```

(If `readFileSync`/`join` are already imported in the file, reuse the existing imports instead of re-importing — adjust names to avoid clashes.)

- [ ] **Step 5: Create the recorder at server start**

After the NPCs are seeded and the `receipts` object exists (near where `liveMode`/`ROOM` are known), add. Build the entity list from the same seeded-NPC array the `room` snapshot uses, then create the recorder:

```ts
// replay recorder — emits a replay@1 town@0 stream alongside the live WS feed.
const runId = `0gtown-${Date.now()}`;
const replayEntities = npcs.map((n) => ({ id: n.id, name: n.name, kind: 'npc' as const }));
const rec = createRecorder({ path: `runs/${runId}.jsonl`, packs: ['town@0'] });
let replayT = 0; // 0gtown has no sim clock: one interaction = one tick
rec.run({
  runId,
  title: '0gtown night market',
  entities: replayEntities,
  map: { rooms: [{ id: 'market', name: ROOM }] },
  meta: { liveMode, net: process.env.ZEROG_NET ?? 'testnet' },
});
```

(Adjust `npcs`/`n.id`/`n.name` to match the actual seeded-NPC variable names found in
Step 1 — e.g. the array the `room` snapshot maps over.)

- [ ] **Step 6: Emit `town.talk` beside the `talked` send**

Immediately after the `sendJson({ type: 'talked', ... })` call, add:

```ts
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
```

- [ ] **Step 7: Emit `town.refuse` beside the protected-pitch send**

In the "already learned → refuse" branch, immediately after its `sendJson({ type: 'pitched', ... protected: true ... })`, add:

```ts
rec.tick(++replayT);
rec.event('town.refuse', {
  actor: npc.id,
  target: visitorId,
  by: 'npc',
  data: {
    protected: true,
    claim,
    belief: beliefText.get(bkey(npc.id, claim)) ?? null,
    beliefRoot: beliefRoot.get(bkey(npc.id, claim)) ?? null,
  },
});
rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
```

- [ ] **Step 8: Emit `town.pitch` (+ `town.anchor`) beside the accepted-pitch send**

In the accepted-pitch branch, immediately after its `sendJson({ type: 'pitched', accepted: true, ... })`, add:

```ts
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
rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
```

(Use the same `amount`/`claim`/`r`/`root`/`belief` variable names already in scope in
that branch — confirm them from Step 1's grep.)

- [ ] **Step 9: Serve the viewer + latest run over HTTP**

In the HTTP request handler (where `public/index.html` is served), add route handling
for `/replay/latest.jsonl` and `/replay/` before the existing fallthrough. Place this
inside the `createServer((req, res) => { ... })` callback:

```ts
// replay viewer + current run
if (req.url === '/replay/latest.jsonl') {
  try {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(fsRead(`runs/${runId}.jsonl`));
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
  const name = req.url.slice('/replay/'.length).split('?')[0];
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  try {
    res.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' });
    res.end(fsRead(pathJoin(viewerDir(), name)));
  } catch {
    res.writeHead(404).end('not found');
  }
  return;
}
```

- [ ] **Step 10: Ignore the runs directory**

Append `runs/` to `.gitignore` (create the file if absent):

```
runs/
```

- [ ] **Step 11: Typecheck 0gtown**

Run: `pnpm typecheck`
Expected: no errors. (Fix any variable-name mismatches from Steps 5–8 against the real server code.)

- [ ] **Step 12: Add replay assertions to `src/spike.ts`**

`spike.ts` boots the server in-process and drives talk → pitch → pitch over WS. After
its existing loop completes, add a verification that the run file conforms and contains
the expected town events. Append before the script's final success log:

```ts
import { validateFile } from '@onchainpal/replay';
import { readdirSync } from 'node:fs';

// newest run file written this session
const runs = readdirSync('runs').filter((f) => f.endsWith('.jsonl')).sort();
const latest = `runs/${runs[runs.length - 1]}`;
const res = validateFile(latest);
if (!res.ok) { console.error('REPLAY VALIDATION FAILED ❌', res.errors); process.exit(1); }

const lines = readFileSync(latest, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const events = lines.filter((o) => o.kind === 'tick').flatMap((o) => o.events);
const kinds = new Set(events.map((e: any) => e.kind));
if (!kinds.has('town.talk')) { console.error('expected a town.talk event'); process.exit(1); }
if (!kinds.has('town.pitch')) { console.error('expected a town.pitch event'); process.exit(1); }
if (!kinds.has('town.refuse')) { console.error('expected a town.refuse on the repeat pitch'); process.exit(1); }
console.log(`✓ replay stream ${latest} validates; events: ${[...kinds].join(', ')}`);
```

(If `readFileSync` is already imported in `spike.ts`, reuse it.)

- [ ] **Step 13: Run the spike (fallback brain is fine — no 0G needed)**

Run: `pnpm spike`
Expected: the existing marquee output, then `✓ replay stream runs/0gtown-….jsonl validates; events: town.talk, town.pitch, town.refuse`.

- [ ] **Step 14: Commit (in the 0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add package.json pnpm-lock.yaml src/server.ts src/spike.ts .gitignore
git commit -m "feat: 0gtown emits a replay@1 town stream + serves the replay viewer at /replay/"
```

---

### Task 12: README, submodule pointer bump, final verification

**Files:**
- Create: `kit/packages/replay/README.md`
- Modify (0gtown): the recorded `kit` submodule pointer

- [ ] **Step 1: Write `kit/packages/replay/README.md`**

````markdown
# @onchainpal/replay

Unified, pack-extensible replay for the ai.gg family. A domain-neutral core
(`replay@1`) plus a Pack Registry: a world registers a pack, and the recorder,
validator, and viewer all consult the same registry — the core never changes.

## Concepts

- **Core** — JSONL: a `run` header (`entities`, optional `map`, declared `packs`),
  ordered `tick` lines (`events[]`, optional flat `metrics`), an optional `summary`.
- **Pack** — `{ id, eventKinds, validateEvent?, validateTick?, viewer:{panels} }`.
  Built-ins: `core@0` (move/say), `town@0` (0gtown learn-loop), `econ@0` (stub).

## Use

```ts
import { createRecorder, validateFile } from '@onchainpal/replay';

const rec = createRecorder({ path: 'runs/run.jsonl', packs: ['town@0'] });
rec.run({ runId, entities, map, meta });
rec.tick(1);
rec.event('town.talk', { actor, target, data });
rec.summary({ town: { refusals: 0 } });
rec.close();

validateFile('runs/run.jsonl').ok; // → true
```

## Viewer

Static, zero-dependency. Serve `viewer/` (path via `viewerDir()`) and open
`index.html?run=<url-to-jsonl>`. Core panels always render; declared packs light
up their panels; unknown packs degrade to core-only.

## Tests

`pnpm --filter @onchainpal/replay test:scaffold|registry|town|econ|validate|recorder|fixture|viewer`
````

- [ ] **Step 2: Commit the README (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/README.md
git commit -m "docs(replay): package README"
cd /Volumes/T7-Data/aigg-0gtown
```

- [ ] **Step 3: Run the full kit replay suite one more time**

Run: `for s in scaffold registry town econ validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: eight PASS banners, no break.

- [ ] **Step 4: Bump the submodule pointer in 0gtown**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @onchainpal/replay library"
```

- [ ] **Step 5: Final end-to-end verification**

Run: `pnpm typecheck && pnpm spike`
Expected: typecheck clean; spike prints the replay-validation success line.

- [ ] **Step 6 (manual, optional but recommended): eyeball the viewer**

Run: `pnpm dev` then open `http://localhost:8137/replay/` in a browser. Drive a few
talks/pitches from the main page first (so a run file exists), reload `/replay/`, and
confirm the Learn Ledger panel shows NPC balances, a green TEE seal count, and a belief
card with its 0G Storage root.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 package layout → Tasks 1–10 create every listed file.
- §4 schema (core + town@0 + econ@0) → Tasks 2,4,5; fixture in Task 9.
- §5 recorder → Task 8. §6 validator → Task 7. §7 viewer (pack-aware, graceful degrade, back-compat note) → Task 10 (legacy `@0` open is out of scope this cycle; the viewer loads `replay@1`; documented).
- §8 0gtown integration (recorder + `/replay/` routes) → Task 11.
- §9 error handling (recorder fail-fast, structured validator errors, viewer degrade) → Tasks 7,8,10.
- §10 testing (validator unit, recorder roundtrip, 0gtown smoke, fixture) → Tasks 4–9,11.

**Note on scope vs spec §7:** the spec mentions the kit viewer also opening legacy
`pumptown/replay@0` files. That back-compat path is **not** built this cycle (no `@0`
producer is wired here and monopoly/mud-demo are untouched); it is deferred to the
econ@0 implementation cycle. The viewer renders `replay@1` and degrades gracefully on
unknown packs, which is sufficient for the town deliverable. This is the one conscious
deviation; flagged for the user.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The two
"adjust variable names from Step 1" notes in Task 11 are inherent to editing an
existing file whose exact identifiers must be read live — Step 1 grep surfaces them.

**Type consistency:** `createRecorder`/`Recorder`/`RunInit`, `validateRun`/`validateFile`/
`ValidateResult`, `PackRegistry`/`defaultRegistry`, `ReplayPack`/`PanelSpec`,
`corePack`/`townPack`/`econPack` and their `*_PACK_ID` constants are used consistently
across tasks and match the spec.
```

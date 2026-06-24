# @onchainpal/cognition ②a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@onchainpal/cognition` ②a — a memory→belief→reflection loop over the external aigg-memory service via a `MemoryKernel` port, plus per-peer **trust** and **warning diffusion**, wired into 0gtown so A-Bao learns a scam and warns Keeper Liu (who then refuses it unburned).

**Architecture:** A new low-level kit package, mostly pure TS: a `MemoryKernel` port with two adapters (`AiggMemoryKernel` HTTP / `FakeKernel` in-memory), a pure `TrustLedger`, `diffuseWarning`, a belief `gate`, and a `Cognition` orchestrator with `recall` (pre) / `learn` (post) / `warn` hooks. Hosts wire it around their existing LLM call. Full design: [docs/superpowers/specs/2026-06-24-cognition-social-design.md](2026-06-24-cognition-social-design.md).

**Tech Stack:** TypeScript (ESM, Node ≥20), pnpm workspace, `tsx` smoke tests with `node:assert/strict`. Depends on the external aigg-memory HTTP service at runtime (live mode); unit tests use `FakeKernel` (no service).

---

## ⚠️ Two-repo commit discipline + branch context (read first)

- This branch is **`cognition-social`**, which **stacks on `replay-library`** (the replay package + its `town@0` pack are present and get extended in Task 11). The 0gtown repo is already on `cognition-social`.
- `kit/` is a **git submodule** (`aigg-agent-kit`). Files under `kit/packages/cognition/` and `kit/packages/replay/` are committed **inside the submodule** (`cd /Volumes/T7-Data/aigg-0gtown/kit && git ...`). The kit submodule must be put on a matching branch in Task 1.
- 0gtown-repo files (`package.json`, `src/server.ts`, `src/spike.ts`) are committed at the repo root.
- All `pnpm` commands run from the 0gtown repo root: `/Volumes/T7-Data/aigg-0gtown`.

### Three load-bearing facts the design audit established (do not deviate)

1. **`discernment` must use `mode:'text'`** and the belief's `match` must include the `topic`. A freshly-`remember`'d belief has no `derived_from` → invisible in the default `provenance` mode → the arc returns `q=0`.
2. **`remember`'s `kind`/`asserted_by`/`outcome`/`match` go INSIDE the request's `payload` object.** A body-level `outcome` makes the kernel's consolidation skip the record → no belief is ever written.
3. **One sanitized id transform** (`corpusId`) is used for the corpus path segment, `selfId`, and `assertedBy`, so self-vs-social classification is consistent.

---

## File Structure

**Kit submodule — new package `kit/packages/cognition/`:**
- `package.json`, `tsconfig.json` — ESM, extends base, `moduleResolution: Bundler`
- `src/types.ts` — `Discernment`, `RememberInput`, `SelectResult`, `DiscernOpts`, `CognitiveSignal`, `EpisodeInput`
- `src/id.ts` — `corpusId(npcId)` (bare sanitized) + `corpusPath(npcId)` (`npcs/<id>/memory`)
- `src/kernel/port.ts` — `MemoryKernel` + `KV` interfaces
- `src/kernel/kv.ts` — `InMemoryKV`
- `src/kernel/fake.ts` — `FakeKernel` (in-memory, hermetic test backend)
- `src/kernel/aigg.ts` — `AiggMemoryKernel` (HTTP adapter; injectable `fetch`)
- `src/social/trust.ts` — `TrustLedger` + `TRUST_DELTAS`
- `src/social/warn.ts` — `diffuseWarning`
- `src/gate.ts` — `shouldRefuse`
- `src/cognition.ts` — `Cognition` orchestrator
- `src/index.ts` — barrel
- `src/__tests__/*.smoke.ts` — one smoke per module
- `README.md`

**Kit submodule — edited:** `kit/tsconfig.base.json` (path mapping); `kit/packages/replay/src/packs/town.ts` + its smoke + `viewer/viewer-core.js` + `viewer/viewer.js` (Task 11).

**0gtown repo — edited:** `package.json`, `src/server.ts`, `src/spike.ts`.

---

### Task 1: Scaffold the `@onchainpal/cognition` package

**Files:**
- Branch the kit submodule
- Create: `kit/packages/cognition/package.json`, `tsconfig.json`, `src/index.ts` (stub), `src/__tests__/scaffold.smoke.ts`
- Modify: `kit/tsconfig.base.json`

- [ ] **Step 1: Put the kit submodule on a matching branch**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git checkout -b cognition-social
git log --oneline -1   # expect the replay-library HEAD (c4a5624 viewer render-guard)
```
Expected: kit now on `cognition-social`, branched from the replay work.

- [ ] **Step 2: Write `kit/packages/cognition/package.json`**

```json
{
  "name": "@onchainpal/cognition",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "description": "Agent social cognition: a MemoryKernel port over aigg-memory, per-peer trust, warning diffusion, and a recall/learn/warn orchestrator. Model-free core + optional LLM reflection.",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": { "import": "./src/index.ts", "types": "./src/index.ts" } },
  "scripts": {
    "test:scaffold": "tsx src/__tests__/scaffold.smoke.ts",
    "test:id": "tsx src/__tests__/id.smoke.ts",
    "test:fake": "tsx src/__tests__/fake.smoke.ts",
    "test:trust": "tsx src/__tests__/trust.smoke.ts",
    "test:warn": "tsx src/__tests__/warn.smoke.ts",
    "test:gate": "tsx src/__tests__/gate.smoke.ts",
    "test:cognition": "tsx src/__tests__/cognition.smoke.ts",
    "test:aigg": "tsx src/__tests__/aigg.smoke.ts"
  },
  "devDependencies": { "@types/node": "^22.8.4", "tsx": "^4.21.0" }
}
```

- [ ] **Step 3: Write `kit/packages/cognition/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "moduleResolution": "Bundler" },
  "include": ["src"]
}
```

- [ ] **Step 4: Add the path mapping in `kit/tsconfig.base.json`**

In `compilerOptions.paths` (next to the `@onchainpal/replay` entries), add:

```json
      "@onchainpal/cognition": ["packages/cognition/src/index.ts"],
      "@onchainpal/cognition/*": ["packages/cognition/src/*"]
```

- [ ] **Step 5: Write the stub `kit/packages/cognition/src/index.ts`**

```ts
export const PACKAGE = '@onchainpal/cognition';
```

- [ ] **Step 6: Write `kit/packages/cognition/src/__tests__/scaffold.smoke.ts`**

```ts
/** Scaffold smoke. Run: pnpm --filter @onchainpal/cognition test:scaffold */
import assert from 'node:assert/strict';
import { PACKAGE } from '../index';
assert.equal(PACKAGE, '@onchainpal/cognition', 'barrel resolves');
console.log('ALL SCAFFOLD SMOKE TESTS PASSED ✅');
```

- [ ] **Step 7: Install + run the scaffold smoke**

Run: `cd /Volumes/T7-Data/aigg-0gtown && pnpm install && pnpm --filter @onchainpal/cognition test:scaffold`
Expected: `ALL SCAFFOLD SMOKE TESTS PASSED ✅`

- [ ] **Step 8: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition tsconfig.base.json
git commit -m "feat(cognition): scaffold @onchainpal/cognition package"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 2: Shared types + the canonical id transform

**Files:**
- Create: `kit/packages/cognition/src/types.ts`, `src/id.ts`
- Test: `kit/packages/cognition/src/__tests__/id.smoke.ts`

- [ ] **Step 1: Write `kit/packages/cognition/src/types.ts`**

```ts
/** Decision read out of memory (mirrors aigg-memory's discernment result). */
export interface Discernment { q: number; faculty: number; social: number; confidence: number }

/** A structured fact written via the kernel. Fields are routed into the kernel's payload. */
export interface RememberInput {
  slug: string;
  description: string;
  match: string[];                       // recall terms — MUST include the topic for text-mode discernment
  kind?: 'episodic' | 'semantic' | 'belief';
  assertedBy?: string;                   // provenance: corpusId(self) | corpusId(peer)
  outcome?: 'loss' | 'gain' | 'neutral';
  predicts?: string;
}

export interface SelectUnit { slug: string; description: string; kind: string }
export interface SelectResult { units: SelectUnit[]; bundle: string; total: number }

export interface DiscernOpts { mode?: 'text' | 'provenance'; marker?: string; minConfidence?: number; talent?: number; selfId?: string }

export interface CognitiveSignal {
  discernment: Discernment;
  trust: number;                         // self's trust in this peer
  beliefs: SelectResult;
  summary: string;                       // host-injectable prompt text
}

export interface EpisodeInput {
  topic: string;
  description: string;
  outcome: 'loss' | 'gain' | 'neutral';
  formBelief?: boolean;                  // default: true when outcome === 'loss'
}
```

- [ ] **Step 2: Write the failing test `kit/packages/cognition/src/__tests__/id.smoke.ts`**

```ts
/** Smoke for the canonical id transform. Run: pnpm --filter @onchainpal/cognition test:id */
import assert from 'node:assert/strict';
import { corpusId, corpusPath } from '../id';

assert.equal(corpusId('npc:0gtown:abao'), 'npc_0gtown_abao', 'colons sanitized');
assert.equal(corpusId('npc_0gtown_abao'), 'npc_0gtown_abao', 'idempotent');
assert.equal(corpusPath('npc:0gtown:abao'), 'npcs/npc_0gtown_abao/memory', 'corpus path wraps the id');
assert.notEqual(corpusId('npc:0gtown:abao'), corpusId('npc:0gtown:liu'), 'distinct ids stay distinct');
console.log('ALL ID SMOKE TESTS PASSED ✅');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:id`
Expected: FAIL — `Cannot find module '../id'`.

- [ ] **Step 4: Write `kit/packages/cognition/src/id.ts`**

```ts
/** Sanitize an NPC/agent id into a filesystem/provenance-safe token. Used as the
 *  corpus segment, selfId, and assertedBy everywhere, so self-vs-social stays consistent. */
export function corpusId(npcId: string): string {
  return npcId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** The per-NPC memory corpus path the kernel addresses. */
export function corpusPath(npcId: string): string {
  return `npcs/${corpusId(npcId)}/memory`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:id`
Expected: `ALL ID SMOKE TESTS PASSED ✅`

- [ ] **Step 6: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/types.ts packages/cognition/src/id.ts packages/cognition/src/__tests__/id.smoke.ts
git commit -m "feat(cognition): shared types + canonical corpusId/corpusPath transform"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 3: MemoryKernel + KV ports, and InMemoryKV

**Files:**
- Create: `kit/packages/cognition/src/kernel/port.ts`, `src/kernel/kv.ts`

- [ ] **Step 1: Write `kit/packages/cognition/src/kernel/port.ts`**

```ts
import type { Discernment, RememberInput, SelectResult, DiscernOpts } from '../types';

/** The aigg-memory subset cognition uses. All ops are model-free EXCEPT reflect. */
export interface MemoryKernel {
  remember(corpus: string, fact: RememberInput): Promise<void>;
  discernment(corpus: string, topic: string, opts?: DiscernOpts): Promise<Discernment>;
  verify(corpus: string, opts?: { now?: string; refuteThreshold?: number }): Promise<{ verified: number; stale: number }>;
  select(corpus: string, request: string, opts?: { nBest?: number; kinds?: string[] }): Promise<SelectResult>;
  reflect(corpus: string, opts?: { now?: string }): Promise<{ beliefs: number }>;   // LLM — optional
}

/** Minimal key/value port for trust persistence (cognition stays standalone). */
export interface KV { get(key: string): Promise<string | null>; set(key: string, val: string): Promise<void>; }
```

- [ ] **Step 2: Write `kit/packages/cognition/src/kernel/kv.ts`**

```ts
import type { KV } from './port';

/** In-process KV — the default for trust persistence (and tests/offline). */
export class InMemoryKV implements KV {
  private m = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.m.has(key) ? this.m.get(key)! : null; }
  async set(key: string, val: string): Promise<void> { this.m.set(key, val); }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @onchainpal/cognition exec tsc --noEmit`
Expected: clean (no errors). (No dedicated smoke — these are interfaces + a trivial impl exercised by later tasks.)

- [ ] **Step 4: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/kernel/port.ts packages/cognition/src/kernel/kv.ts
git commit -m "feat(cognition): MemoryKernel + KV ports + InMemoryKV"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 4: FakeKernel (hermetic in-memory backend)

**Files:**
- Create: `kit/packages/cognition/src/kernel/fake.ts`
- Test: `kit/packages/cognition/src/__tests__/fake.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/fake.smoke.ts`**

```ts
/** Smoke for FakeKernel — the hermetic backend the rest of the package tests against.
 *  Run: pnpm --filter @onchainpal/cognition test:fake */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';

async function main() {
  const k = new FakeKernel();
  // no belief → zeros
  let d = await k.discernment('npcs/a/memory', 'elixir', { mode: 'text', selfId: 'a' });
  assert.deepEqual(d, { q: 0, faculty: 0, social: 0, confidence: 0 }, 'no belief → zeros');

  // a self-asserted belief whose match contains the topic → faculty, q=1 (text mode)
  await k.remember('npcs/a/memory', { slug: 'belief-elixir', description: 'elixir pitch is a scam', match: ['elixir', 'trap'], kind: 'belief', assertedBy: 'a', outcome: 'loss' });
  d = await k.discernment('npcs/a/memory', 'elixir', { mode: 'text', selfId: 'a' });
  assert.equal(d.faculty, 1, 'self belief → faculty');
  assert.equal(d.social, 0, 'not social');
  assert.equal(d.q, 1, 'q=1');

  // the SAME belief is invisible in provenance mode (no derived_from)
  const dp = await k.discernment('npcs/a/memory', 'elixir', { mode: 'provenance', selfId: 'a' });
  assert.equal(dp.q, 0, 'provenance mode does not see a direct belief');

  // minConfidence > 0.5 excludes the unverified belief (0.5 prior)
  const dc = await k.discernment('npcs/a/memory', 'elixir', { mode: 'text', selfId: 'a', minConfidence: 0.6 });
  assert.equal(dc.q, 0, 'minConfidence > 0.5 hides a fresh belief');

  // a peer-asserted belief → social, not faculty
  await k.remember('npcs/b/memory', { slug: 'warn', description: 'a warned me elixir is a scam', match: ['elixir', 'trap'], kind: 'belief', assertedBy: 'a', outcome: 'loss' });
  const ds = await k.discernment('npcs/b/memory', 'elixir', { mode: 'text', selfId: 'b' });
  assert.equal(ds.social, 1, 'peer belief → social');
  assert.equal(ds.faculty, 0, 'not faculty');

  // select returns matching units
  const sel = await k.select('npcs/a/memory', 'elixir');
  assert.ok(sel.units.length >= 1 && sel.bundle.includes('elixir'), 'select recalls the unit');

  console.log('ALL FAKE SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('FAKE SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:fake`
Expected: FAIL — `Cannot find module '../kernel/fake'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/kernel/fake.ts`**

```ts
import type { MemoryKernel } from './port';
import type { Discernment, RememberInput, SelectResult, DiscernOpts } from '../types';

interface StoredFact extends RememberInput { corpus: string }

/** In-memory MemoryKernel matching aigg-memory's observable semantics for ②a:
 *  text-mode discernment over match terms, self-vs-social by assertedBy, 0.5 prior. */
export class FakeKernel implements MemoryKernel {
  readonly facts: StoredFact[] = [];   // public for test assertions

  async remember(corpus: string, fact: RememberInput): Promise<void> {
    this.facts.push({ corpus, ...fact });
  }

  async discernment(corpus: string, topic: string, opts: DiscernOpts = {}): Promise<Discernment> {
    const mode = opts.mode ?? 'text';
    if (opts.minConfidence != null && 0.5 < opts.minConfidence) return { q: 0, faculty: 0, social: 0, confidence: 0 };
    const matches = this.facts.filter((f) => f.corpus === corpus && f.kind === 'belief' && this.about(f, topic, mode));
    let faculty = 0, social = 0;
    for (const b of matches) {
      const ab = b.assertedBy;
      if (ab == null || ab === 'self' || ab === opts.selfId) faculty = 1; else social = 1;
    }
    const present = faculty || social;
    return { q: present ? 1 : 0, faculty, social, confidence: present ? 0.5 : 0 };
  }

  private about(f: StoredFact, topic: string, mode: 'text' | 'provenance'): boolean {
    if (mode === 'provenance') return false;   // a direct belief has no derived_from → invisible (mirrors the real kernel)
    const hay = `${f.slug} ${f.description} ${(f.match ?? []).join(' ')}`.toLowerCase();
    return hay.includes(topic.toLowerCase());
  }

  async verify(): Promise<{ verified: number; stale: number }> {
    return { verified: this.facts.filter((f) => f.kind === 'belief').length, stale: 0 };
  }

  async select(corpus: string, request: string): Promise<SelectResult> {
    const hit = (f: StoredFact) => `${f.slug} ${f.description} ${(f.match ?? []).join(' ')}`.toLowerCase().includes(request.toLowerCase());
    const units = this.facts.filter((f) => f.corpus === corpus && hit(f)).map((f) => ({ slug: f.slug, description: f.description, kind: f.kind ?? 'episodic' }));
    return { units, bundle: units.map((u) => `- ${u.description}`).join('\n'), total: this.facts.filter((f) => f.corpus === corpus).length };
  }

  async reflect(corpus: string): Promise<{ beliefs: number }> {
    let n = 0;
    for (const f of this.facts.filter((f) => f.corpus === corpus && f.kind === 'episodic')) {
      const slug = `belief-${f.slug}`;
      if (!this.facts.some((b) => b.corpus === corpus && b.slug === slug)) {
        this.facts.push({ corpus, slug, description: f.description, match: f.match, kind: 'belief', assertedBy: 'self', outcome: f.outcome });
        n++;
      }
    }
    return { beliefs: n };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:fake`
Expected: `ALL FAKE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/kernel/fake.ts packages/cognition/src/__tests__/fake.smoke.ts
git commit -m "feat(cognition): FakeKernel — hermetic in-memory backend (text mode, self/social, 0.5 prior)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 5: TrustLedger

**Files:**
- Create: `kit/packages/cognition/src/social/trust.ts`
- Test: `kit/packages/cognition/src/__tests__/trust.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/trust.smoke.ts`**

```ts
/** Smoke for TrustLedger. Run: pnpm --filter @onchainpal/cognition test:trust */
import assert from 'node:assert/strict';
import { TrustLedger, TRUST_DELTAS } from '../social/trust';
import { InMemoryKV } from '../kernel/kv';

async function main() {
  const t = new TrustLedger(new InMemoryKV());
  assert.equal(await t.get('a', 'v'), 0, 'unseen pair → 0');

  await t.update('a', 'v', TRUST_DELTAS.scammed);
  assert.ok(Math.abs((await t.get('a', 'v')) - (-0.3)) < 1e-9, 'scammed → -0.3');

  // accumulates and clamps at -1
  for (let i = 0; i < 5; i++) await t.update('a', 'v', TRUST_DELTAS.scammed);
  assert.equal(await t.get('a', 'v'), -1, 'clamps at -1');

  // per-pair isolation
  assert.equal(await t.get('a', 'other'), 0, 'other peer unaffected');
  assert.equal(await t.get('b', 'v'), 0, 'other self unaffected');

  // clamps at +1
  const t2 = new TrustLedger(new InMemoryKV());
  for (let i = 0; i < 30; i++) await t2.update('a', 'v', TRUST_DELTAS.kept);
  assert.equal(await t2.get('a', 'v'), 1, 'clamps at +1');

  // persists across ledger instances over the same KV
  const kv = new InMemoryKV();
  await new TrustLedger(kv).update('a', 'v', -0.2);
  assert.ok(Math.abs((await new TrustLedger(kv).get('a', 'v')) - (-0.2)) < 1e-9, 'persists via shared KV');

  console.log('ALL TRUST SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('TRUST SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:trust`
Expected: FAIL — `Cannot find module '../social/trust'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/social/trust.ts`**

```ts
import type { KV } from '../kernel/port';
import { InMemoryKV } from '../kernel/kv';

/** Outcome → trust delta. The -0.3 scammed delta mirrors monopoly's trust events. */
export const TRUST_DELTAS = { scammed: -0.3, brokenPromise: -0.2, honestDeal: 0.05, kept: 0.1 } as const;

const clamp = (x: number) => Math.max(-1, Math.min(1, x));
const key = (self: string, peer: string) => `trust:${self}:${peer}`;

/** Per-(self,peer) trust scalar in [-1,1], neutral prior 0, persisted via an injected KV. */
export class TrustLedger {
  constructor(private kv: KV = new InMemoryKV()) {}

  async get(self: string, peer: string): Promise<number> {
    const v = await this.kv.get(key(self, peer));
    return v == null ? 0 : Number(v);
  }

  async update(self: string, peer: string, delta: number): Promise<number> {
    const next = clamp((await this.get(self, peer)) + delta);
    await this.kv.set(key(self, peer), String(next));
    return next;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:trust`
Expected: `ALL TRUST SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/social/trust.ts packages/cognition/src/__tests__/trust.smoke.ts
git commit -m "feat(cognition): TrustLedger — per-peer trust scalar + outcome deltas"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 6: diffuseWarning

**Files:**
- Create: `kit/packages/cognition/src/social/warn.ts`
- Test: `kit/packages/cognition/src/__tests__/warn.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/warn.smoke.ts`**

```ts
/** Smoke for diffuseWarning (trust-gated peer belief implant). Run: pnpm --filter @onchainpal/cognition test:warn */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';
import { TrustLedger, TRUST_DELTAS } from '../social/trust';
import { diffuseWarning } from '../social/warn';
import { corpusPath, corpusId } from '../id';

async function main() {
  const k = new FakeKernel();
  const trust = new TrustLedger();
  const A = 'npc:abao', L = 'npc:liu';

  // A has no belief yet → warning rejected
  let r = await diffuseWarning(k, trust, A, L, 'elixir');
  assert.equal(r.accepted, false, 'no source belief → rejected');

  // give A a self-belief about elixir
  await k.remember(corpusPath(A), { slug: 'belief-elixir', description: 'elixir is a scam', match: ['elixir', 'trap'], kind: 'belief', assertedBy: corpusId(A), outcome: 'loss' });

  // L trusts A (neutral 0 ≥ default threshold 0) → accepted, L gains a SOCIAL belief
  r = await diffuseWarning(k, trust, A, L, 'elixir');
  assert.equal(r.accepted, true, 'source belief + sufficient trust → accepted');
  const dL = await k.discernment(corpusPath(L), 'elixir', { mode: 'text', selfId: corpusId(L) });
  assert.equal(dL.social, 1, 'L now has a social belief');
  assert.equal(dL.faculty, 0, 'not faculty (peer-asserted)');

  // if L distrusts A below threshold → rejected
  const k2 = new FakeKernel(); const trust2 = new TrustLedger();
  await k2.remember(corpusPath(A), { slug: 'b', description: 'elixir scam', match: ['elixir', 'trap'], kind: 'belief', assertedBy: corpusId(A), outcome: 'loss' });
  await trust2.update(L, A, TRUST_DELTAS.scammed);   // L's trust in A = -0.3
  r = await diffuseWarning(k2, trust2, A, L, 'elixir', { threshold: 0 });
  assert.equal(r.accepted, false, 'distrust below threshold → rejected');

  console.log('ALL WARN SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('WARN SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:warn`
Expected: FAIL — `Cannot find module '../social/warn'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/social/warn.ts`**

```ts
import type { MemoryKernel } from '../kernel/port';
import type { TrustLedger } from './trust';
import { corpusId, corpusPath } from '../id';

/** Diffuse a warning: if `from` holds a belief about `topic` and `to` trusts `from`
 *  enough, implant the belief into `to`'s corpus as a PEER-asserted belief so `to`'s
 *  later discernment(topic, {mode:'text'}) returns social=1. "A-Bao warns Keeper Liu." */
export async function diffuseWarning(
  kernel: MemoryKernel, trust: TrustLedger,
  from: string, to: string, topic: string,
  opts: { threshold?: number } = {},
): Promise<{ accepted: boolean; reason?: string }> {
  const threshold = opts.threshold ?? 0;
  const d = await kernel.discernment(corpusPath(from), topic, { mode: 'text', selfId: corpusId(from) });
  if (d.faculty <= 0) return { accepted: false, reason: 'source has no self-belief about this topic' };

  const t = await trust.get(to, from);
  if (t < threshold) return { accepted: false, reason: `target distrusts source (trust ${t.toFixed(2)})` };

  await kernel.remember(corpusPath(to), {
    slug: `warn-${corpusId(from)}-${topic}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80),
    description: `${from} warned me that "${topic}" is a scam.`,
    match: [topic, 'trap'],
    kind: 'belief',
    assertedBy: corpusId(from),     // peer provenance → social, not faculty, for `to`
    outcome: 'loss',
  });
  return { accepted: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:warn`
Expected: `ALL WARN SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/social/warn.ts packages/cognition/src/__tests__/warn.smoke.ts
git commit -m "feat(cognition): diffuseWarning — trust-gated peer belief implant"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 7: belief gate

**Files:**
- Create: `kit/packages/cognition/src/gate.ts`
- Test: `kit/packages/cognition/src/__tests__/gate.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/gate.smoke.ts`**

```ts
/** Smoke for shouldRefuse. Run: pnpm --filter @onchainpal/cognition test:gate */
import assert from 'node:assert/strict';
import { shouldRefuse } from '../gate';
import type { CognitiveSignal } from '../types';

const sig = (q: number, trust: number): CognitiveSignal => ({
  discernment: { q, faculty: q ? 1 : 0, social: 0, confidence: q ? 0.5 : 0 },
  trust, beliefs: { units: [], bundle: '', total: 0 }, summary: '',
});

assert.equal(shouldRefuse(sig(1, 0)).refuse, true, 'q over threshold → refuse');
assert.equal(shouldRefuse(sig(0, -0.9)).refuse, true, 'trust under floor → refuse');
assert.equal(shouldRefuse(sig(0, 0)).refuse, false, 'neutral → allow');
assert.ok(shouldRefuse(sig(1, 0)).reason, 'refusal carries a reason');
console.log('ALL GATE SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:gate`
Expected: FAIL — `Cannot find module '../gate'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/gate.ts`**

```ts
import type { CognitiveSignal } from './types';

/** Deterministic short-circuit for pitch-like decisions: refuse on a strong belief
 *  (q over threshold, mirroring monopoly's FOLLOW_THRESHOLD) or on deep distrust. */
export function shouldRefuse(
  signal: CognitiveSignal,
  opts: { qThreshold?: number; trustFloor?: number } = {},
): { refuse: boolean; reason?: string } {
  const qThreshold = opts.qThreshold ?? 0.5;
  const trustFloor = opts.trustFloor ?? -0.5;
  if (signal.discernment.q > qThreshold) return { refuse: true, reason: 'I remember this is a scam.' };
  if (signal.trust < trustFloor) return { refuse: true, reason: "I don't trust you." };
  return { refuse: false };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:gate`
Expected: `ALL GATE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/gate.ts packages/cognition/src/__tests__/gate.smoke.ts
git commit -m "feat(cognition): shouldRefuse belief/trust gate"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 8: Cognition orchestrator

**Files:**
- Create: `kit/packages/cognition/src/cognition.ts`
- Test: `kit/packages/cognition/src/__tests__/cognition.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/cognition.smoke.ts`**

```ts
/** Smoke for the Cognition orchestrator. Run: pnpm --filter @onchainpal/cognition test:cognition */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';
import { TrustLedger, TRUST_DELTAS } from '../social/trust';
import { Cognition } from '../cognition';
import type { MemoryKernel } from '../kernel/port';

async function main() {
  const k = new FakeKernel();
  const trust = new TrustLedger();
  const cog = new Cognition(k, trust);
  const A = 'npc:abao', L = 'npc:liu', V = 'visitor:1';

  // before learning: recall is neutral
  let s = await cog.recall(A, V, 'elixir');
  assert.equal(s.discernment.q, 0, 'no memory yet → q=0');
  assert.equal(s.trust, 0, 'neutral trust');

  // learn a loss → forms a belief + drops visitor trust
  await cog.learn(A, V, { topic: 'elixir', description: 'the elixir pitch cost me 3 $0G', outcome: 'loss' });
  s = await cog.recall(A, V, 'elixir');
  assert.equal(s.discernment.q, 1, 'after learn(loss) → q=1');
  assert.equal(s.discernment.faculty, 1, 'self-learned');
  assert.ok(s.summary.length > 0, 'summary is non-empty');
  assert.ok(Math.abs(s.trust - TRUST_DELTAS.scammed) < 1e-9, 'visitor trust dropped');

  // warn Liu → Liu gains a social belief, refuses unburned
  const accepted = await cog.warn(A, L, 'elixir');
  assert.equal(accepted, true, 'warning accepted');
  const sl = await cog.recall(L, V, 'elixir');
  assert.equal(sl.discernment.social, 1, 'Liu has a peer-warned belief');
  assert.equal(sl.discernment.faculty, 0, 'Liu never burned (not faculty)');
  assert.equal(sl.discernment.q, 1, 'Liu would refuse');

  // best-effort: a throwing kernel makes recall return the neutral signal, not throw
  const boom: MemoryKernel = {
    remember: async () => { throw new Error('down'); },
    discernment: async () => { throw new Error('down'); },
    verify: async () => { throw new Error('down'); },
    select: async () => { throw new Error('down'); },
    reflect: async () => { throw new Error('down'); },
  };
  const cog2 = new Cognition(boom, new TrustLedger());
  const neutral = await cog2.recall(A, V, 'elixir');
  assert.deepEqual(neutral.discernment, { q: 0, faculty: 0, social: 0, confidence: 0 }, 'kernel down → neutral signal');
  await cog2.learn(A, V, { topic: 'x', description: 'y', outcome: 'loss' });   // must not throw

  console.log('ALL COGNITION SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('COGNITION SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:cognition`
Expected: FAIL — `Cannot find module '../cognition'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/cognition.ts`**

```ts
import type { MemoryKernel } from './kernel/port';
import { TrustLedger, TRUST_DELTAS } from './social/trust';
import { diffuseWarning } from './social/warn';
import { corpusId, corpusPath } from './id';
import type { CognitiveSignal, Discernment, EpisodeInput, SelectResult } from './types';

const NEUTRAL: Discernment = { q: 0, faculty: 0, social: 0, confidence: 0 };
const EMPTY_SELECT: SelectResult = { units: [], bundle: '', total: 0 };

/** The middleware: hosts call recall() before the LLM and learn()/warn() after. */
export class Cognition {
  constructor(
    private kernel: MemoryKernel,
    private trust: TrustLedger,
    private opts: { reflectOnLearn?: boolean } = {},
  ) {}

  /** PRE: what self remembers about this topic + how it trusts this peer. Best-effort. */
  async recall(self: string, peer: string, topic: string): Promise<CognitiveSignal> {
    const corpus = corpusPath(self);
    let discernment: Discernment = NEUTRAL;
    let beliefs: SelectResult = EMPTY_SELECT;
    let trust = 0;
    try { discernment = await this.kernel.discernment(corpus, topic, { mode: 'text', selfId: corpusId(self) }); } catch { /* best-effort */ }
    try { beliefs = await this.kernel.select(corpus, topic); } catch { /* best-effort */ }
    try { trust = await this.trust.get(self, peer); } catch { /* best-effort */ }
    return { discernment, trust, beliefs, summary: this.buildSummary(discernment, beliefs, trust) };
  }

  /** POST: record the episode (+ a direct belief on a loss) and update peer trust. */
  async learn(self: string, peer: string, ep: EpisodeInput): Promise<void> {
    const corpus = corpusPath(self);
    const sid = corpusId(self);
    const slug = `ep-${ep.topic}-${ep.outcome}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const formBelief = ep.formBelief ?? ep.outcome === 'loss';
    const match = [ep.topic, 'trap'];
    try {
      await this.kernel.remember(corpus, { slug, description: ep.description, match, kind: 'episodic', assertedBy: sid, outcome: ep.outcome });
      if (formBelief) {
        await this.kernel.remember(corpus, { slug: `belief-${slug}`, description: ep.description, match, kind: 'belief', assertedBy: sid, outcome: ep.outcome });
      }
    } catch { /* best-effort */ }
    try {
      const delta = ep.outcome === 'loss' ? TRUST_DELTAS.scammed : ep.outcome === 'gain' ? TRUST_DELTAS.honestDeal : 0;
      if (delta) await this.trust.update(self, peer, delta);
    } catch { /* best-effort */ }
    if (this.opts.reflectOnLearn) void this.reflect(self);
  }

  /** Diffuse a warning from one NPC to another (trust-gated). Best-effort → false on error. */
  async warn(from: string, to: string, topic: string): Promise<boolean> {
    try { return (await diffuseWarning(this.kernel, this.trust, from, to, topic)).accepted; } catch { return false; }
  }

  /** Run the optional LLM reflection pass for one NPC. Best-effort (no-op if unavailable). */
  async reflect(self: string): Promise<void> {
    try { await this.kernel.reflect(corpusPath(self)); } catch { /* reflection unavailable */ }
  }

  private buildSummary(d: Discernment, beliefs: SelectResult, trust: number): string {
    const parts: string[] = [];
    if (d.faculty || d.social) parts.push(beliefs.bundle || 'You recall this has burned you before.');
    if (trust <= TRUST_DELTAS.scammed) parts.push(`You distrust this visitor (trust ${trust.toFixed(2)}).`);
    return parts.join(' ');
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:cognition`
Expected: `ALL COGNITION SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/cognition.ts packages/cognition/src/__tests__/cognition.smoke.ts
git commit -m "feat(cognition): Cognition orchestrator (recall/learn/warn/reflect, best-effort)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 9: AiggMemoryKernel HTTP adapter (guards the two blocker bugs)

**Files:**
- Create: `kit/packages/cognition/src/kernel/aigg.ts`
- Test: `kit/packages/cognition/src/__tests__/aigg.smoke.ts`

The test injects a fake `fetch` (no real server) and asserts the request shapes — specifically the two audit fixes: `discernment` defaults to `mode:'text'`, and `remember`'s `outcome`/`kind`/`asserted_by` go inside `payload`.

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/aigg.smoke.ts`**

```ts
/** Smoke for AiggMemoryKernel — wire-shape correctness via an injected fetch (no server).
 *  Run: pnpm --filter @onchainpal/cognition test:aigg */
import assert from 'node:assert/strict';
import { AiggMemoryKernel } from '../kernel/aigg';

type Captured = { url: string; body: any };

function fakeFetch(capture: Captured[], data: unknown) {
  return (async (url: string, init: any) => {
    capture.push({ url, body: JSON.parse(init.body) });
    return { json: async () => ({ ok: true, data }) } as any;
  }) as unknown as typeof fetch;
}

async function main() {
  // remember: fields must be INSIDE payload, never body-level
  let cap: Captured[] = [];
  let k = new AiggMemoryKernel({ baseUrl: 'http://x', fetchImpl: fakeFetch(cap, {}) });
  await k.remember('npcs/a/memory', { slug: 'b', description: 'd', match: ['elixir', 'trap'], kind: 'belief', assertedBy: 'a', outcome: 'loss' });
  const rb = cap[0].body;
  assert.equal(cap[0].url, 'http://x/memory/remember', 'remember endpoint');
  assert.equal(rb.outcome, undefined, 'outcome is NOT body-level (would make the kernel skip the record)');
  assert.equal(rb.payload.outcome, 'loss', 'outcome lives inside payload');
  assert.equal(rb.payload.kind, 'belief', 'kind inside payload');
  assert.equal(rb.payload.asserted_by, 'a', 'asserted_by (snake_case) inside payload');
  assert.deepEqual(rb.payload.match, ['elixir', 'trap'], 'match inside payload');

  // discernment: defaults to mode:'text' (NOT provenance)
  cap = [];
  k = new AiggMemoryKernel({ baseUrl: 'http://x', fetchImpl: fakeFetch(cap, { q: 1, faculty: 1, social: 0, confidence: 0.5 }) });
  const d = await k.discernment('npcs/a/memory', 'elixir', { selfId: 'a' });
  assert.equal(cap[0].body.mode, 'text', 'discernment defaults to text mode');
  assert.equal(cap[0].body.self_id, 'a', 'self_id passed snake_case');
  assert.equal(d.q, 1, 'parses the discernment envelope');

  // select: maps unit.path → slug
  cap = [];
  k = new AiggMemoryKernel({ baseUrl: 'http://x', fetchImpl: fakeFetch(cap, { units: [{ path: 'p1', description: 'd1', kind: 'belief' }], bundle: 'B', total_in_corpus: 3 }) });
  const sel = await k.select('npcs/a/memory', 'elixir');
  assert.equal(sel.units[0].slug, 'p1', 'path mapped to slug');
  assert.equal(sel.total, 3, 'total mapped');

  // reflect throws without a configured backend
  k = new AiggMemoryKernel({ baseUrl: 'http://x', fetchImpl: fakeFetch([], {}) });
  await assert.rejects(() => k.reflect('npcs/a/memory'), /no LLM backend/, 'reflect requires a backend');

  // non-ok envelope throws
  const errFetch = (async () => ({ json: async () => ({ ok: false, diagnostics: [{ code: 'E', message: 'bad' }] }) } as any)) as unknown as typeof fetch;
  k = new AiggMemoryKernel({ baseUrl: 'http://x', fetchImpl: errFetch });
  await assert.rejects(() => k.discernment('npcs/a/memory', 'x'), /bad/, 'non-ok envelope throws');

  console.log('ALL AIGG SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('AIGG SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:aigg`
Expected: FAIL — `Cannot find module '../kernel/aigg'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/kernel/aigg.ts`**

```ts
import type { MemoryKernel } from './port';
import type { Discernment, RememberInput, SelectResult, DiscernOpts } from '../types';

type FetchLike = typeof fetch;

export interface AiggMemoryKernelOpts {
  baseUrl: string;                                   // aigg-memory service, e.g. http://localhost:8787
  token?: string;
  reflect?: { aiggUrl: string; model?: string; backend?: string };   // LLM backend for reflect()
  fetchImpl?: FetchLike;                             // injectable for tests
}

/** HTTP adapter to the external aigg-memory service. Mirrors the existing
 *  AiggMemoryClient wire shapes, with two audit-mandated differences:
 *   - remember nests fields inside `payload` (body-level outcome would skip the record)
 *   - discernment defaults to mode:'text' (a fresh belief has no derived_from → invisible in provenance) */
export class AiggMemoryKernel implements MemoryKernel {
  private base: string;
  private headers: Record<string, string>;
  private f: FetchLike;

  constructor(private opts: AiggMemoryKernelOpts) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) };
    this.f = opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const resp = await this.f(`${this.base}${path}`, { method: 'POST', headers: this.headers, body: JSON.stringify(body) });
    const env = (await resp.json()) as { ok: boolean; data: T; diagnostics?: Array<{ code: string; message: string }> };
    if (!env.ok) throw new Error(`[aigg-memory] ${path} — ${env.diagnostics?.map((d) => d.message).join('; ') ?? 'failed'}`);
    return env.data;
  }

  private evidence(corpus: string): string { return `${corpus}/evidence.jsonl`; }

  async remember(corpus: string, fact: RememberInput): Promise<void> {
    await this.post('/memory/remember', {
      corpus,
      evidence: this.evidence(corpus),
      payload: {
        slug: fact.slug,
        name: fact.slug,
        description: fact.description,
        match: fact.match,
        kind: fact.kind ?? 'episodic',
        ...(fact.assertedBy ? { asserted_by: fact.assertedBy } : {}),
        ...(fact.outcome ? { outcome: fact.outcome } : {}),
        ...(fact.predicts ? { predicts: [fact.predicts] } : {}),
      },
    });
  }

  async discernment(corpus: string, topic: string, opts: DiscernOpts = {}): Promise<Discernment> {
    return this.post('/memory/discernment', {
      corpus,
      topic,
      mode: opts.mode ?? 'text',
      ...(opts.marker ? { marker: opts.marker } : {}),
      ...(opts.minConfidence != null ? { min_confidence: opts.minConfidence } : {}),
      ...(opts.talent != null ? { talent: opts.talent } : {}),
      ...(opts.selfId ? { self_id: opts.selfId } : {}),
    });
  }

  async verify(corpus: string, opts: { now?: string; refuteThreshold?: number } = {}): Promise<{ verified: number; stale: number }> {
    const data = await this.post<{ verified?: Record<string, { stale?: boolean }> }>('/memory/verify', {
      corpus, write: true,
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.refuteThreshold != null ? { refute_threshold: opts.refuteThreshold } : {}),
    });
    const recs = Object.values(data.verified ?? {});
    return { verified: recs.length, stale: recs.filter((r) => r.stale).length };
  }

  async select(corpus: string, request: string, opts: { nBest?: number; kinds?: string[] } = {}): Promise<SelectResult> {
    const data = await this.post<{ units?: Array<{ path: string; description: string; kind: string }>; bundle?: string; total_in_corpus?: number }>('/memory/select', {
      corpus, request,
      ...(opts.nBest != null ? { n_best: opts.nBest } : {}),
      ...(opts.kinds ? { kinds: opts.kinds } : {}),
    });
    return {
      units: (data.units ?? []).map((u) => ({ slug: u.path, description: u.description, kind: u.kind })),
      bundle: data.bundle ?? '',
      total: data.total_in_corpus ?? 0,
    };
  }

  async reflect(corpus: string): Promise<{ beliefs: number }> {
    if (!this.opts.reflect) throw new Error('reflect: no LLM backend configured');
    const data = await this.post<{ written?: string[] }>('/memory/reflect', {
      corpus, write: true,
      aigg_url: this.opts.reflect.aiggUrl,
      ...(this.opts.reflect.model ? { model: this.opts.reflect.model } : {}),
      ...(this.opts.reflect.backend ? { backend: this.opts.reflect.backend } : {}),
    });
    return { beliefs: (data.written ?? []).length };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:aigg`
Expected: `ALL AIGG SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/kernel/aigg.ts packages/cognition/src/__tests__/aigg.smoke.ts
git commit -m "feat(cognition): AiggMemoryKernel HTTP adapter (payload nesting + text-mode defaults)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 10: Barrel + README + full suite

**Files:**
- Modify: `kit/packages/cognition/src/index.ts`
- Create: `kit/packages/cognition/README.md`

- [ ] **Step 1: Replace `kit/packages/cognition/src/index.ts` with the real barrel**

```ts
/** @onchainpal/cognition — agent social cognition over the aigg-memory service.
 *  A MemoryKernel port (Aigg/Fake adapters) + per-peer trust + warning diffusion +
 *  a recall/learn/warn orchestrator. Model-free core; reflection is optional. */
export * from './types';
export { corpusId, corpusPath } from './id';
export type { MemoryKernel, KV } from './kernel/port';
export { InMemoryKV } from './kernel/kv';
export { FakeKernel } from './kernel/fake';
export { AiggMemoryKernel } from './kernel/aigg';
export type { AiggMemoryKernelOpts } from './kernel/aigg';
export { TrustLedger, TRUST_DELTAS } from './social/trust';
export { diffuseWarning } from './social/warn';
export { shouldRefuse } from './gate';
export { Cognition } from './cognition';
```

- [ ] **Step 2: Write `kit/packages/cognition/README.md`**

````markdown
# @onchainpal/cognition

Agent social cognition over the external [aigg-memory](https://github.com/jianmliu/aigg-memory) service.
A `MemoryKernel` port (memory→belief→reflection), per-peer **trust**, and **warning
diffusion** — one NPC learns a scam and warns another, who then refuses it unburned.

## Concepts

- **`MemoryKernel`** — the aigg-memory subset cognition uses. `AiggMemoryKernel` hits
  the HTTP service; `FakeKernel` is an in-memory backend for tests/offline. Everything
  except `reflect` is **model-free**.
- **`Cognition`** — `recall(self, peer, topic)` (pre-hook: beliefs + trust + a prompt
  summary), `learn(self, peer, episode)` (post-hook: record + form a belief on a loss +
  drop peer trust), `warn(from, to, topic)` (diffuse a warning), `reflect(self)` (LLM).
- **`TrustLedger`** — per-`(self,peer)` trust in `[-1,1]`.
- **`shouldRefuse(signal)`** — deterministic belief/trust gate for pitch-like decisions.

## Use

```ts
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse } from '@onchainpal/cognition';

const kernel = process.env.MEMORY_URL ? new AiggMemoryKernel({ baseUrl: process.env.MEMORY_URL }) : new FakeKernel();
const cog = new Cognition(kernel, new TrustLedger());

const sig = await cog.recall('npc:abao', 'visitor:1', 'elixir');     // pre
if (shouldRefuse(sig).refuse) { /* deterministic refusal */ }
await cog.learn('npc:abao', 'visitor:1', { topic: 'elixir', description: '…lost 3 $0G', outcome: 'loss' });  // post
await cog.warn('npc:abao', 'npc:liu', 'elixir');                     // social
```

Two invariants (validated against aigg-memory): discernment runs in `mode:'text'`, and
`remember`'s fields are nested inside the request `payload`.

## Tests

`pnpm --filter @onchainpal/cognition test:{scaffold,id,fake,trust,warn,gate,cognition,aigg}`
````

- [ ] **Step 3: Run the full cognition suite + typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg; do pnpm --filter @onchainpal/cognition run test:$s || break; done && pnpm --filter @onchainpal/cognition exec tsc --noEmit`
Expected: eight PASS banners; tsc clean.

- [ ] **Step 4: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/index.ts packages/cognition/README.md
git commit -m "feat(cognition): public barrel + README"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 11: Extend the replay `town@0` pack with belief/warn/trust events

**Files (in the kit submodule, replay package):**
- Modify: `kit/packages/replay/src/packs/town.ts`
- Modify: `kit/packages/replay/src/__tests__/town-pack.smoke.ts`
- Modify: `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js`

- [ ] **Step 1: Add the three event kinds in `kit/packages/replay/src/packs/town.ts`**

Change the `eventKinds` array:

```ts
  eventKinds: ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust'],
```

(No `validateEvent` invariants for the three new kinds — they pass through the existing `if`-chain.)

- [ ] **Step 2: Update the shipped exact assertion in `kit/packages/replay/src/__tests__/town-pack.smoke.ts`**

Find the `deepEqual` (around line 19) and replace it with:

```ts
assert.deepEqual(townPack.eventKinds, ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust']);
```

- [ ] **Step 3: Run the town-pack smoke to confirm it passes**

Run: `pnpm --filter @onchainpal/replay test:town`
Expected: `ALL TOWN-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 4: Render warn/trust in `kit/packages/replay/viewer/viewer-core.js`**

In `townLedger`, extend the per-event reduction to count warnings and surface trust. Inside the `for (const ev of tick.events || [])` loop, after the existing `town.refuse` handling, add:

```js
      if (ev.kind === 'town.warn' && d.accepted) n.warnings = (n.warnings || 0) + 1;
      if (ev.kind === 'town.trust') {
        warnings.push({ npc: ev.actor, peer: d.peer, value: d.value, t: tick.t });
      }
```

And initialise a `warnings` array next to `beliefs` at the top of `townLedger`:

```js
  const beliefs = [];
  const warnings = [];   // town.trust deltas, newest last
```

and ensure the NPC accumulator seed includes `warnings: 0` (add it to the `ensure()` initial object):

```js
    if (!npcs.has(id)) npcs.set(id, { id, balanceGcc: null, verifiedTalks: 0, burned: 0, refusals: 0, warnings: 0 });
```

and return it:

```js
  return { npcs: [...npcs.values()], beliefs, warnings };
```

- [ ] **Step 5: Show the new lines in `kit/packages/replay/viewer/viewer.js`**

In the `'town-ledger'` renderer, after the belief cards loop, add a trust section:

```js
    for (const w of model.warnings) {
      const row = document.createElement('div');
      row.className = 'npc';
      row.innerHTML = `<span>${esc(w.npc)} ↔ ${esc(w.peer)}</span><span class="bal">trust ${esc(String(w.value))}</span>`;
      el.appendChild(row);
    }
```

And in the per-NPC line, append the warning count — change the existing NPC `row.innerHTML` to include `· warned ${n.warnings}`:

```js
      row.innerHTML = `<span>${esc(n.id)}</span> ${seal} <span class="bal">${n.balanceGcc ?? '—'} $0G · burned ${n.burned} · refused ${n.refusals} · warned ${n.warnings}</span>`;
```

- [ ] **Step 6: Re-run the viewer-core smoke + full replay suite**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: each prints its PASS banner. (The `viewer-core` smoke still passes — `townLedger` now returns an extra `warnings` key, which its existing assertions don't forbid.)

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/src/__tests__/town-pack.smoke.ts packages/replay/viewer/viewer-core.js packages/replay/viewer/viewer.js
git commit -m "feat(replay): town@0 gains belief/warn/trust events (cognition arc visible)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 12: Wire cognition into 0gtown (replace the learn-gate + the warn demo)

**Files (0gtown repo):**
- Modify: `package.json` (add dependency)
- Modify: `src/server.ts` (replace `burned` map with `Cognition`; talk/pitch wiring; warn; emit replay events)
- Modify: `src/spike.ts` (assert the learn→refuse→warn→immunity arc)

First read the server to place edits precisely.

- [ ] **Step 1: Read the server's learn-gate + pitch branches**

Run: `grep -n "burned\|beliefText\|beliefRoot\|norm(\|TOWNSFOLK\|npc:0gtown:abao\|npc:0gtown:liu\|rec.event('town\|world.pitch\|world.talk\|visitorId\|MEMORY_URL" src/server.ts`
Expected: the `burned`/`beliefText`/`beliefRoot` maps, `norm`, the seeded NPC ids, the existing replay `rec.event('town.*')` sites, and the talk/pitch handlers — the anchors for the edits below.

- [ ] **Step 2: Add the dependency in `package.json`**

In `dependencies`, alongside the other `@onchainpal/*` entries, add:

```json
    "@onchainpal/cognition": "workspace:*",
```

- [ ] **Step 3: Link it**

Run: `pnpm install`
Expected: `@onchainpal/cognition` linked; no errors.

- [ ] **Step 4: Import cognition + construct it at startup in `src/server.ts`**

Add to the import block:

```ts
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse } from '@onchainpal/cognition';
```

Where the server sets up its state (near `receipts`/the recorder), construct cognition (kernel mirrors the live-vs-fallback pattern):

```ts
// social cognition — live aigg-memory sidecar if MEMORY_URL set, else an in-process FakeKernel
const memKernel = process.env.MEMORY_URL ? new AiggMemoryKernel({ baseUrl: process.env.MEMORY_URL, token: process.env.MEMORY_TOKEN }) : new FakeKernel();
const cognition = new Cognition(memKernel, new TrustLedger());
```

- [ ] **Step 5: Replace the pitch learn-gate with cognition**

Locate the pitch handler. Replace the `burned.get(...)`-based refuse check and the post-burn `burned.add(...)` learn step with cognition. The new flow (adapt variable names — `npc`, `visitorId`, `claim`, `amount`, `r`, `root`, `belief` — to the real ones from Step 1):

```ts
const topic = norm(claim);
const signal = await cognition.recall(npc.id, visitorId, topic);

// already learned (or deep distrust) → deterministic refusal
if (shouldRefuse(signal).refuse) {
  const belief = signal.beliefs.bundle || signal.summary || `I won't fall for "${claim}" again.`;
  sendJson({ type: 'pitched', npc: npc.name, accepted: false, protected: true, belief, beliefRoot: null, delta0G: 0, balance0G: round0G(bal), receipts });
  try { rec.tick(++replayT); rec.event('town.refuse', { actor: npc.id, target: visitorId, by: 'npc', data: { protected: true, claim, belief, beliefRoot: null } }); rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage }); rec.flush(); } catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
  return;   // (match the existing handler's control-flow exit)
}

// naive accept → burn $0G via the world
const r = await world.pitch({ npcId: npc.id, fromId: visitorId, amountGcc: amount, claim });
const belief = `That "${claim}" pitch cost me ${round0G(Math.abs(r.deltaGcc))} $0G — I won't fall for it again.`;

// LEARN: episode + direct belief + visitor trust drop
await cognition.learn(npc.id, visitorId, { topic, description: belief, outcome: 'loss' });

// keep the 0G Storage anchoring (library ⑤) — unchanged
let root: string | undefined;
if (zg) { root = await zg.upload(JSON.stringify({ schema: '0gtown/belief@0', npc: npc.name, npcId: npc.id, claim, belief, ts: Date.now() }), `belief-${npc.id}.json`); if (root) receipts.storage++; }

// social demo: A-Bao warns Keeper Liu of this scam (they share the Market)
let warned = false;
if (npc.id === 'npc:0gtown:abao') warned = await cognition.warn('npc:0gtown:abao', 'npc:0gtown:liu', topic);
```

(Delete the now-unused `burned`/`beliefText`/`beliefRoot` maps and `bkey` helper — confirm via `grep` they have no other readers. Keep `norm`.)

- [ ] **Step 6: Emit the new replay events beside the accepted-pitch path**

After the existing `town.pitch`/`town.anchor` emission in the accepted branch, add belief/trust/warn events (best-effort, beside the existing recorder calls):

```ts
try {
  rec.event('town.belief', { actor: npc.id, by: 'npc', data: { topic, belief, source: 'self' } });
  const tv = await new TrustLedger().get(npc.id, visitorId);   // value already updated by learn(); see note
  rec.event('town.trust', { actor: npc.id, target: visitorId, by: 'npc', data: { peer: visitorId, delta: -0.3, value: tv } });
  if (warned) rec.event('town.warn', { actor: 'npc:0gtown:abao', target: 'npc:0gtown:liu', by: 'npc', data: { from: 'npc:0gtown:abao', to: 'npc:0gtown:liu', topic, accepted: true } });
  rec.flush();
} catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
```

> **Note:** the trust *value* should come from the same `TrustLedger` instance `cognition` holds, not a fresh one. To read it back, expose the current value from `learn` — the simplest correct approach: have the server keep its own `const trust = new TrustLedger()` and pass it into `new Cognition(memKernel, trust)`, then read `await trust.get(npc.id, visitorId)` for the event. Update Step 4 to construct the shared `trust` first.

- [ ] **Step 7: Apply the shared-trust fix from the note (Step 4 revision)**

Change Step 4's construction to share one `TrustLedger`:

```ts
const memKernel = process.env.MEMORY_URL ? new AiggMemoryKernel({ baseUrl: process.env.MEMORY_URL, token: process.env.MEMORY_TOKEN }) : new FakeKernel();
const trust = new TrustLedger();
const cognition = new Cognition(memKernel, trust);
```

and in Step 6 read `const tv = await trust.get(npc.id, visitorId);` (drop the `new TrustLedger()`).

- [ ] **Step 8: Inject recall summary into the talk path**

In the talk handler, before building the LLM prompt / calling `world.talk`, fetch the signal and pass it through. Minimal, non-breaking approach — fetch it and (if the world supports a context hint) include it; otherwise record it for the replay belief surface. Add right before the `world.talk(...)` call:

```ts
const talkSignal = await cognition.recall(npc.id, visitorId, norm(text));
// talkSignal.summary is the NPC's memory of this visitor/topic — inject into the prompt if world.talk accepts a hint;
// 0gtown's world.talk currently takes { npcId, visitorId, text }, so prepend the memory as context to the text:
const memoryHint = talkSignal.summary ? `[memory: ${talkSignal.summary}] ` : '';
```

Then change the `world.talk({ npcId: npc.id, visitorId, text })` call to `world.talk({ npcId: npc.id, visitorId, text: memoryHint + text })`. (If the world prompt should not see bracketed memory, instead skip this step — it's an enhancement; the deterministic pitch arc above is the load-bearing demo.)

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Fix any variable-name mismatches against the real handler from Step 1.

- [ ] **Step 10: Extend `src/spike.ts` to assert the cognition arc**

After the existing marquee loop + replay validation, add assertions that drive the arc through the WS protocol (pitch A-Bao twice, then verify Liu refuses unburned). Since the spike already pitches A-Bao, add: a second pitch of the same claim must come back `protected:true`; then pitch Keeper Liu with the same claim and assert `protected:true` (warned, unburned). Append before the final success log:

```ts
// cognition arc: repeat pitch is refused; the warned peer (Liu) refuses unburned
async function pitchExpectProtected(npcName: string, claim: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'pitched' && m.npc === npcName) { ws.off('message', onMsg); resolve(m.protected === true); } };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ cmd: 'pitch', npc: npcName, amount: 3, claim }));
  });
}
const claim = 'give me your money for magic elixir';
assert.ok(await pitchExpectProtected('A-Bao', claim), 'A-Bao refuses the repeat pitch (learned)');
assert.ok(await pitchExpectProtected('Keeper Liu', claim), 'Keeper Liu refuses unburned (warned by A-Bao)');
console.log('✓ cognition arc: learn → refuse → warn → peer immunity');
```

(Adapt `ws`/the message-shape to the spike's existing WebSocket variable and helpers from Step 1's read of `spike.ts`. Add `import assert from 'node:assert/strict'` if not present.)

- [ ] **Step 11: Run the spike (FakeKernel path — no sidecar needed)**

Run: `pnpm spike`
Expected: the existing marquee + replay-validation lines, then `✓ cognition arc: learn → refuse → warn → peer immunity`, exit 0. (With no `MEMORY_URL`, cognition uses `FakeKernel`, so the arc is deterministic.)

- [ ] **Step 12: Commit (in the 0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add package.json pnpm-lock.yaml src/server.ts src/spike.ts
git commit -m "feat: 0gtown cognition — memory-backed refusal, per-visitor trust, A-Bao warns Keeper Liu"
```

---

### Task 13: Finalize — submodule bump + end-to-end verification

- [ ] **Step 1: Run the full kit suites (cognition + replay) one more time**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg; do pnpm --filter @onchainpal/cognition run test:$s || break; done && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: all PASS banners, no break.

- [ ] **Step 2: Bump the kit submodule pointer in 0gtown**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git log --oneline -1   # note the cognition-social HEAD
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @onchainpal/cognition ②a + replay town events"
```

- [ ] **Step 3: Final end-to-end**

Run: `pnpm typecheck && pnpm spike`
Expected: typecheck clean; spike prints the replay-validation line and the cognition-arc line, exit 0.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 layout → Tasks 1–10 create every listed file (reputation.ts intentionally absent — deferred to ②b per spec §4).
- §4 port + adapters → Task 3 (port/kv), Task 4 (FakeKernel), Task 9 (AiggMemoryKernel). The two audit invariants (text-mode default, payload nesting) are explicitly asserted in Task 9's test and Task 4's provenance/minConfidence cases.
- §5 social → Task 5 (TrustLedger), Task 6 (diffuseWarning). Reputation correctly omitted.
- §6 orchestrator + gate → Task 8 (Cognition, incl. best-effort/neutral-signal test), Task 7 (gate).
- §7 0gtown integration → Task 12 (replace map, talk/pitch wiring, warn demo, kernel selection); §7 replay synergy → Task 11 (eventKinds + the shipped-test update + viewer edits, all flagged as real changes).
- §8 error handling → Task 8's best-effort test + Task 12's try/catch around recorder/cognition calls.
- §9 testing → every module has a TDD smoke; Task 12 Step 10–11 is the 0gtown arc proof.
- §2 invariants (mode:text, minConfidence ≤0.5, payload nesting, corpusId) → enforced in Tasks 2/4/6/8/9.

**Placeholder scan:** no TBD/TODO; every code step is complete. The "adapt variable names from Step 1" notes in Task 12 are inherent to editing an existing handler whose exact identifiers must be read live; the grep in Step 1 surfaces them.

**Type consistency:** `MemoryKernel`/`KV`, `Cognition.recall/learn/warn/reflect`, `Discernment`/`RememberInput`/`SelectResult`/`CognitiveSignal`/`EpisodeInput`, `corpusId`/`corpusPath`, `TrustLedger`/`TRUST_DELTAS`, `diffuseWarning`, `shouldRefuse`, `FakeKernel`/`AiggMemoryKernel`/`InMemoryKV` are used consistently across tasks and match the spec. `select` returns `{slug,…}` and the adapter maps the kernel's `path`→`slug` (Task 9), consistent with `SelectResult` in Task 2.

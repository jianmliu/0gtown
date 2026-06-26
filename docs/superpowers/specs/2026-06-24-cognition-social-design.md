# Design: `@aigg/cognition` ②a — cognition + social core

**Date:** 2026-06-24
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Home:** `kit/packages/cognition` in the `aigg-agent-kit` submodule
**Branch:** `cognition-social` (stacks on `replay-library` — extends the `town@0` replay pack)

---

## 1. Background & motivation

Second library in the kit-extraction initiative (see [[kit-extraction-initiative]] memory; ① replay shipped). This is **sub-project ②a** of a larger `@aigg/cognition` package the user chose to build in sequence:

- **②a (this spec)** — cognition + social core: the memory→belief→reflection loop plus three social primitives (per-peer trust, warning diffusion, reputation/track-record) and belief-gated decisions.
- **②b (later)** — governance: propose/vote/enact, belief-gated sanctions, blacklist (maps to monopoly `govern.py`).
- **②c (later)** — society: crime/detection/rap-sheet, alliances, lending/default, info-selling (maps to monopoly `society.py`).

②a is the spine: ②b's belief-gated voting and ②c's trust deltas both depend on the beliefs/trust ②a produces.

### Agreed decisions (from brainstorming)

1. **Deliverable = "both"**: a cleanly reusable library AND 0gtown consuming it end-to-end.
2. **Backend = the external aigg-memory service** (not a self-contained TS kernel port). cognition wraps the aigg-memory HTTP kernel via a port; the existing `AiggMemoryClient` in npc-agent already proves the bridge (9 endpoints).
3. **Home = a new package `@aigg/cognition`** (not extending npc-agent in place).
4. **Architecture = Approach A**: a port-based, mostly-pure cognition package with `recall`/`learn` middleware hooks; npc-agent/0gtown wire it around their existing LLM call.

### What already exists (so we don't rebuild it)

- [kit/packages/npc-agent/src/memory/aigg-memory-client.ts](../../../kit/packages/npc-agent/src/memory/aigg-memory-client.ts) — HTTP client with all 9 aigg-memory endpoints (observe/consolidate/remember/ingest/reflect/verify/discernment/plan/select). The TS↔kernel bridge already works.
- [kit/packages/gamekit/src/shared-world.ts](../../../kit/packages/gamekit/src/shared-world.ts) — `talk()`/`pitch()` already call `discernment`/`remember`/`dream`.
- npc-agent `RelationshipState` has `affinity` + `tags`; a `trust` field is **defined but never written**.

### The gaps ②a closes

1. **The social layer** — per-peer **trust** scoring, **warning diffusion** (one NPC learns a scam → implants the belief in a peer, immunity without a burn), **reputation/track-record**. None exists today.
2. **Acting on beliefs** — `LlmAgent.perceive()` is stateless; it never reads beliefs back into the decision. NPCs gate *pitches* on memory but don't *speak* from what they learned.
3. **0gtown bypasses memory entirely** — it uses a shallow `Map<npcId, Set<claim>>` exact-string learn-gate, hand-written belief text, global-per-NPC, no trust, and 0G Storage is narrative-only (never re-read).

### Non-goals (this sub-project)

- Governance (②b) and crime/lending/alliances (②c). Specified later.
- **Reputation / track-record** — deferred to ②b (no aigg-memory HTTP endpoint exists for it; ②b's allocation logic is the natural place to add one). ②a ships only **trust** + **warning diffusion**.
- A self-contained TS re-implementation of the aigg-memory kernel (rejected — we depend on the service).
- Replacing npc-agent's `AiggMemoryClient` or refactoring SharedWorld's existing memory calls. ②a ships its own kernel adapter and 0gtown wires cognition directly; harmonizing with SharedWorld is out of scope.

### Revisions from the design audit (2026-06-24)

An adversarial review against the real `aigg_memory` source found two design-sinking bugs and several wire-level traps, all fixed in this spec: (1) `discernment` must run in **`mode:'text'`** — a freshly-`remember`'d belief has no `derived_from` and is invisible in the default `provenance` mode; (2) `minConfidence` must be **unset or ≤0.5** (the unverified Laplace prior is exactly 0.5); (3) `remember`'s `outcome`/`kind`/`assertedBy`/`match` must go **inside `payload`** (a body-level `outcome` makes the kernel skip the record entirely); (4) corpus/`selfId`/`assertedBy` use one **sanitized** id transform (`corpusId`), not the raw NPC id; (5) `trackRecord` has **no HTTP endpoint** → reputation deferred; (6) extending the replay `town@0` pack is a **real change** (breaks a shipped exact-`deepEqual` test, needs viewer edits), not free.

---

## 2. Chosen approach

**Approach A — port-based pure cognition + middleware wiring.** `@aigg/cognition` defines a `MemoryKernel` port (the aigg-memory subset it needs), pure social primitives, and a `Cognition` orchestrator with a pre-hook (`recall`) and post-hook (`learn`). Hosts wire these around their existing LLM call. The kernel adapter (`AiggMemoryKernel`) and an in-memory `FakeKernel` ship in the package, so cognition is unit-testable with zero external service.

### The load-bearing insight: model-free core + optional LLM reflection

Every kernel operation except `reflect` is **model-free**. So the core arc — *learn a scam → form a belief → refuse → distrust the peer → warn another NPC → that NPC is immune* — runs with **no LLM at all**: `learn` writes a direct `kind:belief` on a decisive loss, which `discernment` reads immediately. `reflect` (LLM) is an **enrichment** that generalizes beliefs ("this *kind* of pitch is a scam") and verifies them over time.

**Two invariants make this true (validated against `aigg_memory/agent.py` — without them the arc silently returns `q=0`):**

1. **`discernment` must run in `mode:'text'` for the direct-belief path.** A freshly-`remember`'d belief has **no `derived_from`**, so it is *invisible* in `provenance` mode (`_about` only matches beliefs whose sources are about the topic). In `text` mode, discernment scans the belief's slug/description/`match` terms — so the belief's `match` must include the `topic`. (The existing `AiggMemoryClient.discernment` defaults to `provenance`; `AiggMemoryKernel` must default to and the orchestrator must pass `text`.)
2. **`discernment`'s `minConfidence` must be unset or `≤ 0.5`.** An unverified belief carries exactly the `0.5` Laplace prior; any `minConfidence > 0.5` excludes fresh beliefs. (The gate's separate `qThreshold` gates `q`, not confidence — different knob.)

A remembered belief lands `status:active` (only `procedural` kinds become `candidate`), and `_active_beliefs` excludes only `archived` — so status is not a concern; both active and candidate beliefs are visible to discernment.

Consequences:
- 0gtown's demo is robust even if the reflector/LLM backend is unavailable.
- The package's unit tests never need the Python service (`FakeKernel`).
- Graceful degradation is natural: if the memory service is down, `recall` returns a neutral signal and `learn` is best-effort — the live interaction never breaks.

---

## 3. Package layout

```
kit/packages/cognition/
  package.json            # @aigg/cognition (ESM, exports → src/index.ts, tsx smoke scripts)
  tsconfig.json           # extends ../../tsconfig.base.json, moduleResolution: Bundler
  src/
    types.ts              # shared types: Discernment, EpisodeInput, CognitiveSignal, Outcome, ...
    kernel/port.ts        # MemoryKernel interface + KV interface
    kernel/aigg.ts        # AiggMemoryKernel — HTTP adapter to the aigg-memory sidecar
    kernel/fake.ts        # FakeKernel + InMemoryKV — in-memory impls for tests/offline
    social/trust.ts       # TrustLedger (pure)
    social/warn.ts        # diffuseWarning()
    cognition.ts          # Cognition orchestrator (recall / learn / warn / reflect)
    id.ts                 # corpusId(npcId) — the single canonical id transform
    gate.ts               # shouldRefuse(signal)
    index.ts              # barrel
    __tests__/*.smoke.ts  # tsx smoke tests (node:assert/strict), one per module
  README.md
```

Mirrors the kit conventions (ESM, `main`/`types` → `src/index.ts`, `tsconfig.json` extends base with `moduleResolution: Bundler`, tsx smoke tests). cognition depends on **nothing in the kit** — it defines its own `KV` port; hosts adapt their store.

---

## 4. The `MemoryKernel` port

```ts
export interface Discernment {
  q: number;            // [0,1] — strength that the topic is a (e.g.) trap
  faculty: number;      // self-learned belief present (0/1)
  social: number;       // peer-warned belief present (0/1)
  confidence: number;   // Laplace-smoothed belief confidence
}

export interface RememberInput {
  slug: string;
  description: string;
  match: string[];                 // routing/recall terms
  kind?: 'episodic' | 'semantic' | 'belief';
  assertedBy?: string;             // provenance: self | peerId (None ⇒ self)
  outcome?: 'loss' | 'gain' | 'success' | 'neutral';
  predicts?: string;
}

export interface SelectResult { units: { slug: string; description: string; kind: string }[]; bundle: string; total: number }

export interface MemoryKernel {
  remember(corpus: string, fact: RememberInput): Promise<void>;
  // mode defaults to 'text' (see §2 invariant 1); minConfidence unset or ≤0.5 for the unverified path
  discernment(corpus: string, topic: string, opts?: { mode?: 'text' | 'provenance'; marker?: string; minConfidence?: number; talent?: number; selfId?: string }): Promise<Discernment>;
  verify(corpus: string, opts?: { now?: string; refuteThreshold?: number }): Promise<{ verified: number; stale: number }>;
  select(corpus: string, request: string, opts?: { nBest?: number; kinds?: string[] }): Promise<SelectResult>;
  reflect(corpus: string, opts?: { now?: string }): Promise<{ beliefs: number }>;   // LLM — OPTIONAL
}

export interface KV { get(key: string): Promise<string | null>; set(key: string, val: string): Promise<void>; }
```

> **Deferred to ②b:** `trackRecord`/`reputation`. The review confirmed `track_record` is a **Python-only function** (`agent.py`) with **no HTTP route** in the aigg-memory server, and `select` does not return `asserted_by` (so it can't be computed client-side). Adding the endpoint belongs naturally with ②b governance, which actually consumes `skill` for allocation/voting weight. ②a ships only the two social primitives the demo needs: **trust** and **warning diffusion**.

- **`AiggMemoryKernel`** (`kernel/aigg.ts`) — constructs from `{ baseUrl, token?, model?, backend? }`; maps each method to the aigg-memory HTTP route used by the existing `AiggMemoryClient` (`/memory/remember`, `/memory/discernment`, `/memory/verify`, `/memory/select`, `/memory/reflect`). **Two wire details the review flagged as silent-failure traps:**
  - `remember`'s `kind`/`assertedBy`/`outcome`/`match` go **inside the `payload` object**, not at body level. In particular a **body-level `outcome` makes `_detect_promote_repeated` skip the record** (`memory.py`: `if record.outcome: continue`) so **no belief is ever written** — `outcome` must be in `payload` (→ `summary.outcome` → frontmatter).
  - `discernment` **defaults to `mode:'text'`** here (the existing client defaults to `provenance`, which would not see a fresh belief — §2 invariant 1).
  - `reflect` posts with the server-configured LLM backend; if none is configured it throws, which the orchestrator catches as "reflection unavailable."
- **`FakeKernel`** (`kernel/fake.ts`) — a real in-memory implementation matching the same observable semantics: stores remembered facts per corpus; `discernment(topic, {mode:'text'})` returns `q=confidence=1, faculty=1` if a **self-asserted** `kind:belief` whose `match` (or text) contains `topic` exists, `social=1` if a **peer-asserted** one exists (peer = `assertedBy ≠ self`), else zeros (respecting `minConfidence ≤ 0.5` for the unverified prior); `reflect` promotes matching episodes to beliefs (deterministic stand-in). Hermetic — no Python service in tests.
- **`InMemoryKV`** — a `Map`-backed `KV` for tests/offline.

The single canonical id transform (`id.ts` `corpusId(npcId)`) is used as the **corpus path segment, `selfId`, and `assertedBy`** everywhere, so faculty-vs-social classification (`_is_self`) stays consistent. (It sanitizes `:` etc., matching the shape SharedWorld uses — but ②a's cognition owns its own corpora and does not need to share with SharedWorld's.)

---

## 5. Social primitives (pure TS)

### TrustLedger (`social/trust.ts`)
Per `(selfId, peerId)` trust scalar in `[-1, 1]`, neutral prior `0`, persisted via an injected `KV` (key `trust:<self>:<peer>`).

```ts
export const TRUST_DELTAS = { scammed: -0.3, brokenPromise: -0.2, honestDeal: 0.05, kept: 0.1 } as const;

export class TrustLedger {
  constructor(kv?: KV);                                  // defaults to InMemoryKV
  get(self: string, peer: string): Promise<number>;       // 0 if unseen
  update(self: string, peer: string, delta: number): Promise<number>;  // clamps to [-1,1], returns new value
}
```
The `-0.3` scammed delta mirrors monopoly's trust events.

### diffuseWarning (`social/warn.ts`)
```ts
export async function diffuseWarning(
  kernel: MemoryKernel, trust: TrustLedger,
  from: string, to: string, topic: string,
  opts?: { threshold?: number },   // default trust threshold 0 (neutral)
): Promise<{ accepted: boolean; reason?: string }>;
```
Reads `from`'s belief about `topic` (via `kernel.discernment(corpusId(from), topic, {mode:'text'})`; only diffuse if `faculty > 0`). If `to`'s trust in `from` ≥ `threshold`, writes the belief into `to`'s corpus via `kernel.remember(corpusId(to), { kind:'belief', assertedBy: corpusId(from), match:[topic,'trap'], outcome:'loss', ... })` so `to`'s later `discernment(topic, {mode:'text'})` returns `social = 1` (peer-asserted, since `assertedBy ≠ corpusId(to)`). Returns `accepted:false` with a reason if `from` has no belief or `to` distrusts `from`. This is the "A-Bao warns Keeper Liu" primitive.

(Reputation/track-record is deferred to ②b — see §4.)

---

## 6. Cognition orchestrator + gate

### Cognition (`cognition.ts`)
```ts
export interface CognitiveSignal {
  discernment: Discernment;
  trust: number;              // self's trust in this peer
  beliefs: SelectResult;      // relevant recalled memory units
  summary: string;            // short host-injectable text for the prompt
}

export interface EpisodeInput {
  topic: string;              // e.g. the normalized claim / subject
  description: string;
  outcome: 'loss' | 'gain' | 'success' | 'neutral';
  formBelief?: boolean;       // default: true when outcome==='loss' — write a direct kind:belief
}

export class Cognition {
  constructor(kernel: MemoryKernel, trust: TrustLedger, opts?: { reflectOnLearn?: boolean });
  // reflectOnLearn defaults to FALSE — reflection (the LLM pass) is opt-in/scheduled, not run on every learn (cost control).

  recall(self: string, peer: string, topic: string): Promise<CognitiveSignal>;
  learn(self: string, peer: string, ep: EpisodeInput): Promise<void>;
  warn(from: string, to: string, topic: string): Promise<boolean>;
  reflect(self: string): Promise<void>;
}
```

All `self`/`peer`/`from`/`to` args are raw NPC/visitor ids; the orchestrator runs them through `corpusId()` before every kernel call (corpus segment + `selfId` + `assertedBy` all use the same transform).

- **`recall`** (PRE) — `discernment(corpusId(self), topic, { mode:'text', selfId: corpusId(self) })` (no `minConfidence`, so the 0.5-prior fresh belief passes — §2) + `select(corpusId(self), topic)` + `trust.get(self, peer)`, assembled into a `CognitiveSignal`. Builds `summary` (e.g. *"You remember: the 'elixir' pitch cost you 3 $0G. You distrust this visitor (trust −0.30)."*) for prompt injection. **Best-effort**: any kernel failure → a neutral signal (`q=0`, `trust=0`, empty beliefs, empty summary) so the live turn never breaks.
- **`learn`** (POST) — `remember(corpusId(self), { kind:'episodic', match:[topic,'trap'], outcome, ... })`; when `ep.formBelief` (default true on loss) also `remember(corpusId(self), { kind:'belief', assertedBy: corpusId(self), outcome, match:[topic,'trap'] })` so `discernment` (text mode) finds it without the reflector; applies a `TRUST_DELTAS` update toward `peer`; if `opts.reflectOnLearn`, fire-and-forget `reflect(self)`. (Per §4, `outcome`/`kind`/`assertedBy`/`match` are routed into the kernel call's `payload`, never body-level.)
- **`warn`** — delegates to `diffuseWarning(kernel, trust, from, to, topic)`.
- **`reflect`** — `kernel.reflect(self)`; best-effort (no-op if the backend is unavailable).

### gate (`gate.ts`)
```ts
export function shouldRefuse(signal: CognitiveSignal, opts?: { qThreshold?: number; trustFloor?: number }): { refuse: boolean; reason?: string };
```
Deterministic short-circuit for pitch-like decisions: refuse when `signal.discernment.q > qThreshold` (default 0.5, mirroring monopoly's `FOLLOW_THRESHOLD`) **or** `signal.trust < trustFloor` (default −0.5). Returns a `reason` for the host to surface/anchor.

---

## 7. 0gtown integration ("both")

- **Replace** the `burned: Map<npcId,Set<claim>>` map in [src/server.ts](../../../src/server.ts) with a `Cognition` instance. **`topic` = `norm(claim)`** (reuse the server's existing `norm = claim.trim().toLowerCase()` at server.ts:95 — keeps the deterministic exact-claim semantics 0gtown has today, with reflect-generalization layered on later). The pitch **refuse-path (server.ts ~245–273) is a non-trivial rewrite**, not a drop-in: it must now read the belief text from `recall`'s `CognitiveSignal.summary`/`beliefs` instead of `beliefText.get(...)`. Keep `beliefRoot`/0G Storage anchoring (library ⑤) feeding the existing `town.anchor`/`town.refuse` recorder events; cognition supplies the belief *text*, 0G Storage supplies the *root*.
- **Kernel selection** mirrors 0gtown's live-vs-fallback pattern (server.ts:67–71, 82): `AiggMemoryKernel` (sidecar, env `MEMORY_URL`) in live mode; `FakeKernel` when unset (spike/offline) — so the demo always runs.
- **Talk path** → `signal = recall(npc.id, visitorId, topic)`; inject `signal.summary` into the prompt so NPCs *speak* from memory.
- **Pitch path** → `recall` + `gate.shouldRefuse(signal)`; on refuse → deterministic refusal recalling the belief; on accept (burn) → `learn(npc.id, visitorId, { outcome:'loss', topic: norm(claim), ... })` → episode + direct belief + visitor trust drop + (optional) scheduled reflect.
- **The social demo** — after A-Bao is scammed, the server calls `cognition.warn('npc:0gtown:abao', 'npc:0gtown:liu', topic)` — both are real seeded NPCs (server.ts:37,45) in `ROOM='Market'` → Keeper Liu's next `recall` returns `social = 1` → Liu refuses the **same scam unburned**. Per-visitor trust persists across the session.

### Replay synergy (extends ①'s `town@0` pack)
Add three event kinds to the replay `town@0` pack so the cognition arc is visible in the viewer:
- `town.belief` — `data:{ topic, belief, source:'self'|'reflect' }`
- `town.warn` — `data:{ from, to, topic, accepted }`
- `town.trust` — `data:{ peer, delta, value }`

This is a real (not free) change to the shipped `@aigg/replay` package, and the plan must include all of it:
1. Add the three kinds to `townPack.eventKinds` in `kit/packages/replay/src/packs/town.ts` (no `validateEvent` invariants needed — they pass through).
2. **Update the shipped exact assertion** `town-pack.smoke.ts:19` (`assert.deepEqual(townPack.eventKinds, [...])`) — adding kinds breaks it otherwise.
3. **Render them in the viewer**: `viewer/viewer-core.js` `townLedger` silently ignores unknown kinds today, so warn/trust lines require editing `townLedger` + the `town-ledger` renderer in `viewer.js`.
4. The 0gtown server emits the three events beside its existing recorder calls.

---

## 8. Error handling

- **Best-effort cognition**: every `MemoryKernel` call in `recall`/`learn`/`reflect`/`warn` is wrapped; on failure `recall` returns the neutral signal and the others no-op (logged). A memory-service outage degrades NPCs to "no memory," never breaks talk/pitch — the 0gtown "keep the town alive" rule and the replay-cycle best-effort lesson.
- **TrustLedger** is local/pure — safe; clamps to `[-1,1]`.
- **gate** is pure and total.

---

## 9. Testing & verification (the "both" proof)

1. **TrustLedger** — deltas accumulate, clamp at ±1, persist via `InMemoryKV`, per-pair isolation.
2. **FakeKernel** — remembered self-belief ⇒ `discernment(topic,{mode:'text'}).faculty=1,q=1`; peer-belief (`assertedBy≠self`) ⇒ `social=1`; no belief ⇒ zeros; `minConfidence>0.5` ⇒ the unverified belief is excluded (mirrors the real prior); `corpusId` sanitization is applied consistently.
3. **diffuseWarning** — with FakeKernel: a `from` belief + sufficient trust ⇒ `to` gains a **peer-asserted** belief (its `discernment.social` flips to 1, `faculty` stays 0); insufficient trust ⇒ rejected; no `from` belief ⇒ rejected.
3a. **id transform** — `corpusId(npcId)` is stable and idempotent, and a belief written with `assertedBy:corpusId(from)` into `corpusId(to)`'s corpus classifies as social (not faculty) for `to`.
4. **gate.shouldRefuse** — q over threshold ⇒ refuse; trust under floor ⇒ refuse; neutral ⇒ allow.
5. **Cognition** (FakeKernel) — `learn(loss)` makes a later `recall` return `q>0` and a non-empty summary and drops peer trust; `warn` makes the target's `recall` return `social=1`; kernel-throw ⇒ `recall` returns the neutral signal (best-effort proven).
6. **0gtown spike extension** — drive A-Bao: pitch → accept+learn; repeat pitch → refused via cognition (not the old Map); `warn('abao','liu')` → Liu refuses the same claim unburned; the scamming visitor's trust is negative. Run against `FakeKernel` for deterministic CI; assert the emitted replay stream contains `town.belief`/`town.warn`/`town.trust` and still `validateRun`s.

Before claiming done: run the spike and confirm the learn→refuse→warn→immunity arc and the trust drop, and that the replay stream with the new event kinds validates.

---

## 10. Why this is the right seam

The `MemoryKernel` port + pure social primitives make cognition a clean, reusable lower layer: any host wires `recall`/`learn`/`warn` around its own loop, tests against `FakeKernel`, and swaps in `AiggMemoryKernel` for the real service. The model-free-core/optional-reflection split keeps the demo robust and the tests hermetic. 0gtown proves it end-to-end (learn → refuse → warn → peer immunity, with per-visitor trust), and the arc is observable through the replay viewer from ①. ②b (governance) and ②c (society) then build on the beliefs and trust this layer produces.

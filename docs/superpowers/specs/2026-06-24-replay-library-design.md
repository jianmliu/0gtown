# Design: `@aigg/replay` — a unified, pack-extensible replay library

**Date:** 2026-06-24
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (first real consumer / proving ground)
**Home:** `kit/packages/replay` in the shared `aigg-agent-kit` submodule

---

## 1. Background & motivation

The ai.gg family has five sibling projects sharing the `@onchainpal/*` engine
(git submodule `aigg-agent-kit`): the parent product **onchainpal**, the
**aigg-mud-demo** server + `pumptown-web` replay viewer, the Python economic
sandbox **aigg-monopoly**, and this **aigg-0gtown** 0G-Compute night-market demo.

This is the **first** of a planned series of library extractions that use 0gtown
as the driver/proving ground. The agreed sequencing is: ① replay (this spec) →
② deep agent cognition/social (from monopoly) → ⑤ data-on-chain → ④ economy
on-chain → ③ layered frontend. Replay goes first because it is greenfield,
self-contained, lowest-risk, and is **observability infrastructure** that
amplifies the value of every later extraction.

**Deliverable definition (agreed):** *both* a cleanly reusable library *and* a
strengthened 0gtown. Each extracted library is proven by being wired into 0gtown
for real and run through. A library is "done" only when it is independently
importable AND 0gtown consumes it end-to-end.

### The problem this solves

Replay today is duplicated and informal across three places, with **no single
source of truth**:

- **aigg-monopoly** hand-builds the `pumptown/replay@0` JSONL in a Python
  `Recorder` (`harness/record.py`), including its own social-metric tallying.
- **aigg-mud-demo** has the consumer side: a JS validator
  (`apps/pumptown-web/validate-run.mjs`) and the `pumptown-web` viewer (~246 lines).
- **aigg-0gtown** has nothing — it pushes `talked`/`pitched` frames live over
  WebSocket and never writes a replay stream.

The existing `pumptown/replay@0` schema is **economics-specific**: the header
requires `map`/`agents`/`params`, every tick requires `market.{p_t,v_t,supply}`,
and events are a fixed `KNOWN_EVENTS` set (`trade`/`pump`/`dump`/`blackswan`/…).
0gtown's domain — `talk`/`pitch`/`refuse`/belief-anchor with TEE attestation —
does not fit: it has no AMM, no `p_t`/`v_t`, two NPCs in one room, and its
defining artifacts (TEE signatures, 0G Storage root hashes) have nowhere to live.

### Goals

1. One source of truth for the replay contract: types + validator + recorder +
   viewer, all consulting the same registry.
2. A schema that holds 0gtown (talk/learn), monopoly (economics), and future
   worlds without forcing fake data or losing domain artifacts (TEE, anchors).
3. 0gtown emits a conformant stream and gains a "watch the replay" view for free.

### Non-goals (this cycle)

- Migrating monopoly's Python recorder or mud-demo's viewer to the new schema.
  They stay on `pumptown/replay@0`; their migration is each project's own later
  cycle. (The `econ@0` pack is *specified* here to prove the core subsumes `@0`,
  but its full implementation/rewiring is deferred.)
- Live-streaming replay to the browser. v1 is file-based JSONL, matching the
  existing viewer. Live streaming is a natural later extension (YAGNI now).
- A Python recorder. The deliverable is a TS package; the **schema is the
  cross-language contract** and monopoly conforms on its own schedule.

---

## 2. Chosen approach

**Approach A — neutral core + domain packs** (chosen over "B: reuse `@0`, 0gtown
shoehorns" and "C: two sibling schemas"). A is the only option that delivers a
genuinely unified, reusable library while letting 0gtown represent its TEE/learn
semantics honestly and letting monopoly keep its economics.

The unifying idea: **a minimal domain-neutral core + a Pack Registry.** Adding a
new world means registering a pack; the core, recorder, validator, and viewer do
not change. The pack registry **is** the reusable interface.

```ts
interface ReplayPack {
  id: string;                          // e.g. "town@0"
  eventKinds: string[];                // e.g. ["town.talk","town.pitch","town.refuse","town.anchor"]
  validateTick?(tick: Tick, ctx: ValidateCtx): string[];  // domain invariants → error strings
  validateEvent?(ev: Event, ctx: ValidateCtx): string[];
  viewer?: { panels: PanelSpec[] };    // data-only descriptor; viewer mounts panels from it
}
```

---

## 3. Package layout

```
kit/packages/replay/
  package.json            # @aigg/replay  (exports "." → src/index.ts, matches sibling pkgs)
  src/
    schema.ts             # core types: Run, Tick, Event, Summary, ReplayPack, PanelSpec
    registry.ts           # PackRegistry: register(pack) / get(id) / eventKinds()
    recorder.ts           # createRecorder(): run/tick/event/metrics/summary/close
    validate.ts           # validateRun(linesOrPath) → { ok, errors: {line, msg}[] }
    packs/
      core.ts             # built-in: move/say events + entity-relationship-graph panel
      town.ts             # town@0 pack (full impl + Learn Ledger panel spec)
      econ.ts             # econ@0 pack (types + panel spec; stub validation — monopoly migrates later)
    index.ts              # barrel export
  viewer/
    index.html            # pack-aware viewer (forked from mud-demo pumptown-web, evolved to replay@1)
    viewer.js
    viewer.css
  fixtures/
    0gtown-sample.jsonl   # town@0 fixture, validated in CI
  README.md
```

The package follows the existing kit convention (`@aigg/gamekit`/`npc-agent`/
`onchain`): `main`/`exports` point at `src/index.ts`, TS source consumed directly
by workspace members.

---

## 4. `replay@1` schema

JSONL, one object per line. Line 1 = `run` header; middle lines = `tick` (ordered,
strictly increasing `t`); optional last line = `summary`.

### Header (line 1)

```jsonc
{
  "kind": "run",
  "schema": "replay@1",
  "runId": "0gtown-2026-06-24-abc",
  "title": "0gtown night market",       // optional, human label
  "createdAt": 0,                         // monotonic origin (tick or ms); producer's choice
  "packs": ["town@0"],                    // declared domain packs present in this run
  "entities": [                            // generic actors (replaces economics-specific "agents")
    { "id": "npc:0gtown:abao", "name": "A-Bao", "kind": "npc", "tags": ["noodle"] },
    { "id": "npc:0gtown:liu",  "name": "Keeper Liu", "kind": "npc" }
  ],
  "map": {                                 // OPTIONAL spatial layer
    "rooms": [{ "id": "market", "name": "Night Market" }],
    "edges": []
  },
  "meta": { "liveMode": true, "net": "mainnet" }   // freeform producer metadata
}
```

### Tick

```jsonc
{
  "kind": "tick",
  "t": 1,
  "events": [
    { "kind": "town.talk", "actor": "npc:0gtown:abao", "target": "visitor:42", "by": "npc",
      "data": { "said": "…", "verified": true,
                "attestation": { "signature": "0g-teeml:verified:abc", "model": "glm-5-fp8" },
                "costGcc": 0.001, "balanceGcc": 9.999 } }
  ],
  "metrics": { "receipts.compute": 3, "receipts.storage": 1 }   // OPTIONAL flat numeric snapshot
}
```

**Core event shape:** `{ kind, actor?, target?, room?, by?, data? }`.
`kind` is namespaced `"<pack>.<name>"` for domain events; the built-in `core`
pack owns the unprefixed spatial/social verbs `move` and `say`. `data` carries
all domain-specific fields so the core never needs to know about them.

### Summary (last line, optional)

```jsonc
{ "kind": "summary", "packs": ["town@0"],
  "town": { "burned": [{ "id": "npc:0gtown:abao", "claims": 2 }], "refusals": 3, "anchored": 1 },
  "metrics": { "receipts.compute": 12, "receipts.storage": 2 } }
```

### Built-in `core` pack

- Event kinds: `move` (`data:{from,to}`), `say` (`data:{text}`).
- Viewer panel: timeline + entity-relationship graph + raw event log. Always
  rendered, for every run, regardless of domain packs.

### `town@0` pack (0gtown — fully implemented this cycle)

Event kinds and `data` payloads (so TEE + anchors are first-class, not faked):

| kind          | data fields                                                              |
|---------------|--------------------------------------------------------------------------|
| `town.talk`   | `said`, `verified`, `attestation{signature,model}`, `costGcc`, `balanceGcc` |
| `town.pitch`  | `accepted`, `amount`, `claim`, `deltaGcc`, `balanceGcc`                   |
| `town.refuse` | `protected:true`, `claim`, `belief`, `beliefRoot`                         |
| `town.anchor` | `claim`, `belief`, `beliefRoot` (0G Storage rootHash)                     |

- Metrics: `receipts.compute`, `receipts.storage`.
- Summary block: `{ burned:[{id,claims}], refusals, anchored }`.
- `validateTick`/`validateEvent` invariants: `town.talk` with `verified:true`
  must carry `attestation.signature`; `town.refuse` must set `protected:true`
  and reference a `claim`; `town.anchor` must carry a non-empty `beliefRoot`.
- Viewer panel **"Learn Ledger"**: per-NPC balance, green TEE seal badge when
  `verified`, belief cards stamped with the anchor `beliefRoot`. This reproduces
  0gtown's current UI semantics, now driven by the replay stream.

### `econ@0` pack (monopoly/mud-demo — specified now, rewired later)

Defined here to **prove the neutral core subsumes `pumptown/replay@0`**:

- Tick-level domain block `market: { p_t, v_t, supply, R_t? }` (carried under the
  pack's namespace; the core tick does not require it).
- Event kinds: `econ.trade`, `econ.pump`, `econ.dump`, `econ.blackswan`,
  `econ.bill`, `econ.burn`, `econ.patron`, `econ.dividend`, `econ.bet`,
  `econ.trust`, `econ.reflect`.
- Summary blocks: `wealth`/`skill`/`decomp`/`social`/`manip` (the existing `@0`
  shapes).
- Viewer panels: price (`p_t` vs `v_t`), Gini/supply, social graph, analysis.

This cycle ships **types + panel specs + a stub validator** for `econ@0`. Full
validation and the monopoly/mud-demo rewiring are deferred to their own cycles.

---

## 5. Recorder API (TS)

```ts
const rec = createRecorder({ path: `runs/${runId}.jsonl`, packs: ['town@0'] });
rec.run({ runId, title, entities, map, meta });   // writes header
rec.tick(t);                                       // opens a tick (flushes the previous one)
rec.event('town.talk', { actor, target, by, data });
rec.metrics({ 'receipts.compute': n });            // attaches to the current tick
rec.summary({ town: {...}, metrics: {...} });      // optional
rec.close();                                       // flush + close stream
```

- 0gtown calls `rec.event(...)` **next to** each existing `sendJson(...)`; the
  live WebSocket path is untouched.
- The recorder asserts `event.kind ∈ (declared packs' eventKinds)` and fails fast
  in development, so an undeclared/typo'd event never reaches a stream.
- Stream sink is a Node writable (file by default); pluggable so a later live
  mode can tee to a socket without API changes.

---

## 6. Validator

```ts
validateRun(linesOrPath): { ok: boolean, errors: { line: number, msg: string }[] }
```

Core invariants: line 1 is `kind:"run"` with a known `schema` id and required
header keys; every `entities[i]` has `id`+`name`; declared `packs` are registered;
ticks are `kind:"tick"` with strictly increasing `t`; any `summary` is the last
line. Then, per tick/event, it runs each declared pack's `validateTick`/
`validateEvent`. This replaces the scattered, economics-hardcoded
`validate-run.mjs`. Returns structured errors (never throws on malformed input).

---

## 7. Viewer (pack-aware, moved into the kit)

Forked from mud-demo's `pumptown-web` into `kit/packages/replay/viewer`, evolved
to `replay@1`:

- Runs `validateRun` before rendering; refuses to render an invalid stream.
- **Core always renders**: timeline scrubber, entity-relationship graph, event log.
- Mounts domain panels from each present pack's `viewer.panels` descriptor:
  `town@0` lights up the Learn Ledger; `econ@0` lights up price/Gini/social.
- **Graceful degradation**: an unknown/unregistered pack renders core only plus a
  "pack not installed" notice — never a hard failure.
- **Back-compat**: also opens legacy `pumptown/replay@0` files (legacy code path),
  so the kit viewer is a strict superset of the old one.

mud-demo's own `apps/pumptown-web` is left untouched this cycle; de-duplication
(pointing it at the kit viewer) is mud-demo's later cycle.

---

## 8. 0gtown integration (proving the library)

In `src/server.ts`:

- On boot: `createRecorder({ path: runs/<runId>.jsonl, packs:['town@0'] })` and
  write the header (`entities` = seeded NPCs, `map` = the single Market room,
  `meta` = `{liveMode, net}`).
- On each interaction, record alongside the existing WS send:
  - `talked`  → `town.talk`  (said, verified, attestation, costGcc, balanceGcc)
  - `pitched` accepted → `town.pitch` (+ a `town.anchor` when storage is on)
  - `pitched` protected → `town.refuse`
- `receipts` → `rec.metrics(...)`; on shutdown → `rec.summary(...)`.
- New HTTP routes so the demo gains "watch the replay" for free:
  `/replay/latest.jsonl` (serve the current run) and `/replay/` (serve the kit
  viewer static assets). This is the 0gtown-strengthening half of the deliverable.

A "tick" in 0gtown maps to one interaction step (each talk/pitch advances `t`);
there is no simulation clock, so `t` is a monotonically increasing interaction
counter.

---

## 9. Error handling

- **Recorder**: rejects events whose `kind` is not in a declared pack (fail fast).
- **Validator**: structured `{line,msg}` errors; never throws on bad input.
- **Viewer**: validates before render; unknown pack → core-only + notice.

---

## 10. Testing & verification (the "both" proof)

1. **Schema/validator unit tests**: a valid town stream passes; malformed streams
   fail with the right error — out-of-order `t`, undeclared event kind, missing
   header key, `summary` not last, `town.talk verified:true` without attestation.
2. **Recorder roundtrip**: emit a synthetic town run → `validateRun` is `ok`.
3. **0gtown integration smoke** (extend existing `src/spike.ts` / `src/live-check.ts`):
   record while driving talk → pitch → pitch; assert `town.talk` carries an
   attestation when live, the first `town.pitch` has `deltaGcc < 0`, the repeat
   yields `town.refuse` with `protected:true`, and (storage on) `town.anchor`
   carries a `beliefRoot`; then `validateRun(producedFile)` passes.
4. **Back-compat**: the kit viewer opens an existing `@0` sample (legacy mode).
5. **Fixture**: ship and CI-validate `fixtures/0gtown-sample.jsonl`.

Before claiming done (per project verification discipline): run the validator on
the real 0gtown-produced stream **and** open the viewer to confirm the Learn
Ledger panel renders TEE seals and anchor roots.

---

## 11. Why this is the right seam

The Pack Registry is the load-bearing abstraction. "Reusable" is delivered
concretely: 0gtown proves the seam with `town@0`; monopoly and any future world
each add a pack; the core schema, recorder, validator, and viewer never change
for a new world. Replay also becomes the observability substrate that makes every
later extraction (deeper cognition, on-chain economy/data) visible the moment it
lands.

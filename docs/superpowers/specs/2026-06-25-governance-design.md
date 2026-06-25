# Design: `@onchainpal/cognition` ②b — governance

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Home:** `kit/packages/cognition/src/governance/` (new module in the existing package)
**Branch:** `governance` (stacks on `cognition-social`, which stacks on `replay-library` — extends ②a's cognition package and the replay `town@0` pack)

---

## 1. Background & motivation

Sub-project **②b** of `@onchainpal/cognition` (see [[kit-extraction-initiative]]; ② split into ②a cognition+social → ②b governance → ②c society). ②a shipped: memory→belief→reflection loop, per-peer trust, and warning diffusion. ②b adds **collective governance** — proposals, voting, enactment, and **belief-gated sanctions** — composing directly on the beliefs ②a produces.

Maps to monopoly's [`harness/govern.py`](../../../../aigg-monopoly/harness/govern.py): a `Polity` with `submit`/`cast`/`step`/`_enact`, a `THRESHOLD=0.60` tally, and proposal types `set_policy`/`tax`/`disclose`/`sanction`. The load-bearing tie to ②a in monopoly is `_vote_choice`/`_maybe_propose` calling `world.cog.believes(agent, target)` — agents propose/vote to sanction anyone they have *learned* is a trap. That `believes` is exactly ②a's `Cognition` discernment.

### Agreed decisions (from brainstorming)

1. **Scope = governance only.** Reputation/track-record is **excluded** (deferred). `govern.py` never uses `track_record` — reputation is consumed by patron/allocation (an economy concern), not voting. Bundling it here would be scope creep.
2. **0gtown demo = a market guild bans a scammer visitor.** The sanction target is a *visitor* (a scammer), not an NPC (0gtown's NPCs are friendly stall owners). This requires enriching `TOWNSFOLK` from 2 → ~5 NPCs.
3. **Architecture = Approach A**: a **clock-agnostic** generic `Polity` (0gtown is event-driven, monopoly is tick-based — so the Polity owns no clock; the host decides when to tally) + **belief-gating bridge helpers** that compose ②a's `Cognition`.

### The composition (why ②b is elegant on ②a)

One scam cascades into a collective ban: scammer pitches A-Bao → A-Bao burns → (②a) `learn` a belief + **warn the whole guild** (`diffuseWarning` to every guild NPC) → the guild now holds a *social* belief about the scam → A-Bao proposes to ban the visitor → each guild NPC casts a **belief-gated vote** → passes → visitor sanctioned → their pitches are refused outright. ②a's warning diffusion is what lets a single burn reach the voting threshold.

### Non-goals

- Reputation/track-record (deferred; needs an aigg-memory `/memory/track-record` endpoint that no consumer in ②b requires).
- The economy-specific proposal types `tax`/`set_policy`/`disclose` — the Polity supports pluggable enactors so monopoly *could* register them, but ②b implements and exercises only `sanction`.
- Crime/alliances/lending (②c).
- A tick clock inside the Polity (rejected — clock-agnostic by design).

---

## 2. Chosen approach

**Approach A — clock-agnostic generic Polity + belief-gating bridge.** `Polity` owns only the proposal lifecycle (submit → cast → tally) and a built-in `sanction`/blacklist; the host decides *when* to tally (0gtown: synchronously, right after the guild votes; monopoly: after a tick window). Belief-gating lives in separate helpers that compose ②a's `Cognition`. Both are pure/host-driven, unit-tested with `FakeKernel` + a synthetic roster — no clock, no service.

---

## 3. Package layout

```
kit/packages/cognition/src/governance/
  polity.ts             # Polity: submit/cast/tally + sanction/blacklist + sanctioned() — pure, clock-agnostic
  voting.ts             # voteBeliefGated, runSanctionVote — compose Cognition (②a) + Polity
src/__tests__/
  polity.smoke.ts
  governance.smoke.ts
```
Plus the barrel (`src/index.ts`) re-exports the new symbols. cognition still depends on nothing in the kit.

---

## 4. Polity (clock-agnostic state machine)

```ts
export type Choice = 'for' | 'against';

export interface Proposal {
  pid: string;
  proposer: string;
  ptype: string;                              // 'sanction' | host-registered types
  payload: Record<string, unknown>;
  votes: Map<string, Choice>;                 // proposer pre-seeded 'for'
}

export interface TallyResult { passed: boolean; shareFor: number; effect?: Record<string, unknown> }

export interface PolityOpts {
  threshold?: number;                         // default 0.6
  enactors?: Record<string, (payload: Record<string, unknown>, polity: Polity) => Record<string, unknown>>;
}

export class Polity {
  constructor(opts?: PolityOpts);

  /** Open a proposal; the proposer is implicitly 'for'. Returns the pid. */
  submit(proposer: string, ptype: string, payload?: Record<string, unknown>): string;

  /** Record a vote. No self-vote (proposer already 'for'), no double-vote, no vote on an unknown/closed pid. */
  cast(pid: string, voter: string, choice: Choice): void;

  /** Tally against a voter pool: shareFor = (#'for') / max(1, pool.length). passed iff ≥ threshold.
   *  On pass, enacts (built-in `sanction`, else opts.enactors[ptype]). Removes the proposal either way. */
  tally(pid: string, voterPool: string[]): TallyResult;

  get(pid: string): Proposal | undefined;

  /** Is `target` currently sanctioned? (blacklist[target] ?? -Infinity) > now. */
  sanctioned(target: string, now?: number): boolean;   // now defaults to 0
}
```

- **Built-in `sanction` enactment**: `blacklist.set(payload.target, payload.until ?? Infinity)`. Returns `{ target, until }`. 0gtown bans for the session (`until = Infinity` ⇒ `sanctioned` always true); monopoly would pass `until = opened + window + K` and check against a tick `now`.
- **Pluggable enactors**: an unknown `ptype` with no registered enactor returns `effect: undefined` (passed proposal with a no-op effect) — never throws.
- `Polity` is **pure** (in-memory maps, no I/O) and clock-agnostic: `until`/`now` are opaque numbers the host interprets.

---

## 5. Belief-gating bridge (`voting.ts`) — the ②a↔②b seam

```ts
import type { Cognition } from '../cognition';
import type { Polity, Choice, TallyResult } from './polity';

/** Vote 'for' sanctioning `target` iff the voter has learned-or-been-warned the scam (topic belief)
 *  OR distrusts the target. Uses ②a's recall (best-effort). */
export async function voteBeliefGated(
  cognition: Cognition, voter: string, target: string, topic: string,
  opts?: { trustFloor?: number },               // default -0.5
): Promise<Choice>;

/** A full synchronous sanction round for an event-driven host (0gtown):
 *  if the proposer believes/distrusts the target, submit a sanction proposal, have every guild member
 *  cast a belief-gated vote, then tally immediately. Returns the TallyResult, or null if the proposer
 *  doesn't believe (no proposal opened). */
export async function runSanctionVote(
  cognition: Cognition, polity: Polity,
  proposer: string, target: string, topic: string, guild: string[],
  opts?: { until?: number; trustFloor?: number },
): Promise<{ pid: string; result: TallyResult; votes: Record<string, Choice> } | null>;
```

- `voteBeliefGated` calls `cognition.recall(voter, target, topic)`; votes `'for'` when `discernment.q > 0` (the voter learned the scam directly **or** was warned — ②a's warning diffuses exactly this social belief) **or** `trust < trustFloor` (the directly-scammed proposer). Else `'against'`.
- `runSanctionVote` is the 0gtown entry point: gate on the proposer's own belief, `submit('sanction', { target, until })`, then for each `guild` member (excluding the proposer) `cast(pid, member, await voteBeliefGated(...))`, then `tally(pid, guild)`. Synchronous — no clock.
- **The belief is keyed by `topic` (the normalized scam claim), not the visitor** — consistent with ②a's `learn(npc, visitor, {topic})`. The proposal payload carries `{ target: visitorId, topic }`; the gate reads the voter's belief about that `topic` plus their trust in the visitor. For 0gtown (one scammer, one claim) this is exact; the design note documents the coupling.

---

## 6. 0gtown integration ("both")

- **Enrich `TOWNSFOLK`** (src/server.ts) from 2 → ~5 stall NPCs — A-Bao, Keeper Liu, plus ~3 more (e.g. a fishmonger, a fruit-seller, a cloth-merchant), each with a `background` persona, all created in `ROOM`. The full set is the "night-market guild" (`guildIds = TOWNSFOLK.map(t => t.id)`).
- A `const polity = new Polity()` at startup, beside the `cognition`/`trust` setup.
- **Sanction-first in the pitch handler**: before the per-NPC `recall`/`shouldRefuse`, check `polity.sanctioned(visitorId)` — a banned visitor's pitch is refused outright with a guild-ban message (and a `town.refuse` recorded with a `bannedByGuild` flag in `data`).
- **The cascade on a successful scam** (accepted pitch / burn): keep ②a's `learn`; **generalize the warn step to warn the whole guild** (not just A-Bao→Liu) — `for (const g of guildIds) if (g !== npc.id) await cognition.warn(npc.id, g, topic)`. Then run governance:
  `const round = await runSanctionVote(cognition, polity, npc.id, visitorId, topic, guildIds, { until: Infinity })`.
  If `round?.result.passed`, the visitor is now blacklisted.
- **Replay** (extend the `town@0` pack again): `town.propose` (`data:{ proposer, target, topic, pid }`), `town.vote` (`data:{ voter, choice, pid }`), `town.sanction` (`data:{ target, passed, shareFor }`). Emit them best-effort beside the existing recorder calls. The viewer gains a "Guild" section (proposals → votes → ban outcome).
- All governance calls are wrapped best-effort so a failure never breaks the live pitch reply.

---

## 7. Error handling

- `Polity` is pure and total: bad pids/duplicate votes are ignored (no throw); an unknown ptype enacts to a no-op.
- `voteBeliefGated`/`runSanctionVote` rely on `recall` (already best-effort → neutral signal on kernel failure ⇒ votes `'against'`, i.e. a memory outage fails *closed*: no ban, town stays alive).
- The 0gtown governance block is wrapped in try/catch beside the recorder emits.

---

## 8. Testing & verification (the "both" proof)

1. **`polity.smoke`** — `submit` seeds proposer 'for'; `cast` rejects self-vote/double-vote/unknown-pid; `tally` passes at ≥ threshold and fails below; `sanction` enactment sets the blacklist and `sanctioned(target)` is true (with `until=Infinity`) and respects `until`/`now`; a registered custom enactor runs; an unknown ptype tallies without throwing.
2. **`governance.smoke`** (FakeKernel + a real `Cognition` + a synthetic guild) — `voteBeliefGated` returns 'for' for a voter who learned/was-warned the topic (or distrusts the target) and 'against' otherwise; `runSanctionVote` returns `null` when the proposer doesn't believe, **passes** when the guild has been warned (social beliefs), and **fails** when only the proposer believes (one 'for' out of a 5-guild < 0.6); a memory-down kernel makes every vote 'against' (fails-closed).
3. **0gtown spike extension** — drive the cascade against `FakeKernel`: scammer pitches A-Bao → A-Bao warns the guild → `runSanctionVote` passes → assert the visitor is `polity.sanctioned` → a subsequent pitch from that visitor (to any NPC) is refused with the guild-ban flag; assert the produced replay stream contains `town.propose`/`town.vote`/`town.sanction` and still `validateRun`s.

Before claiming done: run the spike and confirm the warn→propose→vote→ban→refuse cascade and that the replay stream with the new event kinds validates.

---

## 9. Why this is the right seam

`Polity` is a pure, clock-agnostic proposal state machine reusable by any host (0gtown's synchronous event model and monopoly's tick model both drive it). The belief-gating bridge is the only ②a-aware code, isolated in `voting.ts`. The whole thing is unit-testable with `FakeKernel` and a synthetic roster — no service, no clock. 0gtown proves it end-to-end (one scam → guild warned → collective ban), and the arc is observable through the replay viewer. ②c (society: crime/alliances/lending) then builds on the same `Cognition` + `Polity` substrate.

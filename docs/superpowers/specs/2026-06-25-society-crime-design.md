# Design: `@onchainpal/cognition` ②c-2 — crime (extort/sabotage)

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Home:** `kit/packages/cognition/src/society/crime.ts` (extends the ②c-1 `society/` module)
**Branch:** `crime` (stacks on `society` → `governance` → `cognition-social` → `replay-library`)

---

## 1. Background & motivation

Final cognition sub-project: **②c-2** completes the misconduct layer. ②c-1 shipped the `RapSheet` + `LoanBook` + the rap→ban pipeline; ②c-2 adds **crime** as a *second misconduct source* writing to the same `RapSheet`, with **zero change to the ban path**. Maps to monopoly's `society.py` crime functions (extort/sabotage/steal). Scope (agreed): **extort + sabotage-on-refusal**; steal cut; info-selling/alliances were cut in ②c.

The one genuinely new mechanic vs ②c-1's lending is **probabilistic detection**: a *caught* crime (`P_DETECT=0.5`) writes the same misconduct signal a loan default does (rap entry + trust↓ + an offender-scoped belief, via `recordMisconduct`) → the existing `runRapSanction` bans the offender. An *uncaught* crime leaves **no trail** (the thug got away). Sanctioned actors can't commit crimes (sanction-first).

### Agreed decisions (from brainstorming)

1. **Crimes = extort + sabotage-on-refusal.** A thug visitor demands protection; the stall refuses (guild solidarity); the thug sabotages in retaliation; detection rolls on the visible act.
2. **Architecture = ②c-1's pattern** (no new fork): a pure `detect`/`attemptCrime` primitive; `recordMisconduct`/`runRapSanction` reused unchanged; the host applies the narrative effect. Crime effects are narrative-only (the ②c-1 $0G no-transfer constraint still holds).
3. **Demo both detection outcomes** in the spike via a dev-mode test seam.

### What already exists (reused, not rebuilt)

- ②c-1 `RapSheet`, `recordMisconduct` (takes a `kind` param), `runRapSanction` (bans on any rap) — the whole rap→ban pipeline.
- ②a `Cognition`/`TrustLedger`/`FakeKernel`, ②b `Polity`, the 0gtown 5-NPC guild, `settleDue`/`ws.on('close')`/`nowSeq`/sanction-first, the replay `town@0` pack.

### Non-goals (②c-2)

- `steal` (cut — overlaps extort), info-selling, alliances.
- Any change to `recordMisconduct`/`runRapSanction`/the rap→ban path (crime is just a new `kind`).
- Moving the world's $0G (no transfer primitive — ②c-1 finding; crime effects are narrative).

### Revisions from the design audit (2026-06-25)

A code-grounded review against the shipped ②c-1 code + the real server confirmed `attemptCrime` composes with `recordMisconduct`/`runRapSanction` (zero ban-path change), `liveMode` exists (`server.ts:83`), the `extort` branch mirrors `borrow`, and the `town.crime` replay change is the known additive cost. It corrected: **(correctness)** the dev seam uses an explicit `attemptCrime` **`force?: boolean`** (passed only when `!liveMode && typeof msg.caught==='boolean'`) instead of a `P_DETECT`-coupled fake-`rng` trick; **(clarity)** `liveMode` keys off the 0G **Compute** provider, not `MEMORY_URL`/FakeKernel; **(wiring)** the `viewer.js` crime branch must precede the rap `else` or crimes render as "RAP"; **(test)** the spike asserts uncaught→"still served" via `talk`/`look` (no sanction gate), not `pitch` (whose learn-gate can false-positive).

---

## 2. Chosen approach

Same as ②c-1: a pure crime primitive + reuse the bridge + host narrative effect. The library delta is tiny (`detect` + `attemptCrime`); everything downstream of "a caught crime" is the ②c-1 pipeline.

---

## 3. Library — `society/crime.ts`

```ts
import type { Cognition } from '../cognition';
import type { RapSheet } from './rapsheet';
import { recordMisconduct } from './misconduct';

export const P_DETECT = 0.5;
export type CrimeKind = 'extort' | 'sabotage';

/** Probabilistic detection roll: caught? `rng` injectable for deterministic tests (default Math.random). */
export function detect(p: number = P_DETECT, rng: () => number = Math.random): boolean {
  return rng() < p;
}

/** Attempt a crime: roll detection (or use `force` if given); on catch, write the SAME misconduct signal
 *  a default does (rap entry + offender-scoped belief + one-time trust drop, via recordMisconduct).
 *  Uncaught → no trail. Best-effort (recordMisconduct is non-throwing). */
export async function attemptCrime(
  cognition: Cognition, rapSheet: RapSheet,
  victim: string, offender: string, kind: CrimeKind, now: number,
  opts: { detectP?: number; rng?: () => number; force?: boolean; detail?: string } = {},
): Promise<{ detected: boolean; topic?: string }> {
  const detected = opts.force ?? detect(opts.detectP ?? P_DETECT, opts.rng);   // force overrides the roll (deterministic tests)
  if (!detected) return { detected: false };
  const topic = await recordMisconduct(cognition, rapSheet, victim, offender, kind, now, opts.detail);
  return { detected: true, topic };
}
```
Re-exported from the package barrel (`P_DETECT`, `CrimeKind`, `detect`, `attemptCrime`). `attemptCrime` is the crime analog of ②c-1's settlement→default path; the host runs `runRapSanction` when `detected`.

---

## 4. Replay — one new `town.crime` event

Extend the `town@0` pack again (the same 4-site additive change):
- Add `town.crime` to `eventKinds`. `data:{ offender, kind, victim, caught }` — emitted on EVERY attempt (so the viewer shows both the caught and got-away paths).
- Validator: `town.crime` requires non-empty `offender`+`kind` and a boolean `caught`.
- `viewer-core.js` `townLedger`: a reduce case pushing `{ kind:'crime', offender, crimeKind, victim, caught, t }` to the `credit` list. `viewer.js`: render "⚔ {offender} {kind} {victim} — caught/got away." **The `viewer.js` credit loop is `if(lend)…else if(default)…else(rap)`** — the new `crime` branch MUST be inserted as `else if (c.kind === 'crime')` BEFORE the final `else` (the rap catch-all), or crimes render as "RAP".

(`town.rap`/`town.propose`/`vote`/`sanction` are reused for the caught path — no new ban events.)

---

## 5. 0gtown — the `extort` verb (reuses ②c-1 infrastructure)

- **`extort` WS command** (new): `{ cmd:'extort', npc }` →
  1. **sanction-first**: a banned thug's `extort` is refused outright (copy the `pitch`/`borrow` `polity.sanctioned(visitorId)` block).
  2. the stall **refuses** the demand (guild solidarity) → the thug **sabotages** the stall in retaliation (narrative; no world $0G change).
  3. build the opts conditionally (the dev seam, below): `const crimeOpts = (!liveMode && typeof msg.caught === 'boolean') ? { force: msg.caught } : {};` then `const { detected, topic } = await attemptCrime(cognition, rapSheet, npc.id, visitorId, 'sabotage', nowSeq, crimeOpts);`.
  4. emit `town.crime` (`{ offender: visitorId, kind: 'sabotage', victim: npc.id, caught: detected }`), best-effort, fresh `rec.tick(++replayT)`.
  5. **if `detected`** → `runRapSanction(rapSheet, polity, npc.id, visitorId, guildIds, { until: Infinity })` → emit `town.propose`/`vote`/`sanction`; reply `{ type:'extorted', caught: true, banned: true, … }` narrating "you trashed the stall and got caught — the guild has barred you."
  6. **else** → reply `{ type:'extorted', caught: false }` ("you got away this time").
- **Deterministic detection for the spike (dev-mode test seam)**: pass `{ force: msg.caught }` to `attemptCrime` **only when `!liveMode && typeof msg.caught === 'boolean'`**; otherwise pass `{}` so it does a real `detect()` roll. `force` overrides the roll cleanly (no fake-`rng` trickery, and it's independent of `P_DETECT`/`detectP`). The thug cannot control detection in production: `liveMode` is true whenever 0G Compute is configured (`server.ts:83` `const liveMode = !!live`), so the `msg.caught` seam is dead in live mode. (In the spike there's no `ZEROG_WALLET_PK`/`PRIVATE_KEY` → the fallback compute provider → `liveMode === false` → the seam is honored. Note `liveMode` keys off the 0G **Compute** provider, NOT `MEMORY_URL`/the FakeKernel memory gate — they merely coincide in the spike.)
- Reuses `settleDue`/`ws.on('close')`/`nowSeq`/sanction-first/guild unchanged.

---

## 6. Error handling, testing

- `detect` is pure; `attemptCrime`/`recordMisconduct`/`runRapSanction` are best-effort (non-throwing). The 0gtown `extort` block is try/caught beside the recorder emits, like `pitch`/`borrow` — a failure never breaks the reply.
- **`crime.smoke`** (FakeKernel + `Cognition`/`TrustLedger` + `RapSheet`): `detect(0.5, () => 0)` true, `detect(0.5, () => 0.9)` false; `attemptCrime` with `rng:()=>0` (caught) → `{detected:true, topic}`, a rap entry written, a later `recall(victim, offender, topic).discernment.q === 1`; with `rng:()=>0.99` (uncaught) → `{detected:false}`, NO rap entry, NO belief.
- **0gtown spike extension** (two fresh WS connections):
  - **caught**: connection A `extort`s a stall with `caught:true` → `town.crime caught:true` → rap → guild ban → a follow-up action from A is refused (`bannedByGuild`/sanctioned).
  - **uncaught**: connection B `extort`s with `caught:false` → `town.crime caught:false` → NO rap → B is NOT banned. Assert "still served" via **`talk` or `look`** (NOT `pitch`): `talk`/`look` have no `polity.sanctioned` gate, so a successful `talked`/`room` reply cleanly proves "not banned" — decoupled from `pitch`'s `shouldRefuse` learn-gate, which can return `protected:true` for non-ban reasons (a false positive).
  - assert the replay stream contains `town.crime` (both caught flags) + `town.rap`/`town.sanction` for the caught offender, and `validateRun`s.

Before claiming done: run the spike and confirm the caught→ban and uncaught→free branches and that the replay validates with `town.crime`.

---

## 7. Why this is the right seam

②c-2 proves the ②c-1 abstraction: the rap sheet generalized "grounds for a ban," so adding a wholly different misconduct *source* (a caught crime) reuses `recordMisconduct` + `runRapSanction` with **zero ban-path change** — only a new `kind` and a tiny `detect`/`attemptCrime` primitive. The probabilistic detection (caught vs got-away) is the one new idea, isolated in `crime.ts` and demonstrated both ways. This closes ② (`@onchainpal/cognition`): cognition+social (②a) → governance (②b) → misconduct/lending (②c-1) → crime (②c-2).

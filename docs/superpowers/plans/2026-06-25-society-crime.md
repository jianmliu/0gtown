# @onchainpal/cognition ②c-2 — crime (extort/sabotage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add crime to `@onchainpal/cognition` as a second misconduct source — a tiny `detect`/`attemptCrime` primitive reusing the shipped ②c-1 `recordMisconduct`/`runRapSanction` — wired into 0gtown as an `extort` verb where a caught thug earns a rap sheet and is banned, while an uncaught one gets away.

**Architecture:** A pure `society/crime.ts` (`detect` + `attemptCrime`); `recordMisconduct`/`runRapSanction`/`RapSheet` reused with ZERO ban-path change (crime is just a new `kind`). The host applies the narrative effect (the $0G no-transfer constraint from ②c-1 holds). Full design: [docs/superpowers/specs/2026-06-25-society-crime-design.md](2026-06-25-society-crime-design.md).

**Tech Stack:** TypeScript (ESM, Node ≥20), pnpm workspace, `tsx` smoke tests. Unit-tested with the ②a `FakeKernel` + the ②c-1 `RapSheet` — no service.

---

## ⚠️ Two-repo commit discipline + branch context (read first)

- Branch is **`crime`**, stacking on `society` → `governance` → `cognition-social` → `replay-library`. The full ②a/②b/②c-1 cognition package + the extended replay `town@0` pack (13 event kinds) are present.
- `kit/` is a **git submodule**. Files under `kit/packages/cognition/` and `kit/packages/replay/` are committed **inside the submodule** (`cd /Volumes/T7-Data/aigg-0gtown/kit && git ...`). The kit submodule is on `society` and Task 1 puts it on a `crime` branch.
- 0gtown-repo files (`src/server.ts`, `src/spike.ts`) are committed at the repo root.
- All `pnpm` commands run from `/Volumes/T7-Data/aigg-0gtown`.

### Load-bearing facts from the design audit (do not deviate)

1. **`attemptCrime` uses an explicit `force?: boolean`** to override the roll (deterministic seam) — NOT a fake-`rng` trick. `detected = opts.force ?? detect(...)`.
2. **The dev seam is gated on `!liveMode`** (`server.ts:83` `const liveMode = !!live` — the 0G **Compute** provider, not `MEMORY_URL`). The `extort` handler honors `msg.caught` ONLY when `!liveMode`.
3. **`viewer.js` crime branch must precede the rap `else`** (the credit loop is `if(lend)…else if(default)…else(rap)`).
4. **Spike asserts uncaught→"still served" via `talk`/`look`** (no sanction gate), not `pitch`.
5. **Crime is narrative-only** — no world $0G move (②c-1 finding).

---

## File Structure

**Kit submodule (cognition package):**
- `kit/packages/cognition/src/society/crime.ts` — `P_DETECT`, `CrimeKind`, `detect`, `attemptCrime`
- `kit/packages/cognition/src/__tests__/crime.smoke.ts`
- `kit/packages/cognition/package.json` — add `test:crime`
- `kit/packages/cognition/src/index.ts` — re-export the new symbols

**Kit submodule (replay package):**
- `kit/packages/replay/src/packs/town.ts` — add `town.crime` (+ invariant)
- `kit/packages/replay/src/__tests__/town-pack.smoke.ts` — update `deepEqual` + asserts
- `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js` — render `town.crime`

**0gtown repo:**
- `src/server.ts` — the `extort` command
- `src/spike.ts` — assert both detection paths

---

### Task 1: crime.ts (detect + attemptCrime) + barrel

**Files:**
- Modify: `kit/packages/cognition/package.json` (add `test:crime`)
- Create: `kit/packages/cognition/src/society/crime.ts`
- Modify: `kit/packages/cognition/src/index.ts`
- Test: `kit/packages/cognition/src/__tests__/crime.smoke.ts`

- [ ] **Step 1: Branch the kit submodule**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git checkout -b crime
git log --oneline -1   # expect the society HEAD (899809f town lend/default/rap)
cd /Volumes/T7-Data/aigg-0gtown
```

- [ ] **Step 2: Add the `test:crime` script to `kit/packages/cognition/package.json`**

In `"scripts"`, after `"test:society"`, add:

```json
    "test:crime": "tsx src/__tests__/crime.smoke.ts"
```

(Add a trailing comma on the previous entry so the JSON stays valid.)

- [ ] **Step 3: Write the failing test `kit/packages/cognition/src/__tests__/crime.smoke.ts`**

```ts
/** Smoke for the crime primitive. Run: pnpm --filter @onchainpal/cognition test:crime */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';
import { TrustLedger } from '../social/trust';
import { Cognition } from '../cognition';
import { RapSheet } from '../society/rapsheet';
import { detect, attemptCrime, P_DETECT } from '../society/crime';

async function main() {
  assert.equal(P_DETECT, 0.5);
  // detect honors the injected rng
  assert.equal(detect(0.5, () => 0), true, 'rng 0 < 0.5 → caught');
  assert.equal(detect(0.5, () => 0.9), false, 'rng 0.9 ≥ 0.5 → not caught');

  const victim = 'npc:han', offender = 'visitor:1';

  // uncaught (rng high) → no rap, no belief
  const cog1 = new Cognition(new FakeKernel(), new TrustLedger());
  const rap1 = new RapSheet();
  const r1 = await attemptCrime(cog1, rap1, victim, offender, 'sabotage', 1, { rng: () => 0.99 });
  assert.equal(r1.detected, false, 'uncaught');
  assert.equal(r1.topic, undefined, 'no topic when uncaught');
  assert.equal(rap1.has(offender), false, 'uncaught → no rap entry');

  // caught (rng 0) → rap entry + offender-scoped belief
  const cog2 = new Cognition(new FakeKernel(), new TrustLedger());
  const rap2 = new RapSheet();
  const r2 = await attemptCrime(cog2, rap2, victim, offender, 'sabotage', 1, { rng: () => 0, detail: 'trashed the stall' });
  assert.equal(r2.detected, true, 'caught');
  assert.ok(r2.topic, 'topic returned on catch');
  assert.equal(rap2.has(offender), true, 'caught → rap written');
  assert.equal(rap2.entries(offender)[0].kind, 'sabotage', 'rap kind is the crime kind');
  const sig = await cog2.recall(victim, offender, r2.topic!);
  assert.equal(sig.discernment.q, 1, 'victim recalls the crime belief');

  // force overrides the roll (the deterministic dev seam)
  const cog3 = new Cognition(new FakeKernel(), new TrustLedger());
  const rap3 = new RapSheet();
  const r3 = await attemptCrime(cog3, rap3, victim, offender, 'extort', 1, { force: true, rng: () => 0.99 });
  assert.equal(r3.detected, true, 'force:true overrides the roll → caught');
  assert.equal(rap3.has(offender), true, 'force:true wrote a rap');

  const cog4 = new Cognition(new FakeKernel(), new TrustLedger());
  const rap4 = new RapSheet();
  const r4 = await attemptCrime(cog4, rap4, victim, offender, 'extort', 1, { force: false, rng: () => 0 });
  assert.equal(r4.detected, false, 'force:false overrides the roll → uncaught');
  assert.equal(rap4.has(offender), false, 'force:false wrote no rap');

  console.log('ALL CRIME SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('CRIME SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:crime`
Expected: FAIL — `Cannot find module '../society/crime'`.

- [ ] **Step 5: Write `kit/packages/cognition/src/society/crime.ts`**

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

/** Attempt a crime: roll detection (or use `force` if given); on catch, write the SAME misconduct signal a
 *  default does (rap entry + offender-scoped belief + one-time trust drop, via recordMisconduct). Uncaught →
 *  no trail. Best-effort (recordMisconduct is non-throwing). `force` overrides the roll — for deterministic tests. */
export async function attemptCrime(
  cognition: Cognition, rapSheet: RapSheet,
  victim: string, offender: string, kind: CrimeKind, now: number,
  opts: { detectP?: number; rng?: () => number; force?: boolean; detail?: string } = {},
): Promise<{ detected: boolean; topic?: string }> {
  const detected = opts.force ?? detect(opts.detectP ?? P_DETECT, opts.rng);
  if (!detected) return { detected: false };
  const topic = await recordMisconduct(cognition, rapSheet, victim, offender, kind, now, opts.detail);
  return { detected: true, topic };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:crime`
Expected: `ALL CRIME SMOKE TESTS PASSED ✅`

- [ ] **Step 7: Re-export from the barrel `kit/packages/cognition/src/index.ts`**

Append before the end of the file:

```ts
export { detect, attemptCrime, P_DETECT } from './society/crime';
export type { CrimeKind } from './society/crime';
```

- [ ] **Step 8: Full cognition suite + typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance rapsheet lending society crime; do pnpm --filter @onchainpal/cognition run test:$s || break; done && pnpm --filter @onchainpal/cognition exec tsc --noEmit`
Expected: 14 PASS banners; tsc clean.

- [ ] **Step 9: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/package.json packages/cognition/src/society/crime.ts packages/cognition/src/index.ts packages/cognition/src/__tests__/crime.smoke.ts
git commit -m "feat(cognition): crime primitive — detect + attemptCrime (2nd misconduct source)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 2: Extend the replay `town@0` pack with town.crime

**Files (kit submodule, replay package):**
- Modify: `kit/packages/replay/src/packs/town.ts`
- Modify: `kit/packages/replay/src/__tests__/town-pack.smoke.ts`
- Modify: `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js`

- [ ] **Step 1: Add `town.crime` + a validator in `kit/packages/replay/src/packs/town.ts`**

Extend `eventKinds` to (append `'town.crime'` after `'town.rap'`, → 14 kinds):

```ts
  eventKinds: ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction', 'town.lend', 'town.default', 'town.rap', 'town.crime'],
```

In `validateEvent`, after the existing `town.rap` check and before `return errs;`, add:

```ts
    if (ev.kind === 'town.crime' && (!d.offender || !d.kind || typeof d.caught !== 'boolean')) {
      errs.push('town.crime requires data.offender, data.kind, and a boolean data.caught');
    }
```

- [ ] **Step 2: Update the `deepEqual` + add asserts in `kit/packages/replay/src/__tests__/town-pack.smoke.ts`**

Replace the `deepEqual(townPack.eventKinds, [...])` with the 14-element array:

```ts
assert.deepEqual(townPack.eventKinds, ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction', 'town.lend', 'town.default', 'town.rap', 'town.crime']);
```

Add near the other `errs(...)` checks:

```ts
assert.equal(errs({ kind: 'town.crime', data: { offender: 'visitor:1', kind: 'sabotage', caught: true } }).length, 0, 'valid crime ok');
assert.ok(errs({ kind: 'town.crime', data: { offender: 'visitor:1', kind: 'sabotage' } }).length > 0, 'crime missing caught fails');
assert.ok(errs({ kind: 'town.crime', data: { offender: 'visitor:1', kind: 'sabotage', caught: 'yes' } }).length > 0, 'crime non-boolean caught fails');
```

- [ ] **Step 3: Run the town-pack smoke**

Run: `pnpm --filter @onchainpal/replay test:town`
Expected: `ALL TOWN-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 4: Add a `town.crime` reduce case in `kit/packages/replay/viewer/viewer-core.js` `townLedger`**

Inside the `for (const ev of tick.events || [])` loop, after the existing `town.rap` case, add:

```js
      if (ev.kind === 'town.crime') credit.push({ kind: 'crime', offender: d.offender, crimeKind: d.kind, victim: d.victim, caught: d.caught, t: tick.t });
```

(The `credit` array and its return are already present from ②c-1 — this is purely additive.)

- [ ] **Step 5: Render it in `kit/packages/replay/viewer/viewer.js` — BEFORE the rap `else`**

In the `'town-ledger'` renderer's credit loop (`if (c.kind === 'lend') … else if (c.kind === 'default') … else …`), insert a `crime` branch **before the final `else`** (which is the rap catch-all):

```js
      else if (c.kind === 'crime') label = `${esc(c.offender)} ${esc(c.crimeKind)} ${esc(c.victim)} — ${c.caught ? 'CAUGHT' : 'got away'}`;
```

(So the chain is `if lend … else if default … else if crime … else (rap)`. The `⚔`/`💱` glyph prefix follows the existing credit-row pattern.)

- [ ] **Step 6: Re-run the replay suite**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: each prints its PASS banner.

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/src/__tests__/town-pack.smoke.ts packages/replay/viewer/viewer-core.js packages/replay/viewer/viewer.js
git commit -m "feat(replay): town@0 gains town.crime event (caught/got-away visible)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 3: Wire the `extort` verb into 0gtown

**Files (0gtown repo):**
- Modify: `src/server.ts`
- Modify: `src/spike.ts`

First read the server to place edits precisely.

- [ ] **Step 1: Read the server's borrow handler, imports, and `liveMode`**

Run: `grep -n "msg.cmd === 'borrow'\|from '@onchainpal/cognition'\|const liveMode\|polity.sanctioned\|attemptCrime\|misconductTopic\|runRapSanction\|findNpc\|guildIds\|nowSeq\|rec.tick(++replayT" src/server.ts`
Expected: the `borrow` branch (the template to mirror), the `@onchainpal/cognition` import line, `const liveMode = !!live` (~:83), and the in-scope symbols (`polity`/`rapSheet`/`cognition`/`guildIds`/`nowSeq`/`findNpc`/`round0G`/`runRapSanction`/`misconductTopic` — the last two already imported in ②b/②c-1).

- [ ] **Step 2: Add `attemptCrime` to the `@onchainpal/cognition` import**

Add `attemptCrime` to the existing import (which already has `RapSheet, LoanBook, recordMisconduct, runRapSanction, misconductTopic, Polity, …`):

```ts
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse, Polity, runSanctionVote, RapSheet, LoanBook, recordMisconduct, runRapSanction, misconductTopic, attemptCrime } from '@onchainpal/cognition';
```

(Match the real existing import — add only `attemptCrime` if the others are already there.)

- [ ] **Step 3: Add the `extort` command branch (mirror `borrow`)**

Add a new `if (msg.cmd === 'extort')` branch alongside `borrow`/`pitch`. Adapt `npc`/`visitorId`/`rec`/`replayT`/`liveMode` to the real identifiers from Step 1:

```ts
if (msg.cmd === 'extort') {
  const npc = findNpc(String(msg.npc ?? ''));
  if (!npc) { sendJson({ type: 'error', text: 'no such stall' }); return; }
  if (polity.sanctioned(visitorId)) {            // sanction-first: a barred thug can't extort either
    sendJson({ type: 'extorted', npc: npc.name, caught: false, protected: true, reason: 'The night-market guild has barred you.' });
    return;
  }
  // dev-mode test seam: honor an explicit msg.caught ONLY when NOT in live (0G Compute) mode; else roll
  const crimeOpts = (!liveMode && typeof msg.caught === 'boolean') ? { force: msg.caught as boolean } : {};
  const { detected } = await attemptCrime(cognition, rapSheet, npc.id, visitorId, 'sabotage', nowSeq, crimeOpts);
  try {
    rec.tick(++replayT);
    rec.event('town.crime', { actor: visitorId, target: npc.id, by: 'engine', data: { offender: visitorId, kind: 'sabotage', victim: npc.id, caught: detected } });
    if (detected) {
      rec.event('town.rap', { actor: visitorId, by: 'engine', data: { offender: visitorId, kind: 'sabotage', victim: npc.id } });
      const round = await runRapSanction(rapSheet, polity, npc.id, visitorId, guildIds, { until: Infinity });
      if (round) {
        rec.event('town.propose', { actor: npc.id, target: visitorId, by: 'npc', data: { proposer: npc.id, target: visitorId, topic: misconductTopic(visitorId), pid: round.pid } });
        for (const [voter, choice] of Object.entries(round.votes)) {
          if (voter === npc.id) continue;
          rec.event('town.vote', { actor: voter, target: visitorId, by: 'npc', data: { voter, choice, pid: round.pid } });
        }
        rec.event('town.sanction', { actor: npc.id, target: visitorId, by: 'engine', data: { target: visitorId, passed: round.result.passed, shareFor: round.result.shareFor } });
      }
    }
    rec.flush();
  } catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
  if (detected) sendJson({ type: 'extorted', npc: npc.name, caught: true, banned: true, reason: 'You demanded protection, trashed the stall, and got caught — the night-market guild has barred you.' });
  else sendJson({ type: 'extorted', npc: npc.name, caught: false, reason: 'You shook down the stall and slipped away — this time.' });
  return;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Fix any identifier mismatches against the real handler from Step 1.

- [ ] **Step 5: Extend `src/spike.ts` to assert both detection paths**

Add two fresh-WS-connection arcs after the existing ones, before the replay-validation block. Reuse the spike's `pitchExpectProtectedOn` helper (from ②b) and the `claim` variable. Add `WebSocket`/`PORT` are already in scope (the spike uses them).

```ts
// crime — CAUGHT extortion → rap → guild ban
const ws4 = new WebSocket(`ws://localhost:${PORT}/play`);
await new Promise<void>((res) => ws4.on('open', () => res()));
const ex1 = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'extorted') { ws4.off('message', onMsg); res(m); } };
  ws4.on('message', onMsg);
  ws4.send(JSON.stringify({ cmd: 'extort', npc: 'Fishmonger Mei', caught: true }));   // dev seam: force caught
});
assert.equal(ex1.caught, true, 'caught extortion');
assert.ok(await pitchExpectProtectedOn(ws4, 'A-Bao', claim, true), 'a caught thug is banned guild-wide');
ws4.close();

// crime — UNCAUGHT extortion → no rap → not banned (still served via talk)
const ws5 = new WebSocket(`ws://localhost:${PORT}/play`);
await new Promise<void>((res) => ws5.on('open', () => res()));
const ex2 = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'extorted') { ws5.off('message', onMsg); res(m); } };
  ws5.on('message', onMsg);
  ws5.send(JSON.stringify({ cmd: 'extort', npc: 'Fishmonger Mei', caught: false }));   // dev seam: force uncaught
});
assert.equal(ex2.caught, false, 'uncaught extortion (got away)');
// "still served": a talk succeeds (talk has no sanction gate — decoupled from the pitch learn-gate)
const talked = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'talked') { ws5.off('message', onMsg); res(m); } };
  ws5.on('message', onMsg);
  ws5.send(JSON.stringify({ cmd: 'talk', npc: 'A-Bao', text: 'evening, friend' }));
});
assert.ok(talked.said !== undefined, 'an uncaught thug is still served (talk succeeds — not banned)');
console.log('✓ crime arc: extort caught → rap → guild ban; uncaught → got away → still served');
ws5.close();
```

Then extend the replay event-kind assertion to also require `town.crime`:

```ts
if (!kinds.has('town.crime')) { console.error('expected a town.crime event in the replay stream'); process.exit(1); }
```

- [ ] **Step 6: Run the spike (FakeKernel — no sidecar; `liveMode` false → the `caught` seam is honored)**

Run: `pnpm spike`
Expected: the prior arcs, then `✓ crime arc: extort caught → rap → guild ban; uncaught → got away → still served`, the replay-validation line now listing `town.crime`, exit 0.

- [ ] **Step 7: Commit (in the 0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/server.ts src/spike.ts
git commit -m "feat: 0gtown extort verb — caught thug rap-banned, uncaught gets away"
```

---

### Task 4: Finalize — submodule bump + end-to-end

- [ ] **Step 1: Run the full kit suites (cognition + replay)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance rapsheet lending society crime; do pnpm --filter @onchainpal/cognition run test:$s || break; done && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: all PASS banners (14 cognition + 5 replay), no break.

- [ ] **Step 2: Bump the kit submodule pointer (0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git log --oneline -1   # note the crime HEAD
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @onchainpal/cognition ②c-2 crime + replay town.crime"
```

- [ ] **Step 3: Final end-to-end**

Run: `pnpm typecheck && pnpm spike`
Expected: typecheck clean; spike prints all arcs (cognition, governance, society/deadbeat, crime) and the replay-validation line with `town.crime`, exit 0. Confirm `git ls-tree HEAD kit | awk '{print $3}'` equals `git -C kit rev-parse HEAD`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 crime.ts (`detect`, `attemptCrime` with `force`) → Task 1; the crime smoke asserts detect-by-rng, caught→rap+belief, uncaught→no-rap, and force overriding the roll both ways.
- §4 replay `town.crime` (4-site + validator + viewer crime-before-rap) → Task 2.
- §5 0gtown `extort` (sanction-first, narrative sabotage, `!liveMode` `force` seam, caught→rap→ban / uncaught→free, emits) → Task 3.
- §6 testing (crime smoke + spike both paths, served-via-talk) → Tasks 1/3.

**Audit facts honored:** `attemptCrime` `force?` not a fake-rng (Task 1 code + smoke); the seam gated on `!liveMode` (Task 3 Step 3); the `viewer.js` crime branch inserted BEFORE the rap `else` (Task 2 Step 5); the spike's "still served" asserts via `talk` (Task 3 Step 5); crime is narrative-only (no world $0G move in the `extort` handler).

**Placeholder scan:** no TBD/TODO; every code step is complete. The "adapt identifiers" notes in Task 3 are inherent to editing the existing handler; Step 1's grep surfaces them.

**Type consistency:** `detect(p?, rng?)`, `attemptCrime(cognition, rapSheet, victim, offender, kind, now, opts)` returning `{detected, topic?}`, `CrimeKind`/`P_DETECT`, and the reused `recordMisconduct`/`runRapSanction`/`misconductTopic` signatures match the shipped ②c-1 code. The `town.crime` `data` shape (`offender`/`kind`/`victim`/`caught`) is consistent between Task 2 (pack validator + viewer) and Task 3 (server emit).

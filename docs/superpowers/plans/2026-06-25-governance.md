# @onchainpal/cognition ②b — governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add governance to `@onchainpal/cognition` ②b — a clock-agnostic `Polity` (propose/vote/tally + sanction/blacklist) and belief-gating helpers that compose ②a's `Cognition`, wired into 0gtown so a ~5-NPC night-market guild collectively bans a scammer visitor (one scam → A-Bao warns the guild → belief-gated votes pass → the visitor's pitches are refused outright).

**Architecture:** A new `governance/` module in the existing cognition package: `polity.ts` (pure, in-memory proposal state machine; no clock — the host calls `tally`) + `voting.ts` (the only ②a-aware code: `voteBeliefGated`/`runSanctionVote` over a `Cognition`). 0gtown drives it synchronously. Full design: [docs/superpowers/specs/2026-06-25-governance-design.md](2026-06-25-governance-design.md).

**Tech Stack:** TypeScript (ESM, Node ≥20), pnpm workspace, `tsx` smoke tests with `node:assert/strict`. Unit-tested entirely with the ②a `FakeKernel` — no aigg-memory service, no clock.

---

## ⚠️ Two-repo commit discipline + branch context (read first)

- Branch is **`governance`**, which stacks on `cognition-social` → `replay-library`. The cognition package (②a) and the extended replay `town@0` pack are present on this branch. 0gtown is already on `governance`.
- `kit/` is a **git submodule**. Files under `kit/packages/cognition/` and `kit/packages/replay/` are committed **inside the submodule** (`cd /Volumes/T7-Data/aigg-0gtown/kit && git ...`). The kit submodule is on `cognition-social` and must be put on a `governance` branch in Task 1.
- 0gtown-repo files (`src/server.ts`, `src/spike.ts`, `public/index.html`) are committed at the repo root.
- All `pnpm` commands run from `/Volumes/T7-Data/aigg-0gtown`.

### Load-bearing facts from the design audit (do not deviate)

1. **Belief gate is TOPIC-scoped.** `voteBeliefGated` votes 'for' when `recall(voter, target, topic).discernment.q > 0` (the voter learned or was warned about the *claim*) **or** `trust < trustFloor`. `recall` ignores `target` for discernment — this bans a visitor for *using a known-scam claim*. Correct and intended; do not try to make it per-visitor.
2. **Sanction enactor uses `Math.max`** so a later finite `until` can't shorten an active blacklist (the `govern.py:88-93` invariant).
3. **0gtown wiring**: generalize BOTH the warn call AND the hardcoded `town.warn` replay emit; the guild-ban refusal MUST keep `protected:true`+`claim` (the `town.refuse` validator requires them); `bannedByGuild` is additive in `data`.

---

## File Structure

**Kit submodule (cognition package):**
- `kit/packages/cognition/src/governance/polity.ts` — `Polity`, `Proposal`, `Choice`, `TallyResult`, `Enactor`, `PolityOpts`
- `kit/packages/cognition/src/governance/voting.ts` — `voteBeliefGated`, `runSanctionVote`
- `kit/packages/cognition/src/__tests__/polity.smoke.ts`, `governance.smoke.ts`
- `kit/packages/cognition/package.json` — add `test:polity`, `test:governance` scripts
- `kit/packages/cognition/src/index.ts` — re-export the new symbols

**Kit submodule (replay package):**
- `kit/packages/replay/src/packs/town.ts` — add `town.propose`/`town.vote`/`town.sanction` (+ light invariants)
- `kit/packages/replay/src/__tests__/town-pack.smoke.ts` — update the exact `deepEqual` + add invariant asserts
- `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js` — render a "Guild" section

**0gtown repo:**
- `src/server.ts` — enrich `TOWNSFOLK`; `Polity` at startup; sanction-first pitch check; generalize warn→guild (+ its `town.warn` emit); `runSanctionVote`; emit `town.propose`/`vote`/`sanction`
- `src/spike.ts` — assert the guild-ban cascade
- `public/index.html` — verify/adjust it renders N NPCs

---

### Task 1: Polity (clock-agnostic proposal state machine)

**Files:**
- Modify: `kit/packages/cognition/package.json` (add two test scripts)
- Create: `kit/packages/cognition/src/governance/polity.ts`
- Test: `kit/packages/cognition/src/__tests__/polity.smoke.ts`

- [ ] **Step 1: Branch the kit submodule**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git checkout -b governance
git log --oneline -1   # expect the cognition-social HEAD (15eabfd recall dedupe)
cd /Volumes/T7-Data/aigg-0gtown
```

- [ ] **Step 2: Add the two test scripts to `kit/packages/cognition/package.json`**

In the `"scripts"` object, after `"test:aigg"`, add:

```json
    "test:polity": "tsx src/__tests__/polity.smoke.ts",
    "test:governance": "tsx src/__tests__/governance.smoke.ts"
```

(Add a comma after the previous entry as needed so the JSON stays valid.)

- [ ] **Step 3: Write the failing test `kit/packages/cognition/src/__tests__/polity.smoke.ts`**

```ts
/** Smoke for the Polity proposal state machine. Run: pnpm --filter @onchainpal/cognition test:polity */
import assert from 'node:assert/strict';
import { Polity } from '../governance/polity';

async function main() {
  // submit seeds the proposer 'for'
  const p = new Polity();
  const pid = p.submit('a', 'sanction', { target: 'v' });
  assert.equal(p.get(pid)!.votes.get('a'), 'for', 'proposer pre-seeded for');

  // cast rejects self-vote, double-vote, unknown pid (no throw)
  p.cast(pid, 'a', 'against');
  assert.equal(p.get(pid)!.votes.get('a'), 'for', 'self-vote ignored');
  p.cast(pid, 'b', 'for');
  p.cast(pid, 'b', 'against');
  assert.equal(p.get(pid)!.votes.get('b'), 'for', 'double-vote ignored (first wins)');
  p.cast('nope', 'b', 'for'); // unknown pid → no throw

  // tally passes at >= threshold (a,b for, c against → 2/3 ≥ 0.6) and enacts the sanction
  const r = p.tally(pid, ['a', 'b', 'c']);
  assert.equal(r.passed, true, 'pass at 2/3');
  assert.ok(Math.abs(r.shareFor - 2 / 3) < 1e-9, 'shareFor = 2/3');
  assert.deepEqual(r.effect, { target: 'v', until: Infinity }, 'sanction enacted');
  assert.equal(p.get(pid), undefined, 'proposal removed after tally');
  assert.equal(p.sanctioned('v'), true, 'v sanctioned (until Infinity)');
  assert.equal(p.sanctioned('other'), false, 'unrelated target not sanctioned');

  // fails below threshold (1/3 < 0.6) → no sanction
  const p2 = new Polity();
  const pid2 = p2.submit('a', 'sanction', { target: 'v' });
  p2.cast(pid2, 'b', 'against');
  p2.cast(pid2, 'c', 'against');
  assert.equal(p2.tally(pid2, ['a', 'b', 'c']).passed, false, 'fail at 1/3');
  assert.equal(p2.sanctioned('v'), false, 'no sanction on a failed vote');

  // Math.max: a later finite `until` must NOT shorten an active (Infinity) ban
  const p3 = new Polity();
  p3.tally(p3.submit('a', 'sanction', { target: 'v', until: Infinity }), ['a']);
  p3.tally(p3.submit('a', 'sanction', { target: 'v', until: 5 }), ['a']);
  assert.equal(p3.sanctioned('v', 1000), true, 'Infinity ban not shortened by a later until:5');

  // finite until + now (strict >)
  const p4 = new Polity();
  p4.tally(p4.submit('a', 'sanction', { target: 'v', until: 10 }), ['a']);
  assert.equal(p4.sanctioned('v', 5), true, 'sanctioned before expiry');
  assert.equal(p4.sanctioned('v', 10), false, 'not sanctioned at expiry (strict >)');

  // pluggable enactor for a non-built-in ptype
  const p5 = new Polity({ enactors: { tax: (payload) => ({ taxed: payload.rate }) } });
  assert.deepEqual(p5.tally(p5.submit('a', 'tax', { rate: 0.1 }), ['a']).effect, { taxed: 0.1 }, 'custom enactor ran');

  // unknown ptype with no enactor → passes, effect undefined, no throw
  const p6 = new Polity();
  const r6 = p6.tally(p6.submit('a', 'mystery', {}), ['a']);
  assert.equal(r6.passed, true);
  assert.equal(r6.effect, undefined, 'unknown ptype enacts to no-op');

  // threshold honored (custom 1.0 needs unanimity)
  const p7 = new Polity({ threshold: 1.0 });
  const id7 = p7.submit('a', 'sanction', { target: 'v' });
  p7.cast(id7, 'b', 'against');
  assert.equal(p7.tally(id7, ['a', 'b']).passed, false, 'unanimity threshold not met');

  console.log('ALL POLITY SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('POLITY SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:polity`
Expected: FAIL — `Cannot find module '../governance/polity'`.

- [ ] **Step 5: Write `kit/packages/cognition/src/governance/polity.ts`**

```ts
export type Choice = 'for' | 'against';

export interface Proposal {
  pid: string;
  proposer: string;
  ptype: string;                       // 'sanction' | host-registered types
  payload: Record<string, unknown>;
  votes: Map<string, Choice>;          // proposer pre-seeded 'for'
}

export interface TallyResult { passed: boolean; shareFor: number; effect?: Record<string, unknown> }

export type Enactor = (payload: Record<string, unknown>, polity: Polity) => Record<string, unknown>;

export interface PolityOpts { threshold?: number; enactors?: Record<string, Enactor> }

/** A pure, clock-agnostic proposal state machine: submit → cast → tally. The host
 *  decides WHEN to tally (0gtown synchronously; a tick host after a window). */
export class Polity {
  private proposals = new Map<string, Proposal>();
  private blacklist = new Map<string, number>();   // target -> until
  private seq = 0;
  private threshold: number;
  private enactors: Record<string, Enactor>;

  constructor(opts: PolityOpts = {}) {
    this.threshold = opts.threshold ?? 0.6;
    this.enactors = opts.enactors ?? {};
  }

  submit(proposer: string, ptype: string, payload: Record<string, unknown> = {}): string {
    const pid = `p${this.seq++}`;
    this.proposals.set(pid, { pid, proposer, ptype, payload, votes: new Map([[proposer, 'for']]) });
    return pid;
  }

  cast(pid: string, voter: string, choice: Choice): void {
    const pr = this.proposals.get(pid);
    if (!pr || voter === pr.proposer || pr.votes.has(voter)) return;   // no unknown/self/double vote
    pr.votes.set(voter, choice);
  }

  get(pid: string): Proposal | undefined { return this.proposals.get(pid); }

  /** shareFor = #'for' / max(1, pool.length); passed iff ≥ threshold. Enacts on pass; removes the proposal. */
  tally(pid: string, voterPool: string[]): TallyResult {
    const pr = this.proposals.get(pid);
    if (!pr) return { passed: false, shareFor: 0 };
    let fors = 0;
    for (const v of voterPool) if (pr.votes.get(v) === 'for') fors++;
    const shareFor = fors / Math.max(1, voterPool.length);
    const passed = shareFor >= this.threshold;
    const effect = passed ? this.enact(pr) : undefined;
    this.proposals.delete(pid);
    return { passed, shareFor, effect };
  }

  sanctioned(target: string, now = 0): boolean {
    return (this.blacklist.get(target) ?? -Infinity) > now;
  }

  private enact(pr: Proposal): Record<string, unknown> | undefined {
    if (pr.ptype === 'sanction') {
      const target = String(pr.payload.target);
      const until = typeof pr.payload.until === 'number' ? pr.payload.until : Infinity;
      // Math.max: a later-enacted proposal must never shorten an active blacklist (govern.py:88-93).
      this.blacklist.set(target, Math.max(this.blacklist.get(target) ?? -Infinity, until));
      return { target, until };
    }
    const fn = this.enactors[pr.ptype];
    return fn ? fn(pr.payload, this) : undefined;   // unknown ptype → no-op, never throws
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:polity`
Expected: `ALL POLITY SMOKE TESTS PASSED ✅`

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/package.json packages/cognition/src/governance/polity.ts packages/cognition/src/__tests__/polity.smoke.ts
git commit -m "feat(cognition): Polity — clock-agnostic proposal state machine + sanction/blacklist"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 2: Belief-gating bridge + barrel

**Files:**
- Create: `kit/packages/cognition/src/governance/voting.ts`
- Modify: `kit/packages/cognition/src/index.ts` (re-export governance)
- Test: `kit/packages/cognition/src/__tests__/governance.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/governance.smoke.ts`**

```ts
/** Smoke for the belief-gating bridge (composes ②a Cognition + Polity).
 *  Run: pnpm --filter @onchainpal/cognition test:governance */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';
import { TrustLedger } from '../social/trust';
import { Cognition } from '../cognition';
import { Polity } from '../governance/polity';
import { voteBeliefGated, runSanctionVote } from '../governance/voting';
import type { MemoryKernel } from '../kernel/port';

async function main() {
  const topic = 'elixir';
  const V = 'visitor:1';
  const guild = ['npc:a', 'npc:b', 'npc:c', 'npc:d', 'npc:e'];

  // A learns the scam, then warns the rest of the guild (②a)
  const cog = new Cognition(new FakeKernel(), new TrustLedger());
  await cog.learn('npc:a', V, { topic, description: 'the elixir pitch cost me 3 $0G', outcome: 'loss' });
  for (const g of guild) if (g !== 'npc:a') await cog.warn('npc:a', g, topic);

  // a warned member votes 'for'; an unwarned outsider votes 'against'
  assert.equal(await voteBeliefGated(cog, 'npc:b', V, topic), 'for', 'warned member votes for');
  assert.equal(await voteBeliefGated(cog, 'npc:zzz', V, topic), 'against', 'unwarned outsider votes against');

  // runSanctionVote PASSES with a warned guild
  const polity = new Polity();
  const round = await runSanctionVote(cog, polity, 'npc:a', V, topic, guild, { until: Infinity });
  assert.ok(round, 'proposer believes → a round runs');
  assert.equal(round!.result.passed, true, 'warned guild passes the ban');
  assert.equal(polity.sanctioned(V), true, 'visitor is sanctioned');

  // FAILS when only the proposer believes (no warnings) → 1/5 < 0.6
  const cog2 = new Cognition(new FakeKernel(), new TrustLedger());
  await cog2.learn('npc:a', V, { topic, description: 'lost', outcome: 'loss' });
  const polity2 = new Polity();
  const round2 = await runSanctionVote(cog2, polity2, 'npc:a', V, topic, guild, { until: Infinity });
  assert.equal(round2!.result.passed, false, 'only proposer believes → fails');
  assert.equal(polity2.sanctioned(V), false, 'no ban on a failed vote');

  // proposer doesn't believe → null (no proposal opened)
  const cog3 = new Cognition(new FakeKernel(), new TrustLedger());
  assert.equal(await runSanctionVote(cog3, new Polity(), 'npc:a', V, topic, guild), null, 'no belief → null');

  // fails-closed: a throwing kernel makes every vote 'against'
  const boom: MemoryKernel = {
    remember: async () => { throw new Error('down'); },
    discernment: async () => { throw new Error('down'); },
    verify: async () => { throw new Error('down'); },
    select: async () => { throw new Error('down'); },
    reflect: async () => { throw new Error('down'); },
  };
  const cog4 = new Cognition(boom, new TrustLedger());
  assert.equal(await voteBeliefGated(cog4, 'npc:b', V, topic), 'against', 'kernel down → against (fails closed)');

  console.log('ALL GOVERNANCE SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('GOVERNANCE SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onchainpal/cognition test:governance`
Expected: FAIL — `Cannot find module '../governance/voting'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/governance/voting.ts`**

```ts
import type { Cognition } from '../cognition';
import type { Polity, Choice, TallyResult } from './polity';

/** Vote 'for' sanctioning `target` iff the voter recognizes the scam CLAIM (topic belief,
 *  which ②a's warning diffuses) OR distrusts the target. Best-effort via ②a's recall:
 *  a memory outage yields a neutral signal ⇒ 'against' (fails closed — no ban). */
export async function voteBeliefGated(
  cognition: Cognition, voter: string, target: string, topic: string,
  opts: { trustFloor?: number } = {},
): Promise<Choice> {
  const trustFloor = opts.trustFloor ?? -0.5;
  const sig = await cognition.recall(voter, target, topic);
  return (sig.discernment.q > 0 || sig.trust < trustFloor) ? 'for' : 'against';
}

/** A full synchronous sanction round for an event-driven host: if the proposer believes,
 *  submit a sanction, have every guild member cast a belief-gated vote, then tally NOW.
 *  Returns null if the proposer doesn't believe (no proposal opened). */
export async function runSanctionVote(
  cognition: Cognition, polity: Polity,
  proposer: string, target: string, topic: string, guild: string[],
  opts: { until?: number; trustFloor?: number } = {},
): Promise<{ pid: string; result: TallyResult; votes: Record<string, Choice> } | null> {
  if ((await voteBeliefGated(cognition, proposer, target, topic, opts)) !== 'for') return null;
  const pid = polity.submit(proposer, 'sanction', { target, until: opts.until ?? Infinity, topic });
  const votes: Record<string, Choice> = { [proposer]: 'for' };
  for (const member of guild) {
    if (member === proposer) continue;
    const choice = await voteBeliefGated(cognition, member, target, topic, opts);
    polity.cast(pid, member, choice);
    votes[member] = choice;
  }
  return { pid, result: polity.tally(pid, guild), votes };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onchainpal/cognition test:governance`
Expected: `ALL GOVERNANCE SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Re-export governance from the barrel `kit/packages/cognition/src/index.ts`**

Append before the end of the file:

```ts
export { Polity } from './governance/polity';
export type { Choice, Proposal, TallyResult, Enactor, PolityOpts } from './governance/polity';
export { voteBeliefGated, runSanctionVote } from './governance/voting';
```

- [ ] **Step 6: Full cognition suite + typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance; do pnpm --filter @onchainpal/cognition run test:$s || break; done && pnpm --filter @onchainpal/cognition exec tsc --noEmit`
Expected: ten PASS banners; tsc clean.

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/governance/voting.ts packages/cognition/src/index.ts packages/cognition/src/__tests__/governance.smoke.ts
git commit -m "feat(cognition): belief-gating bridge (voteBeliefGated/runSanctionVote) + barrel"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 3: Extend the replay `town@0` pack with propose/vote/sanction

**Files (kit submodule, replay package):**
- Modify: `kit/packages/replay/src/packs/town.ts`
- Modify: `kit/packages/replay/src/__tests__/town-pack.smoke.ts`
- Modify: `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js`

- [ ] **Step 1: Add the three kinds + light invariants in `kit/packages/replay/src/packs/town.ts`**

Extend the `eventKinds` array to:

```ts
  eventKinds: ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction'],
```

In `validateEvent`, after the existing `town.anchor` check and before `return errs;`, add two invariants:

```ts
    if (ev.kind === 'town.vote' && d.choice !== 'for' && d.choice !== 'against') {
      errs.push("town.vote requires data.choice of 'for' or 'against'");
    }
    if (ev.kind === 'town.sanction' && typeof d.passed !== 'boolean') {
      errs.push('town.sanction requires a boolean data.passed');
    }
```

- [ ] **Step 2: Update the shipped exact `deepEqual` + add invariant asserts in `kit/packages/replay/src/__tests__/town-pack.smoke.ts`**

Replace the `deepEqual(townPack.eventKinds, [...])` assertion with:

```ts
assert.deepEqual(townPack.eventKinds, ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction']);
```

Add invariant assertions near the other `errs(...)` checks (use the existing `errs` helper in that test):

```ts
assert.equal(errs({ kind: 'town.vote', data: { choice: 'for' } }).length, 0, 'valid vote ok');
assert.ok(errs({ kind: 'town.vote', data: { choice: 'maybe' } }).length > 0, 'bad vote choice fails');
assert.equal(errs({ kind: 'town.sanction', data: { passed: true } }).length, 0, 'valid sanction ok');
assert.ok(errs({ kind: 'town.sanction', data: {} }).length > 0, 'sanction without passed fails');
```

- [ ] **Step 3: Run the town-pack smoke**

Run: `pnpm --filter @onchainpal/replay test:town`
Expected: `ALL TOWN-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 4: Surface a Guild model in `kit/packages/replay/viewer/viewer-core.js` `townLedger`**

At the top of `townLedger` (where `beliefs`/`warnings` arrays are declared), add:

```js
  const guild = [];   // governance events: proposals, votes, sanctions (newest last)
```

Inside the `for (const ev of tick.events || [])` loop, after the existing `town.trust` handling, add:

```js
      if (ev.kind === 'town.propose') guild.push({ kind: 'propose', proposer: ev.actor, target: d.target, topic: d.topic, t: tick.t });
      if (ev.kind === 'town.vote') guild.push({ kind: 'vote', voter: ev.actor, choice: d.choice, t: tick.t });
      if (ev.kind === 'town.sanction') guild.push({ kind: 'sanction', target: d.target, passed: d.passed, shareFor: d.shareFor, t: tick.t });
```

Change the return to include it:

```js
  return { npcs: [...npcs.values()], beliefs, warnings, guild };
```

- [ ] **Step 5: Render the Guild section in `kit/packages/replay/viewer/viewer.js`**

In the `'town-ledger'` renderer, after the trust-section loop, add a guild section:

```js
    for (const g of model.guild) {
      const row = document.createElement('div');
      row.className = 'npc';
      let label;
      if (g.kind === 'propose') label = `${esc(g.proposer)} proposes to ban ${esc(g.target)} (${esc(g.topic)})`;
      else if (g.kind === 'vote') label = `${esc(g.voter)} votes ${esc(g.choice)}`;
      else label = `SANCTION ${esc(g.target)} — ${g.passed ? 'PASSED' : 'failed'} (${esc(String(g.shareFor))})`;
      row.innerHTML = `<span class="muted">⚖ ${label}</span>`;
      el.appendChild(row);
    }
```

- [ ] **Step 6: Re-run the replay suite**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: each prints its PASS banner. (`viewer-core.smoke` still passes — `townLedger` now returns an extra `guild` key, which its existing assertions don't forbid.)

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/src/__tests__/town-pack.smoke.ts packages/replay/viewer/viewer-core.js packages/replay/viewer/viewer.js
git commit -m "feat(replay): town@0 gains propose/vote/sanction events (guild governance visible)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 4: Wire governance into 0gtown (enrich the guild + the ban cascade)

**Files (0gtown repo):**
- Modify: `src/server.ts`
- Modify: `src/spike.ts`

First read the server to place edits precisely.

- [ ] **Step 1: Read the server's NPC roster, pitch handler, and the ②a warn/replay sites**

Run: `grep -n "TOWNSFOLK\|new Cognition\|const trust\|const cognition\|norm(claim)\|cognition.recall\|shouldRefuse\|world.pitch\|cognition.learn\|cognition.warn\|town.warn\|town.belief\|guildIds\|sendJson({ type: 'pitched'" src/server.ts`
Expected: the `TOWNSFOLK` array; the `cognition`/`trust` construction; `topic = norm(claim)`; the recall + `shouldRefuse` refuse block; `world.pitch`; `learn`; the hardcoded `warn('npc:0gtown:abao','npc:0gtown:liu', topic)`; the hardcoded `town.warn` emit; the accepted-pitch `sendJson`. These are the anchors for the edits below.

- [ ] **Step 2: Enrich `TOWNSFOLK` to a 5-NPC guild in `src/server.ts`**

Add three entries to the `TOWNSFOLK` array (keep A-Bao and Keeper Liu). Match the existing entry shape `{ id, name, startGcc, background }`:

```ts
  {
    id: 'npc:0gtown:mei', name: 'Fishmonger Mei', startGcc: 10,
    background: 'A sharp-eyed fishmonger at the night market who has seen every trick. Wary of strangers, quick to spread word among the stalls.',
  },
  {
    id: 'npc:0gtown:guo', name: 'Fruit-seller Guo', startGcc: 10,
    background: 'A cheerful fruit-seller who trusts his neighbours and listens to the market guild. Easily alarmed by talk of swindlers.',
  },
  {
    id: 'npc:0gtown:han', name: 'Cloth-merchant Han', startGcc: 10,
    background: 'A measured cloth-merchant, respected in the guild, who weighs a claim before judging but stands with his fellow stallholders.',
  },
```

- [ ] **Step 3: Add the guild id list + a Polity at startup**

Near where `cognition`/`trust` are constructed, add:

```ts
const guildIds = TOWNSFOLK.map((t) => t.id);
const polity = new Polity();
```

And add `Polity, runSanctionVote` to the existing `@onchainpal/cognition` import:

```ts
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse, Polity, runSanctionVote } from '@onchainpal/cognition';
```

- [ ] **Step 4: Sanction-first check in the pitch handler**

In the pitch handler, BEFORE the `const topic = norm(claim)` / `cognition.recall(...)` lines, add a guild-ban short-circuit. Adapt `npc`, `visitorId`, `claim`, `bal`, `receipts`, `rec`, `replayT` to the real identifiers from Step 1:

```ts
const topic = norm(claim);
if (polity.sanctioned(visitorId)) {
  const belief = 'The night-market guild has barred you. No deal.';
  sendJson({ type: 'pitched', npc: npc.name, accepted: false, protected: true, belief, beliefRoot: null, delta0G: 0, balance0G: round0G(bal), receipts });
  try {
    rec.tick(++replayT);
    rec.event('town.refuse', { actor: npc.id, target: visitorId, by: 'npc', data: { protected: true, claim, belief, beliefRoot: null, bannedByGuild: true } });
    rec.metrics({ 'receipts.compute': receipts.compute, 'receipts.storage': receipts.storage });
    rec.flush();
  } catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
  return;
}
```

(If `topic` is already computed just below, remove the now-duplicate `const topic = norm(claim)` from its old spot so it's declared once, here, before the sanctioned check. Keep the subsequent `cognition.recall(...)`/`shouldRefuse` block unchanged.)

- [ ] **Step 5: Generalize the warn step to the whole guild (call + replay emit) in the accepted-pitch branch**

Find the ②a warn block — the hardcoded `if (npc.id === 'npc:0gtown:abao') warned = await cognition.warn('npc:0gtown:abao','npc:0gtown:liu', topic)` AND its hardcoded `town.warn` emit (`from:'npc:0gtown:abao', to:'npc:0gtown:liu'`). Replace BOTH with a guild loop that warns every other guild member and emits one `town.warn` per warned member. Place it after `cognition.learn(...)` (warn requires the learner to already hold the belief):

```ts
// warn the whole guild (best-effort), emitting one town.warn per warned member
const warnedMembers: string[] = [];
for (const g of guildIds) {
  if (g === npc.id) continue;
  let ok = false;
  try { ok = await cognition.warn(npc.id, g, topic); } catch { /* best-effort */ }
  if (ok) warnedMembers.push(g);
}
try {
  for (const g of warnedMembers) {
    rec.event('town.warn', { actor: npc.id, target: g, by: 'npc', data: { from: npc.id, to: g, topic, accepted: true } });
  }
} catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
```

(Delete the old single `warn` call, the `warned` boolean, and the old hardcoded `town.warn` emit. Keep `cognition.learn`, the 0G anchor, `town.belief`/`town.trust` emits.)

- [ ] **Step 6: Run the belief-gated sanction vote + emit governance events**

After the warn loop (still in the accepted-pitch branch, after the existing `town.belief`/`town.trust` emits), add:

> **Note (defect found during implementation):** the preceding accepted-pitch block ends with `rec.flush()`, which closes the current tick (`recorder.ts` `flushTick()` nulls `cur`). So the FIRST governance `rec.event(...)` would throw "event() called before tick()". Fix: open a fresh tick at the start of the `if (round)` branch with `rec.tick(++replayT)` (shown below). If `round` is null, the trailing `rec.flush()` is a harmless no-op.

```ts
// the guild votes whether to ban this visitor (belief-gated, synchronous)
try {
  const round = await runSanctionVote(cognition, polity, npc.id, visitorId, topic, guildIds, { until: Infinity });
  if (round) {
    rec.tick(++replayT);   // the prior block flushed the tick; reopen one for the governance events
    rec.event('town.propose', { actor: npc.id, target: visitorId, by: 'npc', data: { proposer: npc.id, target: visitorId, topic, pid: round.pid } });
    for (const [voter, choice] of Object.entries(round.votes)) {
      if (voter === npc.id) continue;   // proposer's implicit 'for' isn't a cast vote
      rec.event('town.vote', { actor: voter, target: visitorId, by: 'npc', data: { voter, choice, pid: round.pid } });
    }
    rec.event('town.sanction', { actor: npc.id, target: visitorId, by: 'engine', data: { target: visitorId, passed: round.result.passed, shareFor: round.result.shareFor } });
  }
  rec.flush();
} catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Fix any identifier mismatches against the real handler from Step 1.

- [ ] **Step 8: Extend `src/spike.ts` to assert the guild-ban cascade**

> **Note (defect found during implementation):** with governance on, the marquee's first scam (`player:visitor:1`) bans that visitor **guild-wide**, so the later cognition-arc pitch (which expects A-Bao to *accept*) would hit the ban and fail. Fix: run the cognition+governance arc on a **fresh second WS connection** (`ws2`), which the server assigns a distinct visitor id (`player:visitor:${++seq}`), so it isn't pre-banned. The existing cognition-arc assertions still hold on the fresh visitor (its first pitch ACCEPTS; governance then bans it, so the repeat/Liu pitches return `protected:true` via the ban). Parameterize the pitch helper to take a socket (`pitchExpectProtectedOn(sock, npcName, claim, expectProtected)`).

Open `ws2` (mirror how the spike opens its first socket + awaits hello/open), run the cognition-arc assertions on it, then add the guild-ban + replay-event assertions. Close `ws2` before the end so the spike exits 0.

```ts
const ws2 = new WebSocket(`ws://localhost:${PORT}/play`);   // fresh visitor (player:visitor:2)
await new Promise<void>((res) => ws2.on('open', () => res()));
// ... run the cognition-arc assertions on ws2 via pitchExpectProtectedOn(ws2, ...) ...
assert.ok(await pitchExpectProtectedOn(ws2, 'Fishmonger Mei', claim, true), 'a guild NPC refuses the banned visitor (guild sanction)');
console.log('✓ governance arc: scam → guild warned → vote → visitor banned guild-wide');
ws2.close();
```

Then extend the existing replay event-kind assertion block to also require the governance kinds. Find where the spike checks `kinds.has('town.belief')` etc. and add:

```ts
for (const k of ['town.propose', 'town.vote', 'town.sanction']) {
  if (!kinds.has(k)) { console.error(`expected a ${k} event in the replay stream`); process.exit(1); }
}
```

- [ ] **Step 9: Run the spike (FakeKernel — no sidecar)**

Run: `pnpm spike`
Expected: the existing marquee + cognition-arc lines, then `✓ governance arc: scam → guild warned → vote → visitor banned guild-wide`, the replay-validation line now listing `town.propose, town.vote, town.sanction` among the events, exit 0.

- [ ] **Step 10: Commit (in the 0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/server.ts src/spike.ts
git commit -m "feat: 0gtown night-market guild — collective belief-gated ban of a scammer visitor"
```

---

### Task 5: Frontend N-NPC check + finalize

**Files:**
- Modify (if needed): `public/index.html`
- 0gtown: submodule pointer bump

- [ ] **Step 1: Verify the browser client renders all guild NPCs**

Run: `grep -n "npcs\|abao\|liu\|roomSnapshot\|room.npcs\|forEach\|map(" public/index.html | head -40`
Read how the client renders NPC cards. The server's `room` snapshot already sends `npcs: [...]` for all NPCs in the room. If the client iterates that array dynamically (e.g. `room.npcs.forEach(...)`), it already renders all 5 — no change needed; note that and proceed. If it hardcodes two NPC cards (A-Bao / Keeper Liu) in static HTML or references their ids literally, generalize it to render one card per `room.npcs` entry.

- [ ] **Step 2: (Only if Step 1 found a hardcode) generalize the NPC rendering**

Apply the minimal change so the client renders one card per `npcs[]` entry from the room snapshot (no literal NPC ids). Re-load the page mentally against a 5-NPC snapshot to confirm. (If Step 1 showed it's already dynamic, skip this step and say so.)

- [ ] **Step 3: Commit any frontend change (0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add public/index.html 2>/dev/null && git commit -m "fix(ui): render all guild NPCs from the room snapshot" || echo "no frontend change needed"
```

- [ ] **Step 4: Run the full kit suites (cognition + replay)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance; do pnpm --filter @onchainpal/cognition run test:$s || break; done && for s in town validate recorder fixture viewer; do pnpm --filter @onchainpal/replay run test:$s || break; done`
Expected: all PASS banners, no break.

- [ ] **Step 5: Bump the kit submodule pointer (0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git log --oneline -1   # note the governance HEAD
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @onchainpal/cognition ②b governance + replay guild events"
```

- [ ] **Step 6: Final end-to-end**

Run: `pnpm typecheck && pnpm spike`
Expected: typecheck clean; spike prints the cognition arc, the governance arc, the replay-validation line (with propose/vote/sanction), exit 0. Confirm the submodule pointer matches: `git ls-tree HEAD kit | awk '{print $3}'` equals `git -C kit rev-parse HEAD`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 layout (governance/polity.ts, voting.ts, tests) → Tasks 1–2.
- §4 Polity (submit/cast/tally/sanctioned, built-in sanction with `Math.max`, pluggable enactors, no internal prune) → Task 1; the `Math.max` invariant is explicitly asserted in the polity smoke.
- §5 belief-gating bridge (topic-scoped, fails-closed) → Task 2; the governance smoke asserts warned→'for', outsider→'against', pass/fail/null, and kernel-down→'against'.
- §6 0gtown integration (enrich to 5 NPCs, sanction-first keeping `protected:true`+`claim`+`bannedByGuild`, generalize the warn call AND the hardcoded `town.warn` emit, runSanctionVote, emit propose/vote/sanction) → Task 4. Frontend N-NPC check → Task 5.
- §6 replay extension (4 sites: eventKinds + deepEqual + townLedger + viewer) → Task 3, with light `town.vote`/`town.sanction` invariants.
- §7 error handling (Polity pure; bridge best-effort via recall; 0gtown blocks wrapped) → Tasks 1/2/4.
- §8 testing (polity, governance, spike cascade) → Tasks 1/2/4.

**Placeholder scan:** no TBD/TODO; every code step is complete. The "adapt identifiers from Step 1" notes in Task 4 are inherent to editing an existing handler; the grep surfaces them. Task 5 Step 2 is conditional on Step 1's finding (read-then-decide), with both branches specified.

**Type consistency:** `Polity` (`submit`/`cast`/`tally`/`get`/`sanctioned`), `Choice`/`TallyResult`/`Proposal`/`Enactor`/`PolityOpts`, `voteBeliefGated`/`runSanctionVote` (returning `{pid,result,votes}|null`), and `Cognition.recall(...).discernment.q`/`.trust` are used consistently across tasks and match the spec. Replay event kinds `town.propose`/`town.vote`/`town.sanction` and their `data` shapes are consistent between Task 3 (pack + viewer) and Task 4 (server emits).

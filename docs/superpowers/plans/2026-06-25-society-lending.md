# @aigg/cognition ②c-1 — misconduct layer (rap sheet + lending) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a misconduct layer to `@aigg/cognition` — a pure `RapSheet` + `LoanBook` and a `misconduct.ts` bridge composing the shipped ②a `Cognition` and ②b `Polity` — wired into 0gtown so a deadbeat visitor who borrows and never repays earns a rap sheet and is collectively banned by the guild.

**Architecture:** A new pure `society/` module (RapSheet, LoanBook records+settlement; the host owns balances and triggers maturity — clock-agnostic, like ②b). `misconduct.ts` is the only ②a/②b-aware code: `recordMisconduct` writes the ②a signal + a rap entry; `runRapSanction` runs the ②b collective ban on the **public** rap sheet. Full design: [docs/superpowers/specs/2026-06-25-society-lending-design.md](2026-06-25-society-lending-design.md).

**Tech Stack:** TypeScript (ESM, Node ≥20), pnpm workspace, `tsx` smoke tests with `node:assert/strict`. Unit-tested with the ②a `FakeKernel` + a synthetic guild — no service, no clock.

---

## ⚠️ Two-repo commit discipline + branch context (read first)

- Branch is **`society`**, stacking on `governance` → `cognition-social` → `replay-library`. The cognition package (②a+②b) and the extended replay `town@0` pack are present.
- `kit/` is a **git submodule**. Files under `kit/packages/cognition/` and `kit/packages/replay/` are committed **inside the submodule** (`cd /Volumes/T7-Data/aigg-0gtown/kit && git ...`). The kit submodule is on `governance` and Task 1 puts it on a `society` branch.
- 0gtown-repo files (`src/server.ts`, `src/spike.ts`) are committed at the repo root.
- All `pnpm` commands run from `/Volumes/T7-Data/aigg-0gtown`.

### Load-bearing facts from the design audit (do not deviate)

1. **The world has NO NPC→arbitrary-id $0G transfer** (`gccKey` is NPC-only; `pitch` *destroys* money; `donate`/`fund` only top up). Lending is **server-side bookkeeping only** — the lender NPC's world balance is NOT debited. The deadbeat's `balanceOf` returns **0** (no `repay` command in ②c-1).
2. **The rap-gated ban reads ONLY `rapSheet.has(offender)`** — do NOT wire a belief-read into the ban path. `recordMisconduct`'s `learn` writes the belief/trust for symmetry + the victim's own memory + the test; the ban doesn't consume them.
3. **`recordMisconduct` takes NO `TrustLedger`** — `cognition.learn` already drops victim→offender trust once.
4. **Settlement**: the server has **no `ws.on('close')` handler today** — add one (fully try/caught). A global `now` counter (incremented per message) + `term=1` makes a loan mature on the visitor's next interaction.

---

## File Structure

**Kit submodule (cognition package):**
- `kit/packages/cognition/src/society/rapsheet.ts` — `RapSheet`, `RapEntry`
- `kit/packages/cognition/src/society/lending.ts` — `LoanBook`, `Loan`, `Settlement`, `LOAN_RATE`, `LOAN_TERM`
- `kit/packages/cognition/src/society/misconduct.ts` — `misconductTopic`, `recordMisconduct`, `runRapSanction`
- `kit/packages/cognition/src/__tests__/{rapsheet,lending,society}.smoke.ts`
- `kit/packages/cognition/package.json` — add `test:rapsheet`, `test:lending`, `test:society`
- `kit/packages/cognition/src/index.ts` — re-export the new symbols

**Kit submodule (replay package):**
- `kit/packages/replay/src/packs/town.ts` — add `town.lend`/`town.default`/`town.rap` (+ light invariants)
- `kit/packages/replay/src/__tests__/town-pack.smoke.ts` — update the exact `deepEqual` + add asserts
- `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js` — render the new events

**0gtown repo:**
- `src/server.ts` — `RapSheet`/`LoanBook` at startup; a global `now`; `borrow` command; `settleDue` (settle-on-next-action + a new `ws.on('close')`); sanction-first on `borrow`; emit the new events
- `src/spike.ts` — assert the deadbeat cascade

---

### Task 1: RapSheet (the misconduct ledger)

**Files:**
- Modify: `kit/packages/cognition/package.json` (add three test scripts)
- Create: `kit/packages/cognition/src/society/rapsheet.ts`
- Test: `kit/packages/cognition/src/__tests__/rapsheet.smoke.ts`

- [ ] **Step 1: Branch the kit submodule**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git checkout -b society
git log --oneline -1   # expect the governance HEAD (3791dbd town propose/vote/sanction)
cd /Volumes/T7-Data/aigg-0gtown
```

- [ ] **Step 2: Add the three test scripts to `kit/packages/cognition/package.json`**

In `"scripts"`, after `"test:governance"`, add:

```json
    "test:rapsheet": "tsx src/__tests__/rapsheet.smoke.ts",
    "test:lending": "tsx src/__tests__/lending.smoke.ts",
    "test:society": "tsx src/__tests__/society.smoke.ts"
```

(Add a trailing comma on the previous entry so the JSON stays valid.)

- [ ] **Step 3: Write the failing test `kit/packages/cognition/src/__tests__/rapsheet.smoke.ts`**

```ts
/** Smoke for RapSheet. Run: pnpm --filter @aigg/cognition test:rapsheet */
import assert from 'node:assert/strict';
import { RapSheet } from '../society/rapsheet';

const r = new RapSheet();
assert.equal(r.has('v'), false, 'clean offender → has false');
assert.equal(r.count('v'), 0, 'clean offender → count 0');
assert.deepEqual(r.entries('v'), [], 'clean offender → no entries');

r.record('v', { kind: 'default', victim: 'npc:han', t: 1 });
assert.equal(r.has('v'), true, 'one record → has true');
assert.equal(r.count('v'), 1);

r.record('v', { kind: 'default', victim: 'npc:liu', t: 2 });
assert.equal(r.count('v'), 2, 'second record appends');
assert.equal(r.entries('v')[1].victim, 'npc:liu', 'entries ordered');

assert.equal(r.has('other'), false, 'per-offender isolation');
console.log('ALL RAPSHEET SMOKE TESTS PASSED ✅');
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @aigg/cognition test:rapsheet`
Expected: FAIL — `Cannot find module '../society/rapsheet'`.

- [ ] **Step 5: Write `kit/packages/cognition/src/society/rapsheet.ts`**

```ts
export interface RapEntry { kind: string; victim: string; t: number }   // kind: 'default' (②c-1); 'extort'/'sabotage' in ②c-2

/** A public misconduct ledger — the grounds a guild reads when sanctioning. Pure, in-memory. */
export class RapSheet {
  private sheet = new Map<string, RapEntry[]>();

  record(offender: string, entry: RapEntry): void {
    const list = this.sheet.get(offender);
    if (list) list.push(entry);
    else this.sheet.set(offender, [entry]);
  }

  entries(offender: string): RapEntry[] { return this.sheet.get(offender) ?? []; }
  has(offender: string): boolean { return (this.sheet.get(offender)?.length ?? 0) > 0; }
  count(offender: string): number { return this.sheet.get(offender)?.length ?? 0; }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @aigg/cognition test:rapsheet`
Expected: `ALL RAPSHEET SMOKE TESTS PASSED ✅`

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/package.json packages/cognition/src/society/rapsheet.ts packages/cognition/src/__tests__/rapsheet.smoke.ts
git commit -m "feat(cognition): RapSheet — public misconduct ledger"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 2: LoanBook (loan records + clock-agnostic settlement)

**Files:**
- Create: `kit/packages/cognition/src/society/lending.ts`
- Test: `kit/packages/cognition/src/__tests__/lending.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/lending.smoke.ts`**

```ts
/** Smoke for LoanBook. Run: pnpm --filter @aigg/cognition test:lending */
import assert from 'node:assert/strict';
import { LoanBook } from '../society/lending';

// lend records a loan due at now+term (default term 1, rate 0.1)
const lb = new LoanBook();
const loan = lb.lend('npc:han', 'v', { principal: 10 }, 0);
assert.equal(loan.due, 1, 'due = now + term(1)');
assert.equal(loan.principal, 10);
assert.deepEqual(lb.due(0), [], 'not matured before due');
assert.equal(lb.due(1).length, 1, 'matured at due');
assert.deepEqual(lb.settle(0, () => 100), [], 'no settlement before due');

// funded borrower repays in full: owed = 10 * 1.1 = 11
const lb2 = new LoanBook();
lb2.lend('npc:han', 'v', { principal: 10 }, 0);
const s = lb2.settle(1, () => 100);
assert.equal(s.length, 1);
assert.ok(Math.abs(s[0].owed - 11) < 1e-9, 'owed = principal*(1+rate)');
assert.ok(Math.abs(s[0].paid - 11) < 1e-9, 'paid in full');
assert.equal(s[0].defaulted, false, 'funded → repaid');
assert.deepEqual(lb2.settle(2, () => 100), [], 'no double-settle (loan removed)');

// deadbeat (balance 0) → full default, paid clamped to 0
const lb3 = new LoanBook();
lb3.lend('npc:han', 'v', { principal: 10 }, 0);
const d = lb3.settle(1, () => 0);
assert.equal(d[0].defaulted, true, 'balance 0 → default');
assert.equal(d[0].paid, 0, 'paid clamped to 0');

// partial pay → still default, paid = balance
const lb4 = new LoanBook();
lb4.lend('npc:han', 'v', { principal: 10 }, 0);
const p = lb4.settle(1, () => 5);
assert.equal(p[0].defaulted, true, 'short → default');
assert.equal(p[0].paid, 5, 'partial paid = balance');

console.log('ALL LENDING SMOKE TESTS PASSED ✅');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aigg/cognition test:lending`
Expected: FAIL — `Cannot find module '../society/lending'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/society/lending.ts`**

```ts
export interface Loan { id: string; lender: string; borrower: string; principal: number; rate: number; due: number }
export interface Settlement { loanId: string; lender: string; borrower: string; owed: number; paid: number; defaulted: boolean }

export const LOAN_RATE = 0.1;
export const LOAN_TERM = 1;   // due on the borrower's next interaction (clock-agnostic — host supplies `now`)

/** Loan records + settlement. Pure: holds records only; the HOST owns balances and applies the transfers
 *  from the returned settlements. Clock-agnostic — `now`/`due` are opaque numbers the host interprets. */
export class LoanBook {
  private loans: Loan[] = [];
  private seq = 0;

  lend(lender: string, borrower: string, opts: { principal: number; rate?: number; term?: number }, now: number): Loan {
    const loan: Loan = {
      id: `loan${this.seq++}`, lender, borrower,
      principal: opts.principal, rate: opts.rate ?? LOAN_RATE, due: now + (opts.term ?? LOAN_TERM),
    };
    this.loans.push(loan);
    return loan;
  }

  /** Matured-but-unsettled loans (for the host to know there's work). */
  due(now: number): Loan[] { return this.loans.filter((l) => l.due <= now); }

  /** Settle every matured loan: owed = principal*(1+rate); paid = clamp(min(owed, balanceOf(borrower)));
   *  defaulted = paid < owed. REMOVES settled loans (no double-default). */
  settle(now: number, balanceOf: (id: string) => number): Settlement[] {
    const matured = this.loans.filter((l) => l.due <= now);
    this.loans = this.loans.filter((l) => l.due > now);
    return matured.map((l) => {
      const owed = l.principal * (1 + l.rate);
      const paid = Math.max(0, Math.min(owed, balanceOf(l.borrower)));
      return { loanId: l.id, lender: l.lender, borrower: l.borrower, owed, paid, defaulted: paid < owed };
    });
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @aigg/cognition test:lending`
Expected: `ALL LENDING SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/society/lending.ts packages/cognition/src/__tests__/lending.smoke.ts
git commit -m "feat(cognition): LoanBook — loan records + clock-agnostic settlement (repaid|defaulted)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 3: misconduct.ts bridge + barrel

**Files:**
- Create: `kit/packages/cognition/src/society/misconduct.ts`
- Modify: `kit/packages/cognition/src/index.ts`
- Test: `kit/packages/cognition/src/__tests__/society.smoke.ts`

- [ ] **Step 1: Write the failing test `kit/packages/cognition/src/__tests__/society.smoke.ts`**

```ts
/** Smoke for the misconduct bridge (composes ②a Cognition + ②b Polity).
 *  Run: pnpm --filter @aigg/cognition test:society */
import assert from 'node:assert/strict';
import { FakeKernel } from '../kernel/fake';
import { TrustLedger, TRUST_DELTAS } from '../social/trust';
import { Cognition } from '../cognition';
import { Polity } from '../governance/polity';
import { RapSheet } from '../society/rapsheet';
import { recordMisconduct, runRapSanction, misconductTopic } from '../society/misconduct';

async function main() {
  const victim = 'npc:han', offender = 'visitor:1';
  const guild = ['npc:han', 'npc:liu', 'npc:mei', 'npc:guo', 'npc:abao'];

  // misconductTopic is stable + offender-scoped
  assert.equal(misconductTopic(offender), misconductTopic(offender), 'stable');
  assert.notEqual(misconductTopic(offender), misconductTopic('visitor:2'), 'offender-scoped');

  const cog = new Cognition(new FakeKernel(), new TrustLedger());
  const rap = new RapSheet();
  const polity = new Polity();

  // a clean offender → no proposal
  assert.equal(await runRapSanction(rap, polity, victim, offender, guild), null, 'clean offender → null');

  // record a default → rap entry + victim distrusts offender + victim recalls an offender-scoped belief
  const topic = await recordMisconduct(cog, rap, victim, offender, 'default', 1, 'stiffed a 10 $0G loan');
  assert.equal(topic, misconductTopic(offender), 'returns the topic');
  assert.equal(rap.has(offender), true, 'rap entry written');
  assert.equal(rap.entries(offender)[0].kind, 'default');
  const sig = await cog.recall(victim, offender, topic);
  assert.equal(sig.discernment.q, 1, 'victim recalls the misconduct belief');
  assert.ok(Math.abs(sig.trust - TRUST_DELTAS.scammed) < 1e-9, 'victim→offender trust dropped exactly once');

  // now the public rap drives a passing collective ban
  const round = await runRapSanction(rap, polity, victim, offender, guild, { until: Infinity });
  assert.ok(round, 'rap present → a round runs');
  assert.equal(round!.result.passed, true, 'guild bans on the public rap (all for)');
  assert.equal(polity.sanctioned(offender), true, 'offender blacklisted');

  console.log('ALL SOCIETY SMOKE TESTS PASSED ✅');
}
main().catch((e) => { console.error('SOCIETY SMOKE FAILED ❌', e); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @aigg/cognition test:society`
Expected: FAIL — `Cannot find module '../society/misconduct'`.

- [ ] **Step 3: Write `kit/packages/cognition/src/society/misconduct.ts`**

```ts
import type { Cognition } from '../cognition';
import type { Polity, TallyResult, Choice } from '../governance/polity';
import { corpusId } from '../id';
import type { RapSheet } from './rapsheet';

/** A stable, offender-scoped topic. The belief/sanction is keyed to the offender (not a claim),
 *  which sidesteps ②b's claim-scoped false-positive. */
export function misconductTopic(offender: string): string { return `misconduct-${corpusId(offender)}`; }

/** ②a bridge: on a confirmed misconduct, write the SAME signal a scam does — a rap entry, plus (via learn)
 *  the victim's offender-scoped belief and a victim→offender trust drop. Best-effort (learn is non-throwing).
 *  Takes NO TrustLedger — `cognition.learn` already owns/moves the one shared ledger (no double-apply). */
export async function recordMisconduct(
  cognition: Cognition, rapSheet: RapSheet,
  victim: string, offender: string, kind: string, now: number, detail?: string,
): Promise<string> {
  const topic = misconductTopic(offender);
  rapSheet.record(offender, { kind, victim, t: now });
  await cognition.learn(victim, offender, { topic, description: detail ?? `${offender} committed ${kind}`, outcome: 'loss' });
  return topic;
}

/** ②b bridge: the guild bans on PUBLIC evidence. If the offender has a rap sheet, the proposer opens a
 *  sanction and every guild member votes 'for' (the rap is public); tally. Returns null if the rap is clean.
 *  Reads ONLY rapSheet.has — does not consult per-voter beliefs. */
export async function runRapSanction(
  rapSheet: RapSheet, polity: Polity,
  proposer: string, offender: string, guild: string[],
  opts: { until?: number } = {},
): Promise<{ pid: string; result: TallyResult; votes: Record<string, Choice> } | null> {
  if (!rapSheet.has(offender)) return null;
  // topic carried for replay/viewer parity with ②b's runSanctionVote (viewer reads d.topic on town.propose)
  const pid = polity.submit(proposer, 'sanction', { target: offender, until: opts.until ?? Infinity, topic: misconductTopic(offender) });
  const votes: Record<string, Choice> = { [proposer]: 'for' };
  for (const m of guild) {
    if (m === proposer) continue;
    polity.cast(pid, m, 'for');
    votes[m] = 'for';
  }
  return { pid, result: polity.tally(pid, guild), votes };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @aigg/cognition test:society`
Expected: `ALL SOCIETY SMOKE TESTS PASSED ✅`

- [ ] **Step 5: Re-export from the barrel `kit/packages/cognition/src/index.ts`**

Append before the end of the file:

```ts
export { RapSheet } from './society/rapsheet';
export type { RapEntry } from './society/rapsheet';
export { LoanBook, LOAN_RATE, LOAN_TERM } from './society/lending';
export type { Loan, Settlement } from './society/lending';
export { misconductTopic, recordMisconduct, runRapSanction } from './society/misconduct';
```

- [ ] **Step 6: Full cognition suite + typecheck**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance rapsheet lending society; do pnpm --filter @aigg/cognition run test:$s || break; done && pnpm --filter @aigg/cognition exec tsc --noEmit`
Expected: 13 PASS banners; tsc clean.

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/cognition/src/society/misconduct.ts packages/cognition/src/index.ts packages/cognition/src/__tests__/society.smoke.ts
git commit -m "feat(cognition): misconduct bridge — recordMisconduct + rap-gated runRapSanction + barrel"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 4: Extend the replay `town@0` pack with lend/default/rap

**Files (kit submodule, replay package):**
- Modify: `kit/packages/replay/src/packs/town.ts`
- Modify: `kit/packages/replay/src/__tests__/town-pack.smoke.ts`
- Modify: `kit/packages/replay/viewer/viewer-core.js`, `viewer/viewer.js`

- [ ] **Step 1: Add the three kinds + light invariants in `kit/packages/replay/src/packs/town.ts`**

Extend `eventKinds` to (append the three new kinds after `'town.sanction'`):

```ts
  eventKinds: ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction', 'town.lend', 'town.default', 'town.rap'],
```

In `validateEvent`, after the existing `town.sanction` check and before `return errs;`, add:

```ts
    if (ev.kind === 'town.default' && (typeof d.owed !== 'number' || typeof d.recovered !== 'number')) {
      errs.push('town.default requires numeric data.owed and data.recovered');
    }
    if (ev.kind === 'town.rap' && (!d.offender || !d.kind)) {
      errs.push('town.rap requires data.offender and data.kind');
    }
```

- [ ] **Step 2: Update the shipped `deepEqual` + add invariant asserts in `kit/packages/replay/src/__tests__/town-pack.smoke.ts`**

Replace the `deepEqual(townPack.eventKinds, [...])` with the 13-element array:

```ts
assert.deepEqual(townPack.eventKinds, ['town.talk', 'town.pitch', 'town.refuse', 'town.anchor', 'town.belief', 'town.warn', 'town.trust', 'town.propose', 'town.vote', 'town.sanction', 'town.lend', 'town.default', 'town.rap']);
```

Add near the other `errs(...)` checks:

```ts
assert.equal(errs({ kind: 'town.default', data: { owed: 11, recovered: 0 } }).length, 0, 'valid default ok');
assert.ok(errs({ kind: 'town.default', data: { owed: 11 } }).length > 0, 'default missing recovered fails');
assert.equal(errs({ kind: 'town.rap', data: { offender: 'visitor:1', kind: 'default' } }).length, 0, 'valid rap ok');
assert.ok(errs({ kind: 'town.rap', data: { offender: 'visitor:1' } }).length > 0, 'rap missing kind fails');
```

- [ ] **Step 3: Run the town-pack smoke**

Run: `pnpm --filter @aigg/replay test:town`
Expected: `ALL TOWN-PACK SMOKE TESTS PASSED ✅`

- [ ] **Step 4: Surface the events in `kit/packages/replay/viewer/viewer-core.js` `townLedger`**

At the top of `townLedger` (where `beliefs`/`warnings`/`guild` arrays are declared), add:

```js
  const credit = [];   // lend/default/rap events (newest last)
```

Inside the `for (const ev of tick.events || [])` loop, after the existing `town.sanction` handling, add:

```js
      if (ev.kind === 'town.lend') credit.push({ kind: 'lend', lender: ev.actor, borrower: d.borrower, amount: d.amount, t: tick.t });
      if (ev.kind === 'town.default') credit.push({ kind: 'default', lender: d.lender, borrower: d.borrower, owed: d.owed, recovered: d.recovered, t: tick.t });
      if (ev.kind === 'town.rap') credit.push({ kind: 'rap', offender: d.offender, rapKind: d.kind, victim: d.victim, t: tick.t });
```

Change the return to include it:

```js
  return { npcs: [...npcs.values()], beliefs, warnings, guild, credit };
```

- [ ] **Step 5: Render the credit/misconduct section in `kit/packages/replay/viewer/viewer.js`**

In the `'town-ledger'` renderer, after the guild section loop, add:

```js
    for (const c of model.credit) {
      const row = document.createElement('div');
      row.className = 'npc';
      let label;
      if (c.kind === 'lend') label = `${esc(c.lender)} lent ${esc(String(c.amount))} $0G to ${esc(c.borrower)}`;
      else if (c.kind === 'default') label = `${esc(c.borrower)} DEFAULTED on ${esc(c.lender)} (owed ${esc(String(c.owed))}, paid ${esc(String(c.recovered))})`;
      else label = `RAP ${esc(c.offender)} — ${esc(c.rapKind)} (vs ${esc(c.victim)})`;
      row.innerHTML = `<span class="muted">💱 ${label}</span>`;
      el.appendChild(row);
    }
```

- [ ] **Step 6: Re-run the replay suite**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in town validate recorder fixture viewer; do pnpm --filter @aigg/replay run test:$s || break; done`
Expected: each prints its PASS banner. (`viewer-core.smoke` still passes — `townLedger` returns an extra `credit` key, which its existing assertions don't forbid.)

- [ ] **Step 7: Commit (in the kit submodule)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit
git add packages/replay/src/packs/town.ts packages/replay/src/__tests__/town-pack.smoke.ts packages/replay/viewer/viewer-core.js packages/replay/viewer/viewer.js
git commit -m "feat(replay): town@0 gains lend/default/rap events (misconduct visible)"
cd /Volumes/T7-Data/aigg-0gtown
```

---

### Task 5: Wire the deadbeat cascade into 0gtown

**Files (0gtown repo):**
- Modify: `src/server.ts`
- Modify: `src/spike.ts`

First read the server to place edits precisely.

- [ ] **Step 1: Read the server's startup state, message handler, and connection setup**

Run: `grep -n "new Cognition\|const polity\|guildIds\|new TrustLedger\|visitorId\|wss.on('connection'\|ws.on('message'\|ws.on('close'\|msg.cmd === 'pitch'\|polity.sanctioned\|unknown command\|rec.tick(++replayT" src/server.ts`
Expected: where `cognition`/`trust`/`polity`/`guildIds` are constructed; the `wss.on('connection')` → `ws.on('message')` handler; the per-connection `visitorId`; the `pitch` sanction-first block; the absence of `ws.on('close')`. These anchor the edits.

- [ ] **Step 2: Construct `RapSheet`/`LoanBook` + a global `now`, and import them**

Add `RapSheet, LoanBook, recordMisconduct, runRapSanction` to the existing `@aigg/cognition` import:

```ts
import { Cognition, TrustLedger, AiggMemoryKernel, FakeKernel, shouldRefuse, Polity, runSanctionVote, RapSheet, LoanBook, recordMisconduct, runRapSanction } from '@aigg/cognition';
```

Where `polity`/`guildIds` are constructed, add:

```ts
const rapSheet = new RapSheet();
const loanBook = new LoanBook();
let nowSeq = 0;                      // global interaction clock (drives loan maturity)
const lendBalanceOf = (_id: string) => 0;   // ②c-1 has no `repay` — a deadbeat's repayment escrow is 0
```

- [ ] **Step 3: Add a `settleDue` helper (settle matured loans → default → rap → guild ban)**

Near the other helpers (after `cognition`/`polity` exist), add a function that settles all matured loans and, for each default, records misconduct + emits the replay events + runs the rap-gated ban. It takes the `rec`/`replayT` recorder context — define it where `rec`/`replayT` are in scope (they are per-connection in the message handler in ②a/②b; if `rec`/`replayT` are connection-scoped, define `settleDue` as a closure inside the connection handler). Use:

```ts
async function settleDue(rec: any, bumpTick: () => void): Promise<void> {
  const settlements = loanBook.settle(nowSeq, lendBalanceOf);
  for (const s of settlements) {
    if (!s.defaulted) continue;
    try {
      await recordMisconduct(cognition, rapSheet, s.lender, s.borrower, 'default', nowSeq, `defaulted on a ${round0G(s.owed)} $0G loan from ${s.lender}`);
      bumpTick();
      rec.event('town.default', { actor: s.lender, target: s.borrower, by: 'engine', data: { lender: s.lender, borrower: s.borrower, owed: round0G(s.owed), recovered: round0G(s.paid) } });
      rec.event('town.rap', { actor: s.borrower, by: 'engine', data: { offender: s.borrower, kind: 'default', victim: s.lender } });
      const round = await runRapSanction(rapSheet, polity, s.lender, s.borrower, guildIds, { until: Infinity });
      if (round) {
        rec.event('town.propose', { actor: s.lender, target: s.borrower, by: 'npc', data: { proposer: s.lender, target: s.borrower, topic: `misconduct-${s.borrower}`, pid: round.pid } });
        for (const [voter, choice] of Object.entries(round.votes)) {
          if (voter === s.lender) continue;
          rec.event('town.vote', { actor: voter, target: s.borrower, by: 'npc', data: { voter, choice, pid: round.pid } });
        }
        rec.event('town.sanction', { actor: s.lender, target: s.borrower, by: 'engine', data: { target: s.borrower, passed: round.result.passed, shareFor: round.result.shareFor } });
      }
      rec.flush();
    } catch (e) { console.warn('[0gtown] settlement/replay skipped:', (e as any)?.message); }
  }
}
```

(`round0G` is the existing $0G rounding helper in server.ts. `bumpTick` is `() => rec.tick(++replayT)` supplied by the caller — see Steps 4/6.)

- [ ] **Step 4: At the top of the message handler, advance the clock + settle matured loans**

In the `ws.on('message')` handler, after parsing `msg`, BEFORE dispatching `look`/`talk`/`pitch`/`borrow`, add:

```ts
nowSeq++;
await settleDue(rec, () => rec.tick(++replayT));   // settle-on-next-action: a due loan defaults before this command runs
```

(So a loan opened on interaction N matures on interaction N+1 — the visitor's next action — and the ban lands before that action is processed, which the sanction-first checks then refuse.)

- [ ] **Step 5: Add the `borrow` command (with the sanction-first check)**

Add a new branch alongside `pitch`, adapting `npc`/`visitorId`/`bal`/`receipts`/`rec`/`replayT` to the real identifiers. `findNpc` resolves the lender by name/id (Cloth-merchant Han is the demo lender):

```ts
if (msg.cmd === 'borrow') {
  const npc = findNpc(String(msg.npc ?? ''));
  const amount = Number(msg.amount ?? 0);
  if (!npc) { sendJson({ type: 'error', text: 'no such stall' }); return; }
  if (polity.sanctioned(visitorId)) {                 // sanction-first: a banned deadbeat can't borrow either
    sendJson({ type: 'lent', npc: npc.name, accepted: false, protected: true, reason: 'The night-market guild has barred you. No credit.' });
    return;
  }
  const loan = loanBook.lend(npc.id, visitorId, { principal: amount }, nowSeq);
  sendJson({ type: 'lent', npc: npc.name, accepted: true, amount: round0G(amount), due: loan.due });
  try { rec.tick(++replayT); rec.event('town.lend', { actor: npc.id, target: visitorId, by: 'npc', data: { lender: npc.id, borrower: visitorId, amount: round0G(amount), due: loan.due } }); rec.flush(); } catch (e) { console.warn('[0gtown] replay write skipped:', (e as any)?.message); }
  return;
}
```

- [ ] **Step 6: Add a `ws.on('close')` handler that settles (the server has none today)**

In the `wss.on('connection', (ws) => { ... })` callback, alongside `ws.on('message', ...)`, add a close handler that settles the disconnecting deadbeat's loans (fully try/caught — the socket is gone, so `rec.event`/`rec.flush` are fine but no `ws.send`):

```ts
ws.on('close', () => {
  nowSeq++;
  void settleDue(rec, () => rec.tick(++replayT)).catch((e) => console.warn('[0gtown] close settle skipped:', (e as any)?.message));
});
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Fix any identifier mismatches against the real handler from Step 1 (especially whether `rec`/`replayT`/`visitorId` are per-connection — if so, keep `settleDue` defined where they're in scope, or pass them in as this plan does).

- [ ] **Step 8: Extend `src/spike.ts` to assert the deadbeat cascade**

Add a fresh-WS-connection arc (per the ②b lesson — a defaulting visitor gets banned, so use a clean visitor). Borrow from Cloth-merchant Han, then take a second action that triggers settlement and gets refused. Add a `borrowOn`/`pitchExpectProtectedOn` pattern using the spike's socket helper. After the existing arcs, before the final replay-validation block:

```ts
const ws3 = new WebSocket(`ws://localhost:${PORT}/play`);
await new Promise<void>((res) => ws3.on('open', () => res()));
// borrow from Han (accepted)
const lent = await new Promise<any>((res) => {
  const onMsg = (raw: any) => { const m = JSON.parse(raw.toString()); if (m.type === 'lent') { ws3.off('message', onMsg); res(m); } };
  ws3.on('message', onMsg);
  ws3.send(JSON.stringify({ cmd: 'borrow', npc: 'Cloth-merchant Han', amount: 10 }));
});
assert.equal(lent.accepted, true, 'Han lends to the visitor');
// the visitor's NEXT action triggers settlement → default → guild ban → this action is refused
assert.ok(await pitchExpectProtectedOn(ws3, 'A-Bao', claim, true), 'deadbeat is banned guild-wide after defaulting');
console.log('✓ society arc: borrow → default → rap → guild ban → refused');
ws3.close();
```

Then extend the spike's replay event-kind assertion to also require the misconduct kinds:

```ts
for (const k of ['town.lend', 'town.default', 'town.rap']) {
  if (!kinds.has(k)) { console.error(`expected a ${k} event in the replay stream`); process.exit(1); }
}
```

- [ ] **Step 9: Run the spike (FakeKernel — no sidecar)**

Run: `pnpm spike`
Expected: the prior marquee/cognition/governance arcs, then `✓ society arc: borrow → default → rap → guild ban → refused`, the replay-validation line now listing `town.lend, town.default, town.rap` (+ propose/vote/sanction), exit 0.

- [ ] **Step 10: Commit (in the 0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown
git add src/server.ts src/spike.ts
git commit -m "feat: 0gtown deadbeat cascade — borrow, default, rap sheet, guild ban"
```

---

### Task 6: Finalize — submodule bump + end-to-end

- [ ] **Step 1: Run the full kit suites (cognition + replay)**

Run: `cd /Volumes/T7-Data/aigg-0gtown && for s in scaffold id fake trust warn gate cognition aigg polity governance rapsheet lending society; do pnpm --filter @aigg/cognition run test:$s || break; done && for s in town validate recorder fixture viewer; do pnpm --filter @aigg/replay run test:$s || break; done`
Expected: all PASS banners, no break.

- [ ] **Step 2: Bump the kit submodule pointer (0gtown repo)**

```bash
cd /Volumes/T7-Data/aigg-0gtown/kit && git log --oneline -1   # note the society HEAD
cd /Volumes/T7-Data/aigg-0gtown
git add kit
git commit -m "chore: bump kit submodule — @aigg/cognition ②c-1 misconduct + replay lend/default/rap"
```

- [ ] **Step 3: Final end-to-end**

Run: `pnpm typecheck && pnpm spike`
Expected: typecheck clean; spike prints all arcs (cognition, governance, society) and the replay-validation line with `town.lend`/`town.default`/`town.rap`, exit 0. Confirm `git ls-tree HEAD kit | awk '{print $3}'` equals `git -C kit rev-parse HEAD`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §3 layout (rapsheet/lending/misconduct) → Tasks 1–3.
- §4 RapSheet → Task 1. §5 LoanBook (settle clamp, no double-default, term/rate defaults) → Task 2 (the lending smoke asserts repaid/default/partial/re-settle/clamp). §6 bridges (recordMisconduct no-TrustLedger; runRapSanction rap-gated, topic in payload) → Task 3 (society smoke asserts the rap entry, the single trust drop, the recalled belief, null-on-clean, pass-on-rap).
- §7 0gtown (server-side lending — NOT debiting the world; `borrow` + sanction-first; settle-on-next-action + `ws.on('close')`; emit lend/default/rap + propose/vote/sanction) → Task 5. §7 replay (4-site + light invariants) → Task 4.
- §8 testing incl. the spike deadbeat cascade → Tasks 2/3/5.

**Audit facts honored:** no world $0G transfer (server-side bookkeeping, `lendBalanceOf` returns 0); rap-gated ban reads only `rapSheet.has` (no belief-read in `settleDue`/`runRapSanction`); `recordMisconduct` takes no TrustLedger; a new `ws.on('close')` handler is added (try/caught); `town.propose` payload carries `topic`.

**Placeholder scan:** no TBD/TODO; every code step is complete. The "adapt identifiers / confirm rec/replayT scope" notes in Task 5 are inherent to editing an existing handler; Step 1's grep surfaces them.

**Type consistency:** `RapSheet` (record/entries/has/count), `LoanBook` (lend/due/settle), `Loan`/`Settlement`, `misconductTopic`/`recordMisconduct`/`runRapSanction` (returning `{pid,result,votes}|null`), and the `Cognition.recall(...).discernment.q`/`.trust` reads match the spec and the shipped ②a/②b APIs. The replay `town.lend`/`town.default`/`town.rap` `data` shapes are consistent between Task 4 (pack + viewer) and Task 5 (server emits): `town.default` carries `owed`+`recovered`, `town.rap` carries `offender`+`kind`+`victim`.

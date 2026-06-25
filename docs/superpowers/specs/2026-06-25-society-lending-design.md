# Design: `@onchainpal/cognition` ②c-1 — misconduct layer (rap sheet + lending/default)

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Driver project:** aigg-0gtown (proving ground)
**Home:** `kit/packages/cognition/src/society/` (new module in the existing package)
**Branch:** `society` (stacks on `governance` → `cognition-social` → `replay-library`)

---

## 1. Background & motivation

Sub-project **②c-1** of `@onchainpal/cognition` (see [[kit-extraction-initiative]]; ② = ②a cognition+social → ②b governance → ②c society). ②c (monopoly's `society.py`) covers crime / lending / info-selling / alliances; the user scoped it to the **professional-misconduct layer** and then split it: **②c-1 (this spec) = rap sheet + lending/default**; **②c-2 (later) = crime (extort/sabotage)**. Info-selling and alliances are cut.

The reusable heart is the **rap sheet** — a public misconduct ledger that **generalizes ②b's grounds for a sanction** from "used a known-scam claim" to "has a misconduct record." ②c-1 produces misconduct records (loan defaults); ②b's collective sanction then bans on them.

### Agreed decisions (from brainstorming)

1. **Scope = rap sheet + lending/default only** (②c-1). Crime → ②c-2. Info-selling + alliances cut.
2. **Architecture = Approach A**: pure ledgers; the **host owns balances and triggers loan maturity** (clock-agnostic, exactly like ②b's `Polity.tally`). No economy coupling in the library, no double-accounting with 0gtown's world.
3. **Offender-scoped misconduct topic** — the belief/sanction is keyed to the offender (`misconduct-<offenderId>`), which sidesteps ②b's claim-scoped false-positive (the topic *is* the offender).
4. **Rap-gated collective vote** — the guild bans on the **public rap sheet** (`runRapSanction`); ②b's per-voter `voteBeliefGated` stays available for hosts wanting deliberation.

### What already exists (reused, not rebuilt)

- ②a `Cognition` (`recall`/`learn`/`warn`), `TrustLedger`, `FakeKernel` — the memory/trust substrate.
- ②b `Polity` (`submit`/`cast`/`tally`/`sanctioned`) — the proposal/sanction machine.
- The replay `town@0` pack (extended again here) + the 0gtown 5-NPC guild + the sanction-first pitch check.

### Non-goals (②c-1)

- Crime (extort/sabotage/steal + detection) → ②c-2.
- Info-selling, alliances → cut.
- The library owning balances or a clock (Approach B/the tick model — rejected).

---

## 2. Chosen approach

**Approach A — pure ledgers; host owns economics + triggers maturity.** The library owns *records and logic only*: `RapSheet`, `LoanBook` (records + a `settle` that computes repay-vs-default given host-supplied balances), and a `misconduct.ts` bridge (`recordMisconduct` writes the ②a signal + the rap entry; `runRapSanction` runs the ②b collective ban on the public rap). The host (0gtown) applies $0G transfers and decides when `now` advances. Unit-tested with `FakeKernel` + a synthetic guild — no service, no clock.

---

## 3. Package layout

```
kit/packages/cognition/src/society/
  rapsheet.ts      # RapSheet — pure public misconduct ledger
  lending.ts       # LoanBook — loan records + settle() → repaid | defaulted
  misconduct.ts    # recordMisconduct (②a bridge) + runRapSanction (②b bridge) + misconductTopic()
src/__tests__/
  rapsheet.smoke.ts, lending.smoke.ts, society.smoke.ts
src/index.ts        # re-export the new symbols
```
cognition still depends on nothing in the kit. `misconduct.ts` imports ②a's `Cognition`/`TrustLedger` and ②b's `Polity` (both in this package) — society is the top layer of the package.

---

## 4. RapSheet (pure — the reusable heart)

```ts
export interface RapEntry { kind: string; victim: string; t: number }   // kind: 'default' (②c-1); 'extort'/'sabotage' in ②c-2

export class RapSheet {
  private sheet = new Map<string, RapEntry[]>();
  record(offender: string, entry: RapEntry): void;     // append
  entries(offender: string): RapEntry[];               // [] if clean
  has(offender: string): boolean;                      // any record → grounds for a sanction
  count(offender: string): number;
}
```
Pure in-memory ledger. The public record governance reads.

---

## 5. LoanBook (pure records + settlement; host owns balances)

```ts
export interface Loan { id: string; lender: string; borrower: string; principal: number; rate: number; due: number }
export interface Settlement { loanId: string; lender: string; borrower: string; owed: number; paid: number; defaulted: boolean }

export class LoanBook {
  private loans: Loan[] = [];
  private seq = 0;
  lend(lender: string, borrower: string, opts: { principal: number; rate?: number; term?: number }, now: number): Loan;
    //   records a loan due at now+term (rate default 0.1, term default a host constant); host moves the $0G
  settle(now: number, balanceOf: (id: string) => number): Settlement[];
    //   for each loan with due <= now: owed = principal*(1+rate); paid = min(owed, balanceOf(borrower));
    //   defaulted = paid < owed; removes settled loans; host applies the transfers from the returned list
  due(now: number): Loan[];                            // matured-but-unsettled (for the host to know there's work)
}
```
Clock-agnostic: `now` and `due` are opaque numbers the host interprets. `settle` does **not** move money — it computes outcomes from a host-supplied `balanceOf`; the host applies `paid` (borrower→lender) and treats `defaulted` as the misconduct source.

---

## 6. Bridges (`misconduct.ts`) — compose ②a + ②b

```ts
import type { Cognition } from '../cognition';
import type { Polity, TallyResult, Choice } from '../governance/polity';
import { corpusId } from '../id';
import type { RapSheet } from './rapsheet';

/** A stable, offender-scoped topic. The belief/sanction is keyed to the offender (not a claim),
 *  which avoids ②b's claim-scoped false-positive. */
export function misconductTopic(offender: string): string { return `misconduct-${corpusId(offender)}`; }

/** ②a bridge: on a confirmed misconduct (e.g. a loan default), write the SAME signal a scam does —
 *  victim distrusts the offender, learns an offender-scoped belief, and the offender earns a rap entry.
 *  Best-effort (the cognition calls are non-throwing). Returns the misconduct topic.
 *  Note: `cognition.learn` ALREADY drops the victim→offender trust (TRUST_DELTAS.scammed) and writes the
 *  offender-scoped belief, so there is NO separate TrustLedger param here — that would double-apply. */
export async function recordMisconduct(
  cognition: Cognition, rapSheet: RapSheet,
  victim: string, offender: string, kind: string, now: number,
  detail?: string,
): Promise<string> {
  const topic = misconductTopic(offender);
  rapSheet.record(offender, { kind, victim, t: now });
  await cognition.learn(victim, offender, { topic, description: detail ?? `${offender} committed ${kind}`, outcome: 'loss' });
  return topic;
}

/** ②b bridge: the guild bans on PUBLIC evidence. If the offender has a rap sheet, the proposer opens a
 *  sanction and every guild member votes 'for' (the rap is public); tally. Returns null if the rap is clean. */
export async function runRapSanction(
  rapSheet: RapSheet, polity: Polity,
  proposer: string, offender: string, guild: string[],
  opts?: { until?: number },
): Promise<{ pid: string; result: TallyResult; votes: Record<string, Choice> } | null> {
  if (!rapSheet.has(offender)) return null;
  const pid = polity.submit(proposer, 'sanction', { target: offender, until: opts?.until ?? Infinity });
  const votes: Record<string, Choice> = { [proposer]: 'for' };
  for (const m of guild) {
    if (m === proposer) continue;
    polity.cast(pid, m, 'for');                 // public rap = grounds; all vote to ban
    votes[m] = 'for';
  }
  return { pid, result: polity.tally(pid, guild), votes };
}
```
Note: `recordMisconduct` relies on ②a `learn`'s existing behavior (writes an offender-scoped belief + drops the victim's trust toward the offender via `TRUST_DELTAS.scammed`). `trust` is accepted in the signature for symmetry/future use but `learn` already moves it; the implementation must NOT double-apply.

---

## 7. 0gtown integration ("both") — the deadbeat cascade

- **Per-visitor state**: a minimal server map for visitor $0G balances + the `LoanBook` (visitors currently have no balance). A borrowed amount credits the visitor; repayment/forfeit debits it.
- **`borrow` WS command** (new): `{ cmd:'borrow', npc, amount }` → if the lender NPC has the funds, `loanBook.lend(npcId, visitorId, { principal: amount }, now)`, move `amount` $0G NPC→visitor, reply `{ type:'lent', npc, amount, due }`, record `town.lend`. (A wealthy stall — Cloth-merchant Han — is the natural lender.)
- **Settlement trigger** (clock-agnostic): the server advances a per-visitor interaction counter as `now`; on the visitor's NEXT action after a loan's `due` (or on disconnect), it calls `loanBook.settle(now, balanceOf)`. A `defaulted` settlement → `recordMisconduct(cognition, rapSheet, lender, visitorId, 'default', now)` → `runRapSanction(rapSheet, polity, lender, visitorId, guildIds, { until: Infinity })` → if passed, the visitor is blacklisted. (For the spike, settlement is triggered deterministically; see §8.)
- **Sanction-first** (extend ②b): the existing `polity.sanctioned(visitorId)` short-circuit is added to the `borrow` handler too (and already guards `pitch`), so a banned deadbeat is refused everywhere.
- **Replay** (extend `town@0` again — same 4-site additive change): `town.lend` (`data:{ lender, borrower, amount, due }`), `town.default` (`data:{ lender, borrower, owed, recovered }`), `town.rap` (`data:{ offender, kind, victim }`); reuse `town.propose`/`vote`/`sanction` for the ban. Update `town-pack.smoke` deepEqual + the viewer.
- Governance/cognition blocks wrapped best-effort so a failure never breaks the live reply.

---

## 8. Error handling, testing

- `RapSheet`/`LoanBook` are pure (no I/O, no throw). `recordMisconduct`/`runRapSanction` are best-effort via `recall`/`learn` (non-throwing); `Polity` is pure. The 0gtown blocks are try/caught beside the recorder emits.
- **`rapsheet.smoke`**: record/has/count/entries; clean offender → `has` false, `count` 0.
- **`lending.smoke`**: `lend` records a loan due at `now+term`; `settle` when `balanceOf(borrower) ≥ owed` → `repaid` (defaulted:false, paid=owed); when short → `defaulted:true, paid=balance`; settled loans removed; loans before `due` untouched; `due(now)` lists matured.
- **`society.smoke`** (FakeKernel + `Cognition`/`TrustLedger`/`Polity` + a synthetic guild): `recordMisconduct` writes a rap entry, drops victim→offender trust, and makes a later `recall(victim, offender, topic).discernment.q > 0`; `misconductTopic` is offender-scoped/stable; `runRapSanction` returns null for a clean offender and passes (all 'for') once a rap exists → `polity.sanctioned(offender)` true.
- **0gtown spike extension** (fresh WS connection, per the ②b lesson — a defaulting visitor gets banned, so use a clean visitor): visitor borrows from Han → (no repay) → trigger settlement → `town.default` → guild bans → assert a follow-up `borrow`/`pitch` from that visitor is refused (`bannedByGuild`/sanctioned); assert the replay stream contains `town.lend`/`town.default`/`town.rap`/`town.sanction` and `validateRun`s.

Before claiming done: run the spike and confirm the borrow→default→rap→ban→refuse cascade and that the replay stream with the new event kinds validates.

---

## 9. Why this is the right seam

`RapSheet` and `LoanBook` are pure, reusable ledgers; the only ②a/②b-aware code is `misconduct.ts`, which composes the existing `Cognition` + `Polity` rather than duplicating them. The rap sheet is the new, load-bearing abstraction: it makes "grounds for a ban" a first-class, queryable, replayable record, generalizing ②b. 0gtown proves it end-to-end with a new bad-actor archetype (the deadbeat) reusing the guild + sanction path. ②c-2 (crime) then adds a second misconduct *source* writing to the same rap sheet, with zero change to the ban path.

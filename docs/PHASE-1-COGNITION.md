# Phase 1 — Real cognition (episodic → semantic), file by file

Goal: turn 0gtown's "they actually learn" from a **string-match learn-gate** into
**real episodic→semantic cognition** — beliefs are *synthesized* from clusters of
episodes, *generalize* beyond the exact scam string, get *confidence-scored*, and are
anchored to 0G Storage. This is the README's #1 admitted gap.

## The precise gap (verified in the engine source)

0gtown already builds the real kernel when `MEMORY_URL` is set:

```ts
// src/server.ts (today)
const memKernel = process.env.MEMORY_URL
  ? new AiggMemoryKernel({ baseUrl: process.env.MEMORY_URL, token: process.env.MEMORY_TOKEN })
  : new FakeKernel();
const cognition = new Cognition(memKernel, trust);
```

But `AiggMemoryKernel.reflect()` **throws unless it was constructed with a `reflect`
LLM-backend config** (`packages/cognition/src/kernel/aigg.ts:90` — `if (!this.opts.reflect)
throw`). 0gtown passes only `{baseUrl, token}`, and `Cognition.reflect()` swallows the
throw as best-effort. Net effect **today**, even with `MEMORY_URL` set:

- ✅ `remember` / `select` / `discernment` (retrieval) work → refusal on the *same* scam.
- ❌ `reflect` (consolidation) never runs → no semantic beliefs, **no generalization**.
- ❌ `verify` (confidence scoring) never runs → discernment stays coarse.

Phase 1 closes exactly those two gaps.

## Step 1 — Run the `aigg-memory` sidecar

It ships its own HTTP server (Python), no Python in 0gtown:

```bash
# in an aigg-memory checkout
pip install -e .
aigg-memory serve --root ./game-memory --port 8788   # binds 127.0.0.1 by default
# optional auth: --token "$MEMORY_TOKEN"
```

Endpoints used: `POST /memory/remember`, `/memory/discernment`, `/memory/select`,
`/memory/reflect`, `/memory/verify` (see the memory repo README §"Quickstart — HTTP API").
The corpus lives on disk under `--root` and is **git-backed**, so beliefs already survive
restart (a free lead-in to Phase 4).

## Step 1b — Belief synthesis runs on 0G (NOT Ollama)

Reflection needs an OpenAI-compatible chat backend. Keep everything on 0G — the whole
project's thesis is "think on 0G Compute" — so point the reflect backend at the **0G
Compute Router** (an OpenAI-compatible gateway: one URL, one key, on-chain billing),
exported by the engine as `ZEROG_ROUTER_TESTNET`/`ZEROG_ROUTER_MAINNET`:

- testnet: `https://router-api-testnet.integratenetwork.work/v1` (public — no key)
- mainnet: `https://router-api.0g.ai/v1` (needs a router API key)

The memory sidecar's `http` backend supports a bearer key (`extract.py`), but the reflect
*request* carries no key field — so supply the mainnet router key to the **sidecar** at
launch (`aigg-memory serve --aigg-key "$ZEROG_ROUTER_KEY" …` / its env), not from 0gtown.

**Two backend choices:**

| | Reflect backend | 0G? | TEE-verified? | Effort |
|---|---|---|---|---|
| **A (simple)** | 0G Compute **Router** (`/v1`, OpenAI-compatible) | ✅ | ✗ (router billing, not the broker attestation path) | S |
| **B (purist)** | a tiny local **broker shim** wrapping `ZeroGBrokerProvider` that exposes `/v1/chat/completions`, minting fresh broker headers per call + running `processResponse` | ✅ | ✅ same TEE path as `talk` | M |

Option A gets belief-synthesis onto 0G immediately. Option B (a ~50-line
`src/zerog-openai-shim.ts`) makes reflection carry the **same TEE attestation** as NPC
replies, so *both* thinking and learning are enclave-verified — the fully honest version
of the 0gtown claim. Recommend shipping A first, then B when a TEE badge on consolidation
is wanted.

## Step 2 — Construct the kernel with a reflect backend  ·  `src/server.ts`

```ts
const memKernel = process.env.MEMORY_URL
  ? new AiggMemoryKernel({
      baseUrl: process.env.MEMORY_URL,
      token: process.env.MEMORY_TOKEN,
      // NEW: enables reflect()/dream. Unset → retrieval-only (today's behaviour).
      ...(process.env.MEMORY_REFLECT_URL ? {
        reflect: {
          aiggUrl: process.env.MEMORY_REFLECT_URL,               // 0G Compute Router /v1 (or the Option-B shim)
          model: process.env.MEMORY_REFLECT_MODEL,               // a 0G-served model, e.g. the same GLM-5 used for talk
          backend: process.env.MEMORY_REFLECT_BACKEND ?? 'http', // http (Router/shim) | claude-cli
        },
      } : {}),
    })
  : new FakeKernel();

// reflectOnLearn: after a scam burns an NPC, immediately synthesize a belief from the
// fresh episode cluster — so the NEXT pitch refusal cites a *generalized* semantic belief,
// not the templated string. This is the marquee upgrade.
const cognition = new Cognition(memKernel, trust, { reflectOnLearn: true });
```

`corpusPath` and `AiggMemoryKernel` are exported from `@aigg/cognition`, so nothing new
is needed from the engine.

## Step 3 — A "nightly dream": consolidate + verify  ·  `src/server.ts`

`reflectOnLearn` fires per-loss; add an explicit consolidation+scoring pass so beliefs
also get confidence (`verify`). Debounced so it never blocks the live reply.

```ts
import { corpusPath } from '@aigg/cognition';

/** Best-effort consolidation for one NPC: synthesize beliefs, then score confidence.
 *  Never throws (fire-and-forget). Emits a town.dream replay beat + a WS 'dreamt' event. */
async function dream(npcId: string, npcName: string): Promise<void> {
  if (!process.env.MEMORY_REFLECT_URL) return;         // reflect backend not configured
  try {
    await cognition.reflect(npcId);                     // episodes → semantic beliefs
    const v = await (memKernel as any).verify?.(corpusPath(npcId)); // confidence scoring (AiggMemoryKernel only)
    rec.tick(++replayT);
    rec.event('town.dream', { actor: npcId, by: 'npc', data: { verified: v?.verified ?? 0 } });
    rec.flush();
  } catch (e: any) { console.warn('[0gtown] dream skipped:', e?.message); }
}
```

Call it right after a successful learn in the `pitch` handler (after `cognition.learn(...)`
and the 0G Storage anchor), fire-and-forget:

```ts
void dream(npc.id, npc.name);
```

Optionally broadcast to the browser so the belief ledger shows the *synthesized* belief:
`sendJson({ type: 'dreamt', npc: npc.name, belief: <top semantic belief> })` — the client
already has a belief ledger; add a `case 'dreamt'` that updates the entry text.

## Step 4 — Register the replay event  ·  wherever the town pack is declared

`town.dream` must be an allowed event kind or the recorder rejects it. If the `town@0`
pack is owned by `@aigg/replay`, either it already lists `town.dream` (grep the pack) or
add it to 0gtown's recorder pack list. Verify with a `validateFile` run (spike does this).

## Step 5 — Env + docs

Add to `.env.example` / README (the `MEMORY_URL`/`MEMORY_TOKEN` rows already landed in
Phase 0):

```
# Belief synthesis on 0G Compute (NOT Ollama). Point at the 0G Router (Option A)
# or the local broker shim (Option B, TEE-verified). Testnet router is public.
# MEMORY_REFLECT_URL=https://router-api-testnet.integratenetwork.work/v1
# MEMORY_REFLECT_MODEL=zai-org/GLM-5-FP8          # a 0G-served model (match the talk brain)
# MEMORY_REFLECT_BACKEND=http                     # http (Router/shim) | claude-cli
# mainnet router needs a key — give it to the sidecar: aigg-memory serve --aigg-key "$ZEROG_ROUTER_KEY"
```

## What this unlocks (why it's worth it)

- **Generalization.** After a couple of "double your money" scams, A-Bao forms a semantic
  belief like *"offers to multiply my money are traps"* and refuses a *reworded* scam the
  `FakeKernel` (exact-topic match) would let through.
- **Confidence.** `verify()` scores beliefs, so `shouldRefuse(signal)` gates on graded
  discernment, not a boolean.
- **Track-record & provenance.** The kernel splits self-learned vs warned beliefs and keeps
  an auditable history — the substance behind the "they actually learn" claim.
- **Persistence for free.** Git-backed corpus on disk → beliefs survive restart (Phase 4 lead-in).

## Verification

1. `MEMORY_URL` unset → identical to today (`FakeKernel`); spike still green.
2. `MEMORY_URL` set, `MEMORY_REFLECT_URL` unset → retrieval works, `dream()` is a no-op (no throw).
3. Full config → after two distinct-wording scams, a *third* reworded scam is refused citing
   a synthesized belief; a `town.dream` event appears in the replay and `validateFile` passes.
4. Extend `spike.ts` with a memory-on arc behind an env guard (skips when no sidecar), mirroring
   `packages/gamekit/src/__tests__/shared-world-memory.smoke.ts`.

## Risk / cost

- **LLM cost & latency:** `reflectOnLearn` adds one synthesis call per scam. It's off the
  live-reply path (fire-and-forget), but if it's noisy, switch to a debounced/interval dream
  (every N interactions) instead of per-loss.
- **Sidecar availability:** all calls are best-effort try/caught; a down sidecar degrades to
  today's behaviour, never breaks the town.
- **Effort:** M — Option A ≈1–2 days (Router env + dream + spike arc); Option B adds
  ≈1–2 days for the TEE-verified `zerog-openai-shim.ts`.

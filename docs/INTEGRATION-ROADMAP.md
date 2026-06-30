# 0gtown — Feature Integration Roadmap

> Goal: fold the capabilities scattered across the `aigg-*` family into 0gtown, in a
> sensible order. This catalogs every reusable feature, maps it to 0gtown's current
> state, and sequences the work into phases by demo-value × 0G-narrative fit × effort.

## The key insight

0gtown is a thin TypeScript browser/WS server on top of the **`@aigg/*` engine**
(pulled in as the `kit/` submodule). The engine — `@aigg/{gamekit, npc-agent,
cognition, onchain, replay}` — already ships ~180 exported capabilities, **most of
them production-ready**. mud-demo and monopoly are two *hosts* that exercise different
slices of that same engine.

So "integrating their features" almost never means porting code. It means:

1. **Wiring** an engine class 0gtown doesn't instantiate yet (e.g. `FairTick`, `Metabolism`, `PlanningOracle`).
2. **Surfacing** a server capability that already exists but isn't in the browser UI (e.g. `borrow`, `extort`, governance votes).
3. **Running a sidecar** the engine already speaks to (e.g. the `aigg-memory` kernel via `MEMORY_URL`).

Genuine ports (monopoly's Python research harness, the Go wallet/facilitator/x402
stack) are mostly **off the 0G-native path** and land last, or not at all.

## Where 0gtown stands today

| Surface | Status |
|---|---|
| Engine packages used | `gamekit` (SharedWorld), `cognition` (full), `onchain` (Native0gSettlementLayer), `replay` (town@0 recorder) |
| 0G integration | 0G Compute (TEE brain) ✓ · 0G Storage (belief anchor) ✓ · 0G Chain settle (optional, `ECON_ONCHAIN`) ✓ |
| Memory | `FakeKernel` by default (deterministic stub); `AiggMemoryKernel` only if `MEMORY_URL` set |
| Server commands | `look`, `talk`, `pitch`, `borrow`, `extort`, `settle` |
| **Browser UI exposes** | **`talk`, `pitch`, `settle` only** — `borrow`/`extort`/governance are wired server-side but invisible |
| Replay | records `town@0` events; `/replay` viewer route already mounted |

---

## Master capability map

Legend — **In**: already in 0gtown · **Engine**: ready-to-wire class in `@aigg/*` ·
**Port**: lives in a sibling repo, needs real porting · **Skip**: out of scope for a 0G demo.

### Cognition & memory
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| Learn-gate (pitch → belief → refuse) | `@aigg/cognition` | In | server-side deterministic |
| Trust ledger, warning diffusion, sanction votes | `@aigg/cognition` | In | wired, partly hidden in UI |
| Crime / rap sheet / lending | `@aigg/cognition` | In | `extort`/`borrow` server-only |
| **Real episodic→semantic kernel** (discernment, reflect, dream, track-record) | `aigg-memory` (sidecar) | Engine | `AiggMemoryKernel` already supported — just run it & set `MEMORY_URL` |
| **Dream-time reflection / planning** | `@aigg/gamekit` `ReflectionOracle`/`PlanningOracle`, `SharedWorld.dream()` | Engine | converts shallow learn-gate into real cognition |
| Memory-faculty learning curve (E1) | mud-demo experiments | Port | research; concept already covered by kernel |

### Living-town autonomy
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| **Autonomous NPC↔NPC scams/gossip/trades** | `@aigg/gamekit` `FairTick` | Engine | zero-LLM-in-loop; town stays alive between visitors |
| Gossip / warning relay | `@aigg/gamekit` `SharedWorld.gossip()` | Engine | trust-gated diffusion |
| **Cognitive metabolism** (GCC balance → model tier; broke → fallback) | `@aigg/npc-agent` `Metabolism` | Engine | NPCs visibly "get hungry" as ledger drains |
| Needs (食/醉/眠/群) drives | `@aigg/npc-agent` `Needs` | Engine | adds life/agenda to NPCs |
| Plan execution (move/talk on a plan) | `@aigg/gamekit` `PlanExecutor` | Engine | needs a room graph (currently single room) |

### Economy
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| Native $0G per-NPC settlement | `@aigg/onchain` `Native0gSettlementLayer` | In | `settle` cmd; expand to show EOA addresses/balances |
| **AMM (constant-product) GCC⇌value** | `@aigg/gamekit` `ammSwap` + WorldTx | Engine | spot market = "shadow price of cognition" |
| **Prediction markets** (open/bet/resolve) | `@aigg/gamekit` market WorldTx | Engine | hedge/short scam collapse |
| **Luck / black-swan events** | `@aigg/gamekit` `rollLuck`/`mulberry32` | Engine | talent-vs-luck texture, seeded/reproducible |
| `econPack` replay events | `@aigg/replay` | Engine | record trades/bets/dividends |
| Pump/dump/ponzi/shorting microstructure | monopoly harness | Port | research-grade; heavy |
| Variance decomposition, capability spectrum, patron, cabal, herd-immunity | monopoly harness | Skip | Python research papers, not a playable feature |

### On-chain identity & payments
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| Per-NPC EOA derivation (BIP-44) | `@aigg/onchain` `EoaAgentWallet` | Engine | used inside the settler already |
| Tick anchoring to storage (DA) | `@aigg/gamekit` `TickCommitter`/`ViemTickAnchor` | Engine | anchor full replay ticks to **0G Storage**, not just beliefs |
| Auto-respawn (head-CID memory survives restart) | mud-demo `TieredStore`+`AutoDriveStore` over 0G Storage | Engine/Port | strong 0G-Storage narrative |
| NPC NFT minting + ERC-6551 TBA | mud-demo `npc-minter`, `@aigg/onchain` `computeTbaAddress` | Port | Base-centric; off 0G path |
| x402 / Permit2 / EIP-3009 settlement | `aigg-{src,wallet,facilitator,cca}` | Skip | Go + Base/USDC; different chain, different language |

### Protocol & platform NPCs
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| Replay viewer (live/charts/analysis) | mud-demo `apps/pumptown-web` + `@aigg/replay` viewer | Engine | viewer route already mounted; could enrich |
| Menu/pricing NPC (碧玄子, zero-LLM) | `@aigg/gamekit` `seedAiggPlatformNpcs`/`menuRegistry` | Engine | a free, deterministic NPC |
| Multi-room map | `@aigg/gamekit` rooms + `PlanExecutor` | Engine | 0gtown is single-room ("Market") today |

---

## Integration sequence

Ordered by **(demo value × 0G-narrative fit) ÷ effort**, foundations before dependents.
Effort is T-shirt (S ≤ 1 day, M ≈ 2–4 days, L ≈ 1 week+).

### Phase 0 — Surface what's already built  · effort S · risk low
The server already handles `borrow`, `extort`, and runs full sanction-vote governance;
the events already hit the replay stream. Only the browser UI is missing.
- Add UI affordances for **borrow** (lending) and **extort** (crime → caught → guild ban).
- Visualize the **governance arc** (propose → vote → sanction) already emitted on pitch.
- Link the existing **`/replay`** viewer from the main page.
- **Payoff:** the cognition/society/crime/governance machinery becomes playable with near-zero new code.

### Phase 1 — Real cognition (the README's #1 admitted gap)  · effort M · risk med · 0G-fit ★★★
0gtown defaults to `FakeKernel`; the real `aigg-memory` kernel is production-ready and
already wire-compatible via `AiggMemoryKernel`.
- Stand up the **`aigg-memory` sidecar**, set `MEMORY_URL` — learning becomes real:
  discernment, reflection, track-record, contradiction reconcile, night "dream" consolidation.
- Wire **`SharedWorld.dream()` / `ReflectionOracle`** so beliefs consolidate over time
  (episodic → semantic), each anchored to **0G Storage**.
- **Payoff:** turns "they actually learn" from a server-side gate into genuine cognition — the single biggest credibility upgrade, and it deepens the 0G-Storage story.

### Phase 2 — A town that lives between visitors  · effort M · risk med
- Wire **`FairTick`**: NPCs scam, gossip, and trade *each other* on a tick (zero LLM in
  the loop, so it's cheap to leave running). Warnings diffuse through the guild on their own.
- Add **`Metabolism`**: each NPC's $0G balance drives its model tier; a drained NPC
  visibly downgrades to a scripted "too tired to think" line and recovers when funded.
- Optional **`Needs`** drives (食/醉/眠/群) give NPCs agendas.
- **Payoff:** the market feels alive on its own; metabolism makes the $0G economy *visible* as cognition fuel.

### Phase 3 — A real economy on 0G Chain  · effort L · risk med · 0G-fit ★★★
Fulfills the README's "0G Chain (later round)" promise; `Native0gSettlementLayer` is
already integrated, so this extends rather than introduces.
- Promote `settle` to a first-class economy: show **per-NPC 0G EOA addresses + live on-chain balances**.
- Add **AMM** (`ammSwap`) so $0G has a floating market price ("shadow price of cognition").
- Add **prediction markets** (open/bet/resolve) to hedge/short an NPC's collapse.
- Add **luck / black-swan** events (`rollLuck`, seeded) for talent-vs-luck texture.
- Record all of it via the **`econPack`** replay events.
- **Payoff:** a self-contained on-chain $0G economy with verifiable, replayable history.

### Phase 4 — Persistence & DA on 0G Storage  · effort L · risk med · 0G-fit ★★★
- Anchor **full replay ticks** (not just beliefs) to 0G Storage via `TickCommitter`/`ViemTickAnchor` — the DA layer.
- **Auto-respawn**: NPC identity + memory survive restarts via head-CID anchoring
  (`TieredStore` + `AutoDriveStore` with the existing `ZeroGStorageClient` as the drive backend).
- **Payoff:** the strongest possible 0G-Storage demonstration — a town whose entire history and memory is content-addressed and recoverable.

### Phase 5 — Deep wallet/payment rails  · effort L · risk high · 0G-fit ★ (optional)
Only if agent-to-agent micropayments become a goal.
- NPC NFT minting + ERC-6551 TBAs (mud-demo `npc-minter`).
- x402 / Permit2 / EIP-3009 settlement (`aigg-wallet` Go lib + `aigg-facilitator`).
- **Caveat:** Base/USDC-centric and partly Go — a different chain and runtime from the
  0G-native story. Recommend deferring or dropping unless the product specifically needs it.

---

## What to deliberately skip
- **monopoly's research harness** (variance decomposition, capability spectrum, patron
  policy sweeps, cabal/herd-immunity studies): Python, paper-oriented; the *playable*
  concepts (governance, lending, gossip, fraud-learning) are already in `@aigg/cognition`.
- **aigg-cca / aigg-facilitator / aigg-src / aigg-wallet payment stack**: GCC/USDC on
  Base via x402/Permit2, mostly Go. Excellent infra, wrong chain/runtime for a 0G demo.

## Suggested first PR
Phase 0 + the Phase-1 sidecar switch: surface `borrow`/`extort`/governance in the UI,
link the replay viewer, and document running the `aigg-memory` sidecar so `MEMORY_URL`
flips learning from `FakeKernel` to the real kernel. High payoff, low risk, no new chains.

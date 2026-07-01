# 0gtown — Feature Integration Roadmap

> Goal: fold the capabilities scattered across the `aigg-*` family into 0gtown, in a
> sensible order. This catalogs every reusable feature, maps it to 0gtown's current
> state, and sequences the work into phases by demo-value × 0G-narrative fit × effort.

## Settlement decision (binding)

**The entire economy runs on 0G EVM, settled in native $0G — no Base, no GCC, no
USDC, no x402/Permit2/EIP-3009.** Every "value" leg below is denominated directly in
native $0G and moved by ordinary native-coin transfers on 0G chain.

This is the *lighter* path, and 0gtown is already on it: `Native0gSettlementLayer` +
`ViemNativeChain` (pointed at the 0G EVM RPC) settle native $0G from per-NPC EOAs.
Native coin needs no token-approval dance, so the whole Base/GCC/x402/Permit2 stack
(`aigg-{cca,facilitator,src,wallet}`) is **out** — we borrow only the chain-agnostic
*patterns* (per-NPC EOA derivation, gas auto-funding) and re-target them to 0G EVM.
One consequence: an AMM "spot price of GCC" has no second asset in a pure-$0G world —
markets that need a price are modeled in $0G terms or dropped (see Phase 3).

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
| Native $0G per-NPC settlement on 0G EVM | `@aigg/onchain` `Native0gSettlementLayer`+`ViemNativeChain` | In | the whole economy; `settle` cmd; expand to show EOA addresses/balances |
| **Prediction markets** (stake $0G / win $0G) | `@aigg/gamekit` market WorldTx | Engine | hedge/short an NPC's collapse — works natively in $0G |
| **Luck / black-swan events** ($0G swings) | `@aigg/gamekit` `rollLuck`/`mulberry32` | Engine | talent-vs-luck texture, seeded/reproducible |
| `econPack` replay events | `@aigg/replay` | Engine | record trades/bets/dividends |
| AMM (constant-product) spot market | `@aigg/gamekit` `ammSwap` | Skip | needs a *second* asset to price; no second token in a pure-$0G world |
| Pump/dump/ponzi/shorting microstructure | monopoly harness | Port | research-grade; heavy |
| Variance decomposition, capability spectrum, patron, cabal, herd-immunity | monopoly harness | Skip | Python research papers, not a playable feature |

### On-chain identity & payments
| Capability | Source | 0gtown | Notes |
|---|---|---|---|
| Per-NPC EOA derivation (BIP-44) on 0G EVM | `@aigg/onchain` `EoaAgentWallet` | In | already used inside the native-$0G settler |
| Gas auto-funding (re-targeted to 0G EVM) | pattern from `aigg-wallet`/`aigg-src` | Port | keep NPC EOAs gassed for native transfers; reimplement in TS over 0G RPC |
| Tick anchoring to storage (DA) | `@aigg/gamekit` `TickCommitter`/`ViemTickAnchor` | Engine | anchor full replay ticks to **0G Storage**, not just beliefs |
| Auto-respawn (head-CID memory survives restart) | mud-demo `TieredStore`+`AutoDriveStore` over 0G Storage | Engine/Port | strong 0G-Storage narrative |
| NPC NFT minting + ERC-6551 TBA | mud-demo `npc-minter`, `@aigg/onchain` `computeTbaAddress` | Skip | not needed — native-$0G EOAs already carry per-NPC balance |
| x402 / Permit2 / EIP-3009 / GCC / USDC settlement | `aigg-{src,wallet,facilitator,cca}` | Skip | Base/token stack — superseded by native $0G on 0G EVM |

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

### Phase 3 — A real native-$0G economy on 0G EVM  · effort L · risk med · 0G-fit ★★★
Fulfills the README's "0G Chain (later round)" promise. Everything settles in **native
$0G on 0G EVM** — `Native0gSettlementLayer` + `ViemNativeChain` (0G RPC) are already
integrated, so this extends rather than introduces, and there's no token/Permit2 layer.
- Promote `settle` to a first-class economy: show **per-NPC 0G EOA addresses + live on-chain native $0G balances**, with explorer links (already built in `settle`).
- Add **gas auto-funding** for NPC EOAs (re-target the `aigg-wallet`/`aigg-src` pattern to 0G EVM in TS) so native transfers never stall on empty gas.
- Add **prediction markets** (open/bet/resolve) denominated in $0G — stake $0G, win $0G — to hedge/short an NPC's collapse.
- Add **luck / black-swan** events (`rollLuck`, seeded) as $0G swings for talent-vs-luck texture.
- Record all of it via the **`econPack`** replay events.
- **Skipped here:** the constant-product **AMM** — a "spot price" needs a second asset, and a pure-$0G world has none. Revisit only if a second on-chain asset is ever introduced.
- **Payoff:** a self-contained native-$0G economy on 0G EVM with verifiable, replayable history — no bridges, no Base, no stablecoin.

### Phase 4 — Persistence & DA on 0G Storage  · effort L · risk med · 0G-fit ★★★
- Anchor **full replay ticks** (not just beliefs) to 0G Storage via `TickCommitter`/`ViemTickAnchor` — the DA layer.
- **Auto-respawn**: NPC identity + memory survive restarts via head-CID anchoring
  (`TieredStore` + `AutoDriveStore` with the existing `ZeroGStorageClient` as the drive backend).
- **Payoff:** the strongest possible 0G-Storage demonstration — a town whose entire history and memory is content-addressed and recoverable.

### Phase 5 — Agent-to-agent micropayments in native $0G  · effort M · risk med · 0G-fit ★★ (optional)
If NPCs (and visitors) should pay each other directly, do it the native way — no token rails.
- Let NPCs send **native $0G** to each other / to visitors via their per-NPC EOAs
  (`Native0gSettlementLayer` already owns the signer + treasury; add a directed transfer).
- Reuse the Phase-3 **gas auto-funding** so paying EOAs always have gas.
- **Explicitly dropped:** the Base/GCC/USDC/x402/Permit2/EIP-3009/TBA stack
  (`aigg-{cca,facilitator,src,wallet}`) — native $0G transfers make it unnecessary.
- **Caveat:** real value moving between EOAs needs care around dust, gas reserve, and
  re-entrancy on the `settle` path; `Native0gSettlementLayer` already handles dust/gas reserve.

---

## What to deliberately skip
- **monopoly's research harness** (variance decomposition, capability spectrum, patron
  policy sweeps, cabal/herd-immunity studies): Python, paper-oriented; the *playable*
  concepts (governance, lending, gossip, fraud-learning) are already in `@aigg/cognition`.
- **aigg-cca / aigg-facilitator / aigg-src / aigg-wallet payment stack**: GCC/USDC on
  Base via x402/Permit2, mostly Go. Excellent infra, but explicitly superseded by the
  **native-$0G-on-0G-EVM** decision above — no Base, no GCC, no stablecoin, no token
  authorization. We borrow only the chain-agnostic patterns (per-NPC EOA derivation,
  gas auto-funding) and reimplement them in TS against the 0G EVM RPC.

## Suggested first PR
Phase 0 + the Phase-1 sidecar switch: surface `borrow`/`extort`/governance in the UI,
link the replay viewer, and document running the `aigg-memory` sidecar so `MEMORY_URL`
flips learning from `FakeKernel` to the real kernel. High payoff, low risk, no new chains.

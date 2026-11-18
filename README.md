# signal-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andsfx/signal-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andsfx/signal-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Signal Radar is a token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the pre-token ones by an implied value computed from the snapshot's own figures, and ships an offline dashboard where every row carries the steps to farm that protocol.

## The model

Signal Radar `radar-5` scores pre-token protocols with a winsorized OLS comps fit of `ln(mcap)` on `ln(tvl)` over live anchors (slope clamped to [0.3, 0.5], intercept calibrated so the median predicted anchor equals the median traded market cap), then adjusts with per-category family multipliers (median observed/predicted, clamped [0.3, 3], shrunk by `n/(n+8)`), a 7-day growth factor, and an age-based seasoning term. Curated-AUM categories (Risk Curators, Onchain Capital Allocator) are dampened and capped so managed AUM does not overstate tokenizable value. Verdicts (Farm/Marginal/Skip) are assigned by board-wide breakeven-odds quantiles for a balanced, data-derived distribution (best ~30% Farm, next ~34% Marginal, the rest Skip), plus P10-P90 bands at `exp(±1.28*sigma)`. See `docs/MODEL.md` for the full specification.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, the `out/dashboard/` page and `out/dossier.json`. Two runs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

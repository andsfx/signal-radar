# signal-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andsfx/signal-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andsfx/signal-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Signal Radar is a token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the pre-token ones by an implied value computed from the snapshot's own figures, and ships an offline dashboard where every row carries the steps to farm that protocol.

The implied-value model ("radar-3") anchors its category multipliers on the snapshot's live-token market: each category's median market-cap-to-TVL ratio, shrunk toward 1 by sample size, so no name is ever hardcoded. Growth is winsorized, maturity runs to 4 years, and extra chains add a small bonus.

## The model

Signal Radar `radar-4` scores pre-token protocols with an OLS comps fit of `ln(mcap)` on `ln(tvl)` over live anchors, then adjusts with per-category family multipliers (median observed/predicted, clamped [0.3, 3], shrunk by `n/(n+8)`), a 7-day growth factor, and an age-based seasoning term. The implied value yields breakeven odds at $20/month to assign Farm/Marginal/Skip verdicts, plus P10-P90 bands at `exp(±1.28*sigma)`. See `docs/MODEL.md` for the full specification.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The program writes `out/board.json`, `out/data.js`, the `out/dashboard/` page and `out/dossier.json`. Two runs are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

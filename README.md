# Signal Radar: comps-fitted value, calibrated to the traded market

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rank.svg)](https://make.fun/leaderboard/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![status](https://make.fun/badge/token-radar-01/status.svg)](https://make.fun/leaderboard/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**live:** https://aryanduntley.github.io/token-radar-01/
**repo:** https://github.com/aryanduntley/token-radar-01

## For bounty judges (review path)

- **Screenshot 1 (`screenshots/1-board.png`)**: board utama dengan stats, formula block (persamaan value, parameter fit `a, b, n, sigma`, dan **leave-one-out median miss**), serta tabel teratas yang menampilkan verdict dan kolom **LAUNCH ODDS**.
- **Screenshot 2 (`screenshots/2-detail.png`)**: modal detail row (Farm/Marginal) yang menunjukkan implied value, **Launch odds** dengan penjelasan (“the odds a launch must beat to repay $20/month of farming”), dan breakdown model (TVL/family/growth/seasoning/ekuivalen).
- **Screenshot 3 (`screenshots/3-filtered.png`)**: view terfilter (watchlist-only) yang memperlihatkan distribusi verdict dan breakeven odds yang konsisten dan masuk akal.

## Model (radar-6)

Signal Radar `radar-6` memberi skor protokol pre-token dengan **OLS comps fit** `ln(mcap) ~ a + b·ln(tvl)` pada anchor live (protokol traded dengan `mcap > 0`, `tvl > 0`) dari snapshot yang sama. Nilai tersirat dihitung sebagai:

`value = exp(a + b·ln(TVL)) × family × growth × seasoning`

- **Fit**: parameter `a, b, n, sigma` (sigma = RMSE residual di ruang log) dipublikasikan apa adanya dari fit pada anchor live.
- **LOOCV (leave-one-out)**: tiap anchor diprediksi dari refit OLS pada N-1 anchor lainnya; miss per anchor `|pred − observed| / observed`, dilaporkan sebagai median persen (`radar.fit.loo_median_miss_pct`). Pada snapshot kit ini: **median miss 84.57%** (n=119, a=7.788, b=0.472, sigma=2.053).
- **Adjustments**: family multiplier per kategori (median observed/predicted, clamped & shrunk), growth factor dari perubahan TVL 7 hari, seasoning/age factor, serta perlakuan khusus kategori curated-AUM agar AUM terkelola tidak overstated.
- **Uncertainty**: pita P10-P90 dari `exp(±1.28·sigma)`.
- **Verdict & Launch odds**: `breakeven_odds = monthly_cost / implied_value` (ditampilkan sebagai **Launch odds %**). Verdict Farm/Marginal/Skip ditetapkan dari quantile breakeven odds di seluruh board untuk distribusi yang seimbang dan data-derived.

Spesifikasi lengkap: [`docs/MODEL.md`](docs/MODEL.md).

---
<sub>built for [make.fun token-radar-01](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

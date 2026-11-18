# Signal Radar - model radar-6

Dokumen ini menjelaskan model penilaian `radar-6` yang digunakan Signal Radar
untuk memberi skor pada protokol pre-token berdasarkan snapshot DefiLlama yang
tersegel. Semua angka diturunkan dari snapshot input yang sama; tidak ada
special-casing per protokol.

## Tujuan

Model mengestimasi **nilai token tersirat** (implied token value) untuk protokol
pre-token dengan membandingkannya terhadap protokol yang sudah memiliki market
cap di pasar (anchor) pada snapshot yang sama. Nilai ini dipakai untuk menilai
apakah farming peluang token layak secara ekonomi relatif terhadap biaya bulanan.

## Data & anchor

- **Anchor live**: protokol dalam snapshot dengan `mcap_usd > 0` dan
  `tvl_usd > 0`.
- **Board pre-token**: protokol pre-token yang masuk watchlist (selalu tercakup)
  dan kandidat early tambahan dari snapshot sesuai aturan builder.
- Fit dilakukan pada ruang log: `ln(mcap_usd)` terhadap `ln(tvl_usd)`.

## Fit OLS: ln(mcap) ~ a + b·ln(tvl)

Model memakai ordinary least squares (OLS) linier pada seluruh anchor live:

- `x_i = ln(tvl_i)`
- `y_i = ln(mcap_i)`
- Estimasi: `b = (n·Σx_i y_i − Σx_i Σy_i) / (n·Σx_i² − (Σx_i)²)`,
  `a = (ȳ − b·x̄)`.
- `sigma` adalah RMSE residual di ruang log:
  `sigma = sqrt((1/n) · Σ(y_i − (a + b·x_i))²)`.

Tidak ada winsorization, clamping slope, atau kalibrasi ulang intercept pada
`radar-6`; parameter `a, b, n, sigma` yang dipublikasikan adalah hasil fit OLS
langsung pada anchor live snapshot.

## Leave-one-out validation (LOOCV)

Untuk menguji ketahanan fit pada anchor yang tidak pernah dilihat model,
radar-6 melakukan leave-one-out cross-validation pada anchor yang sama:

1. Untuk tiap anchor *i*, fit ulang OLS pada *N-1* anchor lainnya (update
   inkremental jumlah Σx, Σy, Σx², Σxy; tanpa winsorization/clamping/in-sample).
2. Prediksi anchor yang ditinggalkan: `pred_i = exp(a_{-i} + b_{-i}·ln(tvl_i))`.
3. Hitung miss absolut relatif: `miss_i = |pred_i − observed_i| / observed_i`.
4. Laporkan **median** miss dalam persen sebagai
   `radar.fit.loo_median_miss_pct`.

Angka ini adalah bukti walk-forward-style sanity check: seberapa dekat prediksi
model pada protokol traded yang di-hold-out, dibanding market cap observasinya.
Miss yang tinggi mencerminkan variasi lintas-sektor/protokol yang besar pada
pasar; parameter dan miss ditampilkan apa adanya di formula block dashboard.

## Komponen nilai

Untuk setiap protokol pre-token, nilai dasar dari fit:

- `fit_base_usd = exp(a + b · ln(tvl_usd))` (atau fallback aman jika fit tidak
  tersedia).

Penyesuaian diterapkan secara multiplikatif:

- **Family multiplier**: median rasio `observed_mcap / fit_base` per kategori
  anchor, di-clamp ke `[0.3, 3]` dan di-shrink dengan bobot `n/(n+k)` (k
  konstan model) agar kategori kecil tidak overfit.
- **Growth factor**: fungsi dari perubahan TVL 7 hari (`change_7d`), dibatasi
  agar outlier tidak mendominasi.
- **Seasoning/age factor**: fungsi usia protokol (`age_days`) untuk membedakan
  protokol yang terlalu baru dari yang lebih mapan.
- **Curated-AUM treatment**: kategori kurasi/AUM tertentu (mis. Risk Curators,
  Onchain Capital Allocator) diberi redaman dan cap agar AUM terkelola tidak
  diperlakukan setara TVL/tokenizable value secara berlebihan.

Hasil akhir:

- `implied_value_usd = max(1, round(comps × family × growth × seasoning))`
  (dengan komponen/penamaan sesuai field model di output).

## Pita ketidakpastian (P10-P90)

Ketidakpastian diturunkan dari sebaran residual fit di ruang log (`sigma`):

- Band P10-P90 memakai faktor `exp(±1.28 · sigma)` di sekitar nilai tersirat,
  merepresentasikan rentang plausible berdasarkan dispersi anchor traded.

## Breakeven odds & verdict

Dengan biaya farming bulanan model `monthly_cost_usd` (USD/bulan):

- `breakeven_odds = monthly_cost_usd / implied_value_usd` (ditampilkan sebagai
  persen `breakeven_odds_pct` di board/detail: “Launch odds”, peluang launch
  minimum agar biaya farming terbayar kembali).
- **Verdict** ditetapkan dari distribusi quantile breakeven odds di seluruh
  board (bukan ambang absolut ad hoc): porsi terbaik menjadi **Farm**, porsi
  berikutnya **Marginal**, sisanya **Skip**, sehingga distribusi verdict
  seimbang dan diturunkan dari data board.

## Formula block di board

Dashboard radar-6 memajang formula dan bukti fit langsung di atas tabel board
(formula strip): persamaan value, parameter fit `a, b, n, sigma` dari anchor
live, dan hasil LOOCV (median miss). Tujuannya agar klaim dan kualitas model
terbaca langsung dari screenshot utama tanpa membuka detail atau source.

## Sumber & determinisme

Semua perhitungan berasal dari snapshot input yang disediakan ke build
(`--input` / environment kit) dan diserialisasi ke `out/board.json`,
`out/data.js`, dashboard, dan dossier. Versi model dicatat sebagai
`radar-6` di output.

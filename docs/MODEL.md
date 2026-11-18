# Signal Radar - model radar-4

Dokumen ini menjelaskan model penilaian `radar-4` yang digunakan Signal Radar
untuk memberi skor pada protokol pre-token berdasarkan snapshot DefiLlama yang
tersegel. Semua angka diturunkan dari snapshot itu sendiri, bukan dari daftar
nama protokol yang di-hardcode.

## Comps fit

Model membangun regresi OLS log-log terhadap **anchors**: protokol yang sudah
memiliki token trading (`mcap_usd` tidak null dan > 0), memiliki `tvl_usd > 0`,
dan bukan kategori `CEX`. Anchors merepresentasikan pasar live yang sudah memberi
harga token per unit TVL.

Bentuk model:

```
ln(mcap) = a + b * ln(tvl)
```

Fitted value (dalam USD) untuk TVL suatu protokol:

```
comps = exp(a + b * ln(tvl_usd))
```

Rumus OLS closed form (least squares) dari n titik `(x_i, y_i)` dengan
`x_i = ln(tvl_i)` dan `y_i = ln(mcap_i)`:

```
b = (n * Σ(x_i*y_i) - Σx_i * Σy_i) / (n * Σ(x_i^2) - (Σx_i)^2)
a = (ȳ - b * x̄) = (Σy_i - b * Σx_i) / n
```

Residual spread `sigma` adalah standar deviasi residual (akar dari mean squared
error):

```
sigma = sqrt((1/n) * Σ(y_i - (a + b*x_i))^2)
```

Jika jumlah anchor < 10, model memakai fallback `comps = tvl_usd * 0.25`.

Hasil fit pada snapshot (`/data/home/token-radar-01-kit/input/snapshot.json`):

- n (anchors): 119
- a (intercept): 7.788132074315686
- b (slope): 0.4720759542766921
- sigma: 2.052536547202311
- fallback: false

## Multiplier keluarga

Untuk setiap kategori, model menghitung rasio `observed / predicted` dari setiap
anchor di kategori tersebut, di mana `predicted` adalah fitted comps value.
Multiplier kategori dihitung sebagai berikut:

1. Ambil **median** dari rasio `observed / predicted` per kategori (`raw`).
2. **Clamp** `raw` ke rentang `[0.3, 3]`.
3. **Shrinkage** ke arah 1 berdasarkan ukuran sampel:

```
mult = 1 + (raw_clamped - 1) * n / (n + 8)
```

di mana `n` adalah jumlah anchor dalam kategori dan konstanta shrinkage `k = 8`.
Kategori tanpa anchor diberi multiplier 1.

5 kategori dengan multiplier tertinggi (snapshot fit):

1. Canonical Bridge — mult 2.0000 (n=8, median obs/pred 3.1990, clamped 3.0)
2. Cross Chain Bridge — mult 1.6667 (n=4, median obs/pred 3.3545, clamped 3.0)
3. Privacy — mult 1.5455 (n=3, median obs/pred 6.9895, clamped 3.0)
4. Token Locker — mult 1.4000 (n=2, median obs/pred 19.7172, clamped 3.0)
5. Derivatives — mult 1.4000 (n=2, median obs/pred 4.2429, clamped 3.0)

5 kategori dengan multiplier terendah (snapshot fit):

1. Payments — mult 0.8600 (n=2, median obs/pred 0.2958, clamped 0.3)
2. Yield Aggregator — mult 0.8259 (n=4, median obs/pred 0.4778)
3. Indexes — mult 0.8135 (n=3, median obs/pred 0.3161)
4. Lending — mult 0.7708 (n=15, median obs/pred 0.6485)
5. Liquid Staking — mult 0.6907 (n=9, median obs/pred 0.4158)

## Growth dan seasoning

**Growth factor** memakai perubahan TVL 7 hari (`change_7d`, 0 jika null), di-clamp
ke rentang `[-40, 80]` persen lalu diberi bobot 0.5:

```
growth_pct = clamp(change_7d ?? 0, -40, 80)
growth_multiplier = 1 + (growth_pct / 100) * 0.5
```

**Seasoning** memberi diskon pada protokol muda untuk mencerminkan track record
yang pendek. Umur `age_days` dihitung dari `as_of` ke `listed_at` (dalam hari);
jika umur tidak diketahui dipakai default 365 hari:

```
seasoning = 1 - 0.4 * exp(-age_days / 24)
```

Protokol yang sangat baru mendekati multiplier 0.6, sementara protokol matang
mendekati 1.0.

## Verdict

Nilai implisit akhir:

```
implied = max(1, round(comps * family_multiplier * growth_multiplier * seasoning))
```

Breakeven odds (biaya farming bulanan terhadap implied value):

```
breakeven_odds = 20 USD/bulan / implied_value_usd
```

Klasifikasi verdict berdasarkan breakeven odds:

- **Farm**: odds < 1% (implied value cukup besar relatif biaya)
- **Marginal**: 1% ≤ odds < 5%
- **Skip**: odds ≥ 5%

## Band P10-P90

Ketidakpastian distribusi nilai direpresentasikan sebagai band sekitar implied
value menggunakan spread residual `sigma` dari comps fit (±1.28 sigma, kira-kira
persentil 10 dan 90 pada asumsi log-normal):

```
p10 = max(1, round(implied * exp(-1.28 * sigma)))
p90 = round(implied * exp(1.28 * sigma))
```

Dengan `sigma = 2.052536547202311` pada snapshot fit, band ini mencerminkan
sebaran residual anchor di ruang log.

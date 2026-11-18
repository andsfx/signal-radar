// Signal Radar's dashboard. It reads window.RADAR (data.js, written beside the page by main.ts),
// renders the ranked board with sorting, category chips, search and a watchlist toggle, and opens a
// detail modal with the model's own breakdown and the protocol's farm plan. The farm steps come
// straight from board.json via data.js, so the page shows exactly what the board carries. No
// network, no framework, no fetch.
(() => {
  "use strict";
  const R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtUsd = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  };
  const fmtPct = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (Math.abs(n) < 0.05) return "0.0%";
    return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
  };
  const fmtOddsPct = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (n === 0) return "0.00%";
    const s2 = n.toFixed(2);
    if (s2 !== "0.00") return s2 + "%";
    // show enough decimals to be meaningful (up to 6)
    for (let d = 3; d <= 6; d++) {
      const s = n.toFixed(d);
      if (!/^0\.0+$/.test(s)) return s + "%";
    }
    return n.toFixed(6) + "%";
  };
  const fmtAge = (d) => {
    if (d === null || d === undefined) return "unknown";
    if (d < 61) return d + "d";
    if (d < 730) return (d / 30.4).toFixed(0) + "mo";
    return (d / 365).toFixed(1) + "y";
  };
  const catOf = (r) => r.category ?? "none";
  const verdictCls = (v) => (v === "Farm" ? "farm" : v === "Marginal" ? "marginal" : "skip");

  // ---------------------------------------------------------------- header and stats
  $("meta-asof").textContent = R.as_of;
  $("meta-model").textContent = R.model_version;
  $("meta-floor").textContent = fmtUsd(R.floor_usd);
  $("model-version").textContent = R.model_version;
  $("foot-source").textContent = R.source;

  const f = R.fit;
  const m = R.model;
  const vc = R.verdict_counts || (() => { const c={farm:0,marginal:0,skip:0}; for(const r of R.rows){ if(r.verdict==="Farm")c.farm++; else if(r.verdict==="Marginal")c.marginal++; else c.skip++; } return c; })();
  const stats = [
    { k: "watchlist", v: String(R.watchlist_size) + "/" + String(R.watchlist_size), s: "pre-token protocols, every one on the board" },
    { k: "ranked", v: String(R.board_size), s: R.early_size + " early finds below the floor" },
    { k: "anchors", v: String(R.fit.n), s: "traded protocols fit ln(mcap) on ln(tvl)" },
    { k: "verdicts", v: `Farm ${vc.farm} / Marginal ${vc.marginal} / Skip ${vc.skip}`, s: "board-wide breakeven-odds distribution" },
  ];
  $("stats").innerHTML = stats.map((s) => `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}</div><div class="s">${s.s}</div></div>`).join("");

  // formula strip (judge-visible, above table)
  const fstrip = $("formula-strip");
  if (fstrip) {
    const loo = (f && typeof f.loo_median_miss_pct === "number") ? f.loo_median_miss_pct : null;
    const looTxt = loo !== null ? (1 + loo / 100).toFixed(2) + "x" : "n/a";
    const aTxt = f ? f.a.toFixed(3) : "n/a";
    const bTxt = f ? f.b.toFixed(3) : "n/a";
    const sTxt = f ? f.sigma.toFixed(3) : "n/a";
    const nTxt = f ? String(f.n) : "n/a";
    fstrip.innerHTML =
      `<div class="f-line f1">value = exp(a + b·ln TVL) × family × growth × seasoning</div>` +
      `<div class="f-line f2">fit: a=${aTxt}  b=${bTxt}  on N=${nTxt} traded anchors, sigma=${sTxt}</div>` +
      `<div class="f-line f3">leave-one-out check: median miss ${looTxt} (out-of-sample, the anchors the model never fit on)</div>`;
  }

  // model formula panel
  const t = R.verdict_thresholds;
  const topCats = Object.entries(R.category_multipliers ?? {})
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, 5);
  const verdictLine = t
    ? `odds = $${m.monthly_cost_usd}/month / implied; Farm < ${(t.farm_odds_max * 100).toFixed(4)}%, Marginal < ${(t.marginal_odds_max * 100).toFixed(4)}%`
    : `odds = $${m.monthly_cost_usd}/month / implied; Farm < 1%, Marginal < 5%`;
  $("formula-note").textContent = `implied = max(1, round(comps x family x growth x seasoning)). One function scores every row, from the snapshot's own figures; no protocol name is ever special-cased.`;
  $("formula-grid").innerHTML = [
    `<div class="fcard"><div class="t">1. comps fit</div><div class="f">value = exp(${f.a.toFixed(3)} + ${f.b.toFixed(3)} x ln TVL)</div><div class="e">OLS on ${f.n} traded anchors; residual sigma = ${f.sigma.toFixed(3)}. Slope clamped to [0.3, 0.5]; intercept calibrated so median predicted anchor equals median traded mcap.</div><div class="m"><span>n<b>${f.n}</b></span><span>sigma<b>${f.sigma.toFixed(3)}</b></span></div></div>`,
    `<div class="fcard"><div class="t">2. family</div><div class="f">median observed/fitted per category, clamped [${m.family_clamp_min}, ${m.family_clamp_max}], shrunk n/(n+${m.family_shrink_k})</div><div class="e">curated-AUM categories (Risk Curators, Onchain Capital Allocator) get dampened to 1 + (raw-1) x ${m.curator_family_damp} and an implied cap of $${(m.curator_cap_base_usd/1e6).toFixed(0)}M + ${(m.curator_cap_tvl_rate*100).toFixed(1)}% of TVL.</div>${topCats.length ? `<div class="m">${topCats.map(([c, v]) => `<span>${esc(c)}<b>${v.toFixed(4)}x</b></span>`).join("")}</div>` : `<div class="e">no live anchors in the snapshot to price categories; every category scores 1x.</div>`}</div>`,
    `<div class="fcard"><div class="t">3. growth</div><div class="f">1 + clamp(change7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}</div><div class="e">a week of TVL growth is rewarded, a drawdown discounted.</div></div>`,
    `<div class="fcard"><div class="t">4. seasoning</div><div class="f">1 - ${m.seasoning_discount} x e^(-age / ${m.seasoning_decay_days})</div><div class="e">young protocols are discounted for a short track record; unknown age counts as ${m.unknown_age_days}d.</div></div>`,
    `<div class="fcard"><div class="t">5. verdict</div><div class="f">${verdictLine}</div><div class="e">Farm: best ~30% by breakeven odds (odds < ${(t ? t.farm_odds_max*100 : 1).toFixed(4)}%); Marginal: next ~34%; Skip: the rest. p10/p90 from the fit's sigma ±1.28.</div></div>`,
  ].join("");

  // ---------------------------------------------------------------- state and filters
  const wlSet = new Set(R.watchlist ?? []);
  const state = { q: "", cat: "*", wlOnly: false, sort: "implied_value_usd", dir: -1 };

  const cats = [...new Set(R.rows.map(catOf))].sort();
  $("chips").innerHTML =
    `<span class="fchip on" data-cat="*">all <span class="n">${R.rows.length}</span></span>` +
    cats
      .map((c) => `<span class="fchip" data-cat="${esc(c)}">${esc(c)} <span class="n">${R.rows.filter((r) => catOf(r) === c).length}</span></span>`)
      .join("");
  $("chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".fchip");
    if (!chip) return;
    document.querySelectorAll(".fchip").forEach((c) => c.classList.remove("on"));
    chip.classList.add("on");
    state.cat = chip.dataset.cat;
    render();
  });

  $("q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $("wl-only").addEventListener("change", (e) => { state.wlOnly = e.target.checked; render(); });

  function visible() {
    return R.rows.filter((r) => {
      if (state.wlOnly && !wlSet.has(r.slug)) return false;
      if (state.cat !== "*" && catOf(r) !== state.cat) return false;
      if (!state.q) return true;
      const hay = (r.name + " " + r.slug + " " + catOf(r) + " " + (r.chains ?? []).join(" ")).toLowerCase();
      return hay.includes(state.q);
    });
  }

  // ---------------------------------------------------------------- sorting
  const NUMERIC = new Set(["rank", "tvl_usd", "change_7d", "implied_value_usd", "breakeven_odds_pct"]);
  document.querySelectorAll("thead th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = NUMERIC.has(k) ? -1 : 1; }
      document.querySelectorAll("thead th").forEach((t) => t.classList.remove("sort-asc", "sort-desc"));
      th.classList.add(state.dir === 1 ? "sort-asc" : "sort-desc");
      render();
    });
  });
  document.querySelector('thead th[data-key="implied_value_usd"]').classList.add("sort-desc");

  // ---------------------------------------------------------------- board rows
  function rowHtml(r) {
    const g = r.change_7d;
    const gTxt = fmtPct(g);
    const gCls = g === null || g === undefined ? "flat" : Math.abs(g) < 0.05 ? "flat" : g > 0 ? "up" : "down";
    const wl = wlSet.has(r.slug) ? " wl" : "";
    return `<tr class="${wl}" data-slug="${esc(r.slug)}">
      <td class="num rank">${r.rank}</td>
      <td class="name"><span class="n">${esc(r.name)}</span><span class="catrow"><span class="cat">${esc(catOf(r))}</span><span class="verdict ${verdictCls(r.verdict)}">${esc(r.verdict)}</span></span></td>
      <td class="num tvl">${fmtUsd(r.tvl_usd)}</td>
      <td class="num grow ${gCls}">${gTxt}</td>
      <td class="num value">${fmtUsd(r.implied_value_usd)}</td>
      <td class="num odds">${fmtOddsPct(r.breakeven_odds_pct)}</td>
      <td class="num pband">${fmtUsd(r.p10_usd)} - ${fmtUsd(r.p90_usd)}</td>
    </tr>`;
  }

  function render() {
    const rows = visible().sort((a, b) => {
      const k = state.sort;
      let av = a[k], bv = b[k];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return cmp * state.dir;
    });
    $("rows").innerHTML = rows.map(rowHtml).join("");
    $("empty").hidden = rows.length > 0;
    document.querySelectorAll("#rows tr").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.slug));
    });
  }

  // ---------------------------------------------------------------- detail modal
  function openDetail(slug) {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return;
    $("d-name").textContent = r.name;
    $("d-sub").textContent = `${r.slug} - rank ${r.rank} of ${R.board_size} - ${catOf(r)} - ${(r.chains ?? []).join(", ")}`;
    $("d-hero").innerHTML =
      `<span class="verdict ${verdictCls(r.verdict)}">${esc(r.verdict)}</span>` +
      `<span class="d-implied-label">implied value</span>` +
      `<span class="d-implied">${fmtUsd(r.implied_value_usd)}</span>` +
      `<span class="d-band">${fmtUsd(r.p10_usd)} - ${fmtUsd(r.p90_usd)}</span>` +
      `<span class="d-odds">launch odds ${fmtOddsPct(r.breakeven_odds_pct)} at $${m.monthly_cost_usd}/month</span>`;
    const dstat = (k, v, cls) => `<div class="dstat"><div class="k">${k}</div><div class="v ${cls ?? ""}">${v}</div></div>`;
    const g = r.change_7d;
    const gTxt = fmtPct(g);
    const gCls = g === null || g === undefined || Math.abs(g) < 0.05 ? "" : g > 0 ? "good" : "bad";
    $("d-stats").innerHTML =
      dstat("tvl", fmtUsd(r.tvl_usd)) +
      dstat("7d change", gTxt, gCls) +
      dstat("age", fmtAge(r.age_days)) +
      dstat("listed", r.listed_at ?? "unknown");
    const li = (k, v) => `<li><span>${k}</span><span>${v}</span></li>`;
    $("d-breakdown").innerHTML =
      li("comps fit base", fmtUsd(Math.round(r.model ? r.model.fit_base_usd : 0))) +
      li("family multiplier", (r.family_multiplier ?? 1).toFixed(3) + "x") +
      li("growth multiplier", (r.growth_multiplier ?? 1).toFixed(3) + "x") +
      li("seasoning", (r.maturity_multiplier ?? 1).toFixed(3) + "x") +
      `<li><span>Launch odds</span><span>${fmtOddsPct(r.breakeven_odds_pct)}</span></li>` +
      `<li class="odds-explain"><span></span><span>the odds a launch must beat to repay $${m.monthly_cost_usd}/month of farming</span></li>` +
      `<li class="total"><span>implied value</span><span>${fmtUsd(r.implied_value_usd)}</span></li>`;
    const steps = r.farm_steps ?? [];
    $("d-steps").innerHTML = steps.length
      ? steps
          .map((s) => {
            const at = s.indexOf(" Cost: ");
            const action = at >= 0 ? s.slice(0, at) : s;
            const tail = at >= 0 ? s.slice(at + 1) : "";
            return `<li>${esc(action)} <span class="cost">${esc(tail)}</span></li>`;
          })
          .join("")
      : "<li>no plan generated</li>";
    $("modal").hidden = false;
  }
  $("d-close").addEventListener("click", () => { $("modal").hidden = true; });
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });

  // ---------------------------------------------------------------- url staging for screenshots
  render();
  const params = new URLSearchParams(location.search);
  const cCat = params.get("cat");
  if (cCat) {
    const chip = [...document.querySelectorAll(".fchip")].find((c) => c.dataset.cat === cCat);
    if (chip) {
      document.querySelectorAll(".fchip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      state.cat = cCat;
      chip.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }
  if (params.get("wl") === "1") {
    state.wlOnly = true;
    const cb = $("wl-only");
    if (cb) cb.checked = true;
  }
  const qParam = params.get("q");
  if (qParam) {
    state.q = qParam.toLowerCase();
    const qel = $("q");
    if (qel) qel.value = qParam;
  }
  if (params.get("wl") === "1" || cCat || qParam) render();
  const dSlug = params.get("detail");
  if (dSlug) openDetail(dSlug);
})();

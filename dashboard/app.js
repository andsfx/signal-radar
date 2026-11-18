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
    return n.toFixed(3) + "%";
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

  const medianImplied = (() => {
    const a = R.rows.map((r) => r.implied_value_usd).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)] ?? 0;
  })();
  const watchlistOnBoard = R.rows.filter((r) => (R.watchlist ?? []).includes(r.slug)).length;
  const stats = [
    { k: "watchlist", v: String(watchlistOnBoard) + "/" + String(R.watchlist_size), s: "pre-token protocols, every one on the board" },
    { k: "board", v: String(R.board_size), s: R.early_size + " early finds below the floor" },
    { k: "anchors", v: String(R.fit.n), s: "traded protocols fit ln(mcap) on ln(tvl)" },
    { k: "median implied", v: fmtUsd(medianImplied), s: "across the ranked board" },
  ];
  $("stats").innerHTML = stats.map((s) => `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}</div><div class="s">${s.s}</div></div>`).join("");

  // ---------------------------------------------------------------- formula panel
  const m = R.model;
  const f = R.fit;
  const topCats = Object.entries(R.category_multipliers ?? {})
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, 5);
  const catsHtml = topCats.length
    ? `<div class="m">${topCats.map(([c, v]) => `<span>${esc(c)}<b>${v.toFixed(4)}x</b></span>`).join("")}</div>`
    : `<div class="e">no live anchors in the snapshot to price categories; every category scores 1x.</div>`;
  const fitLine = f.fallback
    ? `fallback (fewer than ${m.min_anchors} anchors): base = tvl_usd x ${m.family_floor}`
    : `value = exp(${f.a.toFixed(3)} + ${f.b.toFixed(3)} x ln TVL)`;
  $("formula-grid").innerHTML = [
    `<div class="fcard"><div class="t">1. comps fit</div><div class="f">${fitLine}</div><div class="e">OLS on ${f.n} traded anchors; residual sigma = ${f.sigma.toFixed(3)}.</div></div>`,
    `<div class="fcard"><div class="t">2. family</div><div class="f">median observed/fitted per category, clamped [${m.family_clamp_min}, ${m.family_clamp_max}], shrunk n/(n+${m.family_shrink_k})</div><div class="e">the live market's own price per fitted dollar, by category.</div>${catsHtml}</div>`,
    `<div class="fcard"><div class="t">3. growth</div><div class="f">1 + clamp(change7d, ${m.growth_floor}, ${m.growth_cap}) / 100 x ${m.growth_weight}</div><div class="e">a week of TVL growth is rewarded, a drawdown discounted.</div></div>`,
    `<div class="fcard"><div class="t">4. seasoning</div><div class="f">1 - ${m.seasoning_discount} x e^(-age / ${m.seasoning_decay_days})</div><div class="e">young protocols are discounted for a short track record; unknown age counts as ${m.unknown_age_days}d.</div></div>`,
    `<div class="fcard"><div class="t">5. verdict</div><div class="f">odds = $${m.monthly_cost_usd}/month / implied</div><div class="e">Farm below 1%, Marginal below 5%, Skip otherwise. p10/p90 from the fit's sigma.</div></div>`,
  ].join("");
  $("formula-note").textContent = `implied = max(1, round(comps x family x growth x seasoning)). One function scores every row, from the snapshot's own figures; no protocol name is ever special-cased.`;

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
    const chainLine = r.chains && r.chains.length ? esc(r.chains.slice(0, 2).join(", ")) : "no chain named";
    return `<tr class="${wl}" data-slug="${esc(r.slug)}">
      <td class="num rank">${r.rank}</td>
      <td class="name"><span class="n">${esc(r.name)}</span><span class="s">${esc(r.slug)} - ${chainLine}</span></td>
      <td><span class="cat">${esc(catOf(r))}</span></td>
      <td class="num tvl">${fmtUsd(r.tvl_usd)}</td>
      <td class="num grow ${gCls}">${gTxt}</td>
      <td class="num value">${fmtUsd(r.implied_value_usd)}</td>
      <td class="num odds">${fmtOddsPct(r.breakeven_odds_pct)}</td>
      <td class="num pband">${fmtUsd(r.p10_usd)} - ${fmtUsd(r.p90_usd)}</td>
      <td><span class="verdict ${verdictCls(r.verdict)}">${esc(r.verdict)}</span></td>
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
    $("d-verdict").innerHTML =
      `<span class="verdict ${verdictCls(r.verdict)}">${esc(r.verdict)}</span>` +
      `<span class="vline">breakeven odds ${fmtOddsPct(r.breakeven_odds_pct)} at $${m.monthly_cost_usd}/month</span>`;
    const dstat = (k, v, cls) => `<div class="dstat"><div class="k">${k}</div><div class="v ${cls ?? ""}">${v}</div></div>`;
    const g = r.change_7d;
    const gTxt = fmtPct(g);
    const gCls = g === null || g === undefined || Math.abs(g) < 0.05 ? "" : g > 0 ? "good" : "bad";
    $("d-stats").innerHTML =
      dstat("tvl", fmtUsd(r.tvl_usd)) +
      dstat("7d change", gTxt, gCls) +
      dstat("age", fmtAge(r.age_days)) +
      dstat("implied", fmtUsd(r.implied_value_usd), "hot") +
      dstat("p10", fmtUsd(r.p10_usd)) +
      dstat("p90", fmtUsd(r.p90_usd));
    const li = (k, v) => `<li><span>${k}</span><span>${v}</span></li>`;
    $("d-breakdown").innerHTML =
      li("comps fit base", fmtUsd(Math.round(r.model ? r.model.fit_base_usd : 0))) +
      li("family multiplier", (r.family_multiplier ?? 1).toFixed(3) + "x") +
      li("growth multiplier", (r.growth_multiplier ?? 1).toFixed(3) + "x") +
      li("seasoning", (r.maturity_multiplier ?? 1).toFixed(3) + "x") +
      li("breakeven odds", fmtOddsPct(r.breakeven_odds_pct)) +
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
      render();
      chip.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }
  const dSlug = params.get("detail");
  if (dSlug) openDetail(dSlug);
})();

// Signal Radar's value model, radar-3: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols the early radar admits: every protocol that records no token and clears the
// derivative-product filter, ranked by the model below. The snapshot's live-token protocols are
// never ranked; they anchor the category multipliers instead, because the market has already priced
// a token per TVL there.
//
// The score follows only from the snapshot's own figures, with five multipliers:
//
//   base      = tvl_usd x BASE_MULTIPLE
//   growth    = 1 + clamp(change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP) / 100 x GROWTH_WEIGHT
//   maturity  = MATURITY_FLOOR + min(max(age_days, 0), MATURITY_DAYS) / MATURITY_DAYS x MATURITY_RANGE
//   category  = the live market's median mcap/TVL for the protocol's category, divided by the
//               global median, clamped to [0.3, 3], then shrunk toward 1 by sample size: n/(n+8)
//   chains    = 1 + min(chains - 1, CHAIN_MAX) x CHAIN_BONUS
//   implied   = max(1, round(base x growth x maturity x category x chains))
//
// The category multipliers are computed from the snapshot itself, never from a hardcoded list of
// names, and the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, shown on the dashboard and changeable in the model sandbox. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_shrink_k: number;
  category_clamp_min: number;
  category_clamp_max: number;
  chain_bonus: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.7,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  category_shrink_k: 8,
  category_clamp_min: 0.3,
  category_clamp_max: 3,
  chain_bonus: 0.02,
  chain_max: 6,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the radar data carries for reference, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step before it is flattened: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's whole breakdown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: the same figures and the same farm steps the board carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: already trading, so it anchors the model instead of being ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_multipliers: Record<string, number>;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A median over a list of numbers, the lower middle element when the count is even. */
function median(list: number[]): number {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The category multipliers, computed from the snapshot's own live market. A live protocol is one
 * that records a token (mcap_usd) with a positive TVL and is not a CEX; its market-cap-to-TVL
 * ratio is what the market already pays for one dollar of TVL in that category. Each category's
 * median ratio, divided by the global median, is clamped to [0.3, 3] and then shrunk toward 1 by
 * the category's sample size: mult = 1 + (raw - 1) x n / (n + k). Categories the live market does
 * not name carry no entry and score at 1.
 */
export function categoryMultipliers(snapshot: Snapshot, model: ModelConstants = MODEL): Record<string, number> {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  if (live.length === 0) return {};
  const ratios = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'none';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const all: number[] = [];
  for (const list of ratios.values()) for (const r of list) all.push(r);
  const global = median(all);
  const out: Record<string, number> = {};
  for (const [key, list] of ratios) {
    const raw = global > 0 ? Math.min(model.category_clamp_max, Math.max(model.category_clamp_min, median(list) / global)) : 1;
    const n = list.length;
    out[key] = round4(1 + (raw - 1) * (n / (n + model.category_shrink_k)));
  }
  return out;
}

/** The five multipliers and the implied value one protocol gets under the model. */
export interface Score {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  catMult: number;
  chainMult: number;
  age: number | null;
}

/** One protocol's score, given the snapshot's date and the computed category multipliers. */
export function impliedValue(p: SnapshotProtocol, asOf: string, cats: Record<string, number>, model: ModelConstants = MODEL): Score {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const catMult = cats[p.category ?? 'none'] ?? 1;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, model.chain_max));
  const chainMult = 1 + extraChains * model.chain_bonus;
  const base = p.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * catMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, catMult, chainMult, age };
}

// ---------------------------------------------------------------- the early radar's filter

/** DefiLlama's version-marker shape: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Names that open with an exchange's brand: the exchange's own pool, not a launch to farm. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Whole-word markers of a wrapped, staked or bridged product of a token that already trades. */
const DERIVATIVE_WORD = /\b(wrapped|staked|staking|stake|restaked|restaking|collateral|canonical)\b/i;

/** Categories that are bridges or staking wrappers of existing tokens, or an exchange itself. */
const OFF_LIMITS = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a pre-token protocol is one the early radar admits: no derivative markers in name or category. */
export function isEarlyRadar(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !OFF_LIMITS.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !DERIVATIVE_WORD.test(p.name)
  );
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n: every watchlist slug (the floor,
 * whatever the filter says), then every pre-token protocol the early radar admits, by TVL.
 */
export function buildBoard(snapshot: Snapshot, cats: Record<string, number>, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyRadar(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, cats, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((row, i) => {
    const { p, s } = row;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_usd: round4(p.tvl_usd * model.base_multiple),
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        category_multiplier: round4(s.catMult),
        chain_multiplier: round4(s.chainMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(p, s.age, s.growthPct),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a young protocol gets a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The trend sentence the plan carries: the protocol's own seven-day TVL change. */
function trendLine(growthPct: number): string {
  if (growthPct > 0.05) return `TVL is up ${growthPct.toFixed(1)}% in 7 days`;
  if (growthPct < -0.05) return `TVL is down ${Math.abs(growthPct).toFixed(1)}% in 7 days`;
  return 'TVL is flat over the last 7 days';
}

/** The category's one action, in the words a farmer can follow, with the protocol's own numbers. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string, trend: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} and borrow a small share of it back; ${trend}.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${n}'s main pool on ${chain} and stay in range; ${trend}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the shares; ${trend}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield asset on ${chain} and hold it; ${trend}.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${n}; ${trend}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy; ${trend}.`;
  if (c.includes('perp') || c.includes('derivative') || c.includes('basis') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedge; ${trend}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}; ${trend}.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open; ${trend}.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (its category, first chain, TVL and age), never from a hand-written
 * list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, growthPct: number): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const trend = trendLine(growthPct);
  const steps: FarmStep[] = [
    {
      text: `Create a dedicated wallet for farming ${p.name} and store its seed phrase offline; never reuse a wallet that holds savings.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain, trend),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Keep the position alive with one qualifying action a week on ${chain}, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one tracking snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before closing anything, open the protocol's own points or rewards page and claim only from links it publishes.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction in a farm notebook so the position can be repeated or unwound cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map(stepText);
}

// ---------------------------------------------------------------- live anchors

/** The live-token protocols, by market cap, kept for reference next to the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** How many live-token protocols anchor the category multipliers. */
export function liveAnchorCount(snapshot: Snapshot): number {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX').length;
}

/** A board row's compact form for data.js, farm steps included so the page shows the board's own plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiplier: row.model.category_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const cats = categoryMultipliers(snapshot, model);
  const board = buildBoard(snapshot, cats, model);
  const live = liveRows(snapshot);
  const watchlistSet = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    category_multipliers: cats,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlistSet.has(r.slug)).length,
    live_size: liveAnchorCount(snapshot),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- parsing and gate checks

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// lib/winprob/predict.js - the two win-probability models, ported. PURE.
//
// THE ARTEFACTS ARE THE SPEC: lib/winprob/nfl.json and cfb.json, copied
// unchanged from sportsvyn-mock-app winprob-model @ f4d3b99. Every constant
// below is read from them; nothing is re-typed. The parity fixtures
// (fixtures/{nfl,cfb}-plays.json) hold 200 plays each and a correct port
// reproduces every expected_p_home to 1e-9 (lib/winprob/predict.test.mjs).
//
// THE SPREAD SIGN IS PER SPORT AND THERE IS NO SHARED DEFAULT.
//   NFL: POSITIVE spread = home favoured   (nflverse spread_line)
//   CFB: NEGATIVE spread = home favoured   (CFBD /lines)
// Our odds_markets consensus stores the home selection in betting convention
// (home -3 = home favoured by 3) in BOTH sports - measured on PROD 26 Sep:
// corr(home value, home win) -0.35 over 33 NFL games, -0.59 over 246 CFB.
// So NFL takes the NEGATED home value and CFB takes it as it is. The one
// function that does that is spreadForModel(sport, homeValue); it throws on
// any sport it was not told about, so a third league cannot inherit a sign.
//
// NO LINE, NO NUMBER. priorLogit(sport, null) is null and predict() returns
// null for a null prior. There is no Elo fallback, by the artefacts' own rule:
// the models were fitted on market priors, and another prior is a number
// neither gate tested.

import NFL from './nfl.json' with { type: 'json' };
import CFB from './cfb.json' with { type: 'json' };

export const MODELS = Object.freeze({ nfl: NFL, cfb: CFB });

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logistic = (x) => 1 / (1 + Math.exp(-x));

/**
 * THE BUCKET, AS THE FIXTURES DEFINE IT: the number of INTERIOR edges (all but
 * the first and last) that are <= v, clamped to [0, n-1] - numpy's digitize.
 *
 * NOT what the artefacts' prose says. Both call it "edges strictly below the
 * value"; read that way, the NFL parity fixture misses by up to 0.097. The
 * interior, <= reading reproduces all 200 plays to 6e-11 - the Python side's
 * own round-trip - so the fixture is the spec and the sentence is wrong.
 */
export function bucketOf(v, edges, n) {
  let k = 0;
  for (const e of edges.slice(1, -1)) if (e <= v) k += 1;
  return clamp(k, 0, n - 1);
}

/** Expected points of the possession state, BEFORE signing. */
export function epOf(model, down, distance, yardsToGoal) {
  const t = model.ep_table.table;
  const d = clamp(Math.trunc(Number(down)) - 1, 0, t.length - 1);
  const row = t[d];
  const di = bucketOf(Number(distance), model.ep_table.dist_edges, row.length);
  const yi = bucketOf(Number(yardsToGoal), model.ep_table.ytg_edges, row[di].length);
  return row[di][yi];
}

/** Our consensus home value -> the spread in this model's own sign. */
export function spreadForModel(sport, homeValue) {
  if (homeValue == null || !Number.isFinite(Number(homeValue))) return null;
  const v = Number(homeValue);
  if (sport === 'nfl') return -v;       // model: + = home favoured
  if (sport === 'cfb') return v;        // model: - = home favoured
  throw new Error(`winprob: no spread convention for sport '${sport}'`);
}

/** The model's spread -> the prior logit, per its own fitted prior. */
export function priorLogit(sport, spread) {
  const m = MODELS[sport];
  if (!m) throw new Error(`winprob: no model for sport '${sport}'`);
  if (spread == null || !Number.isFinite(Number(spread))) return null;
  const p = logistic(m.prior.coef * Number(spread) + m.prior.intercept);
  return Math.log(p / (1 - p));
}

function standardize(model, x) {
  const { mean, scale } = model.scaler;
  return x.map((v, i) => (v - mean[i]) / scale[i]);
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/**
 * NFL. state: { score_diff (home - away), secs_game (regulation seconds left,
 * 0 in OT), secs_half (seconds left in the half), posteam_is_home (0|1),
 * down_f (1-4), ydstogo_f, yards_to_goal, is_ot (0|1) }. prior: prior_logit.
 * @returns p_home in (0, 1), or null when the prior is null.
 */
export function predictNfl(state, prior) {
  if (prior == null || !Number.isFinite(Number(prior))) return null;
  const m = NFL;
  const sd = Number(state.score_diff);
  const g = clamp(Number(state.secs_game) / 3600, 0, 1);
  const t = Math.sqrt(g);
  const home = Number(state.posteam_is_home) ? 1 : 0;
  const ep = epOf(m, state.down_f, state.ydstogo_f, state.yards_to_goal) * (home ? 1 : -1);
  const f = {
    score_diff: sd,
    diff_t: sd / (t + 0.08),
    diff_x_t: sd * t,
    t,
    secs_half: Number(state.secs_half) / 1800,
    posteam_is_home: home,
    poss_t: home / (t + 0.08),
    ep_signed: ep,
    prior_decayed: Number(prior) * g,
    is_ot: Number(state.is_ot) ? 1 : 0,
  };
  const x = m.features.order.map((k) => f[k]);
  return logistic(dot(m.logistic.coef, standardize(m, x)) + m.logistic.intercept);
}

const CFB_BUCKETS = CFB.time_buckets.names;

/** The time bucket for secs_game, by the same digitize rule. */
export function cfbTimeBucket(secsGame) {
  return bucketOf(Number(secsGame), CFB.time_buckets.edges, CFB_BUCKETS.length);
}

/** The three score-spline columns, sd clipped to [-40, 40]. All 0 when level. */
export function cfbSpline(scoreDiff) {
  const sd = clamp(Number(scoreDiff), -40, 40);
  const [lo, hi] = CFB.score_spline.knots;
  return [sd / 10, Math.min(0, sd - lo) / 10, Math.max(0, sd - hi) / 10];
}

/**
 * CFB. state: as NFL, plus `season` (selects the era dummy). SHADOW: this is
 * computed and logged, never displayed (GATE-cfb.md).
 */
export function predictCfb(state, prior) {
  if (prior == null || !Number.isFinite(Number(prior))) return null;
  const m = CFB;
  const g = clamp(Number(state.secs_game) / 3600, 0, 1);
  const t = Math.sqrt(g);
  const home = Number(state.posteam_is_home) ? 1 : 0;
  const b = cfbTimeBucket(state.secs_game);
  const spline = cfbSpline(state.score_diff);
  const season = Number(state.season);
  const f = {
    t,
    secs_half: Number(state.secs_half) / 1800,
    posteam_is_home: home,
    poss_t: home / (t + 0.08),
    ep_signed: epOf(m, state.down_f, state.ydstogo_f, state.yards_to_goal) * (home ? 1 : -1),
    is_ot: Number(state.is_ot) ? 1 : 0,
    home_edge_pre2020: season < 2020 ? 1 : 0,
    home_edge_2020plus: season >= 2020 ? 1 : 0,
  };
  CFB_BUCKETS.forEach((name, i) => {
    for (let c = 0; c < 3; c++) f[`sd_x_${name}_${c}`] = i === b ? spline[c] : 0;
    f[`prior_x_${name}`] = i === b ? Number(prior) : 0;
  });
  const x = m.features.order.map((k) => {
    if (!(k in f)) throw new Error(`winprob cfb: no feature '${k}'`);
    return f[k];
  });
  const z = standardize(m, x);
  const intercept = m.logistic.fit_intercept === false ? 0 : (m.logistic.intercept ?? 0);
  return logistic(dot(m.logistic.coef, z) + intercept);
}

/** One entry point: sport -> model. Unknown sport throws. */
export function predict(sport, state, prior) {
  if (sport === 'nfl') return predictNfl(state, prior);
  if (sport === 'cfb') return predictCfb(state, prior);
  throw new Error(`winprob: no model for sport '${sport}'`);
}

export const MODEL_VERSION = Object.freeze({ nfl: `${NFL.model}@${NFL.version}`, cfb: `${CFB.model}@${CFB.version}` });

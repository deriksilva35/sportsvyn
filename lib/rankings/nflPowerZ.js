// lib/rankings/nflPowerZ.js - the NFL power ranking Derik chose (27 Sep 2026).
// PURE. Current season only, regular-season finals only, no carryover.
//
//   power = ( 25 z(adjPF) + 12 z(adjPA) + 55 z(win%) + 8 z(QoR) ) / 100
//
// A PORT, NOT A RE-DERIVATION: the Mac's model/powerrank/src/features7.py and
// rank7.py (sportsvyn-mock-app, power-z @ 13951e1), line for line where it
// matters, and held to its week-2 artefact exactly by
// lib/rankings/nflPowerZ.test.mjs. Its rules, as that code has them:
//
//   EXCLUSION   every opponent quantity is computed with the subject team's own
//               games removed - a team never helps rate itself.
//   adjPF       mean over games of (points for - that opponent's mean points
//               allowed, excluding this team).
//   adjPA       mean over games of (points against - that opponent's mean
//               points scored, excluding this team). STORED RAW (lower is
//               better) and NEGATED before standardising; the table's "PA adj"
//               column shows the negated value.
//   win%        over ALL games, ties a half.
//   QoR         mean over games of result - (1 - opponent win%, excluding this
//               team). Beat a .800 team +0.8; lose to one -0.2; lose to a .200
//               team -0.8.
//   SKIP        a game whose opponent has no OTHER games is skipped for adjPF,
//               adjPA, QoR and oppWin (not scored 0); win% still counts it. All
//               skipped: adjPF, adjPA, QoR fall back to 0, oppWin to 0.5.
//   z           population SD across the teams (numpy std, ddof 0); an SD under
//               1e-9 is taken as 1.
//   ORDER       by power, descending; ties keep the Mac's input order, which is
//               alphabetical by nflverse code (LA, WAS - not our LAR, WSH).
//
// The Mac also carries qorC (a Bradley-Terry expectation) and oppWin at weight
// 0; qorC is not computed here - at weight 0 it cannot move the power.

export const WEIGHTS = Object.freeze({ adjPF: 25, adjPA: 12, win: 55, qorB: 8 });

// THE READER'S NAMES FOR THE FOUR KEYS. A board prints an edition's STORED
// weights (ranking_editions.notes.weights) against these names, so a changed
// weight shows up on the page the week it is published, and a key the model
// grows without a name here prints as its key rather than vanishing.
export const COMPONENT_LABELS = Object.freeze({
  adjPF: 'Adj points for', adjPA: 'Adj points against', win: 'Win %', qorB: 'Quality of record',
});

// THE SCOPE IS A PROPERTY OF THE MODEL, stated where the model is: this ranking
// reads this season's finals and nothing else (loadSeasonFinals), so the board's
// edition line says so from here rather than from a sentence typed on the page.
export const SEASON_SCOPE = 'current season only';
export const METHODOLOGY_VERSION = 'z-1';

const NFLVERSE = Object.freeze({ LAR: 'LA', WSH: 'WAS' });
export const nflverseCode = (abbr) => NFLVERSE[abbr] ?? abbr;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const result = (pf, pa) => (pf > pa ? 1 : pf < pa ? 0 : 0.5);

/** games: [{ home, away, home_score, away_score }] - finals only. */
function perTeam(games) {
  const by = new Map();
  for (const g of games) {
    const h = Number(g.home_score); const a = Number(g.away_score);
    if (!by.has(g.home)) by.set(g.home, []);
    if (!by.has(g.away)) by.set(g.away, []);
    by.get(g.home).push({ opp: g.away, pf: h, pa: a });
    by.get(g.away).push({ opp: g.home, pf: a, pa: h });
  }
  return by;
}

/** An opponent's pf/pa/win means over its games NOT against `exclude`, or null (features7._rate). */
function rateExcluding(by, team, exclude) {
  const g = (by.get(team) ?? []).filter((x) => x.opp !== exclude);
  if (!g.length) return null;
  return { pf: mean(g.map((x) => x.pf)), pa: mean(g.map((x) => x.pa)), win: mean(g.map((x) => result(x.pf, x.pa))) };
}

/** PURE. Per team: record, components (adjPA RAW), games skipped for the opponent baseline. */
export function components(games) {
  const by = perTeam(games);
  const out = {};
  for (const [t, G] of by) {
    const adjPF = []; const adjPA = []; const ow = []; const qor = []; let skipped = 0;
    for (const x of G) {
      const o = rateExcluding(by, x.opp, t);
      if (!o) { skipped += 1; continue; }
      adjPF.push(x.pf - o.pa);
      adjPA.push(x.pa - o.pf);
      ow.push(o.win);
      qor.push(result(x.pf, x.pa) - (1 - o.win));
    }
    const w = G.filter((x) => x.pf > x.pa).length; const l = G.filter((x) => x.pf < x.pa).length; const ti = G.length - w - l;
    out[t] = {
      record: { w, l, t: ti, text: `${w}-${l}${ti ? `-${ti}` : ''}` },
      games: G.length, skipped,
      adjPF: adjPF.length ? mean(adjPF) : 0,
      adjPA: adjPA.length ? mean(adjPA) : 0,
      win: mean(G.map((x) => result(x.pf, x.pa))),
      qorB: qor.length ? mean(qor) : 0,
      oppWin: ow.length ? mean(ow) : 0.5,
    };
  }
  return out;
}

/** PURE. The ranked table: rank, team, record, components, z, power. */
export function rankPowerZ(games, { weights = WEIGHTS } = {}) {
  const comp = components(games);
  const teams = Object.keys(comp).sort((a, b) => (nflverseCode(a) < nflverseCode(b) ? -1 : nflverseCode(a) > nflverseCode(b) ? 1 : 0));
  // the sign-corrected vector: adjPA negated, so higher is better everywhere
  const raw = { adjPF: (t) => comp[t].adjPF, adjPA: (t) => -comp[t].adjPA, win: (t) => comp[t].win, qorB: (t) => comp[t].qorB };
  const z = {};
  for (const k of Object.keys(weights)) {
    const v = teams.map(raw[k]); const m = mean(v);
    let sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
    if (sd < 1e-9) sd = 1;
    z[k] = new Map(teams.map((t, i) => [t, (v[i] - m) / sd]));
  }
  const rows = teams.map((t) => {
    const zt = Object.fromEntries(Object.keys(weights).map((k) => [k, z[k].get(t)]));
    const power = Object.keys(weights).reduce((s, k) => s + zt[k] * weights[k], 0) / 100;
    return { team: t, record: comp[t].record, games: comp[t].games, skipped: comp[t].skipped,
      components: { adjPF: comp[t].adjPF, adjPA: comp[t].adjPA, win: comp[t].win, qorB: comp[t].qorB, oppWin: comp[t].oppWin },
      z: zt, power };
  });
  // STABLE sort by power, descending: ties keep the alphabetical nflverse order (rank7.py)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (b.r.power - a.r.power) || (a.i - b.i)).map(({ r }, k) => ({ rank: k + 1, ...r }));
}

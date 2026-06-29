// lib/rankings/deadRubbers.js — derive BOTH-SECURED dead-rubber match ids.
//
// A "dead rubber" for stakes weighting is a group match where, at kickoff,
// BOTH teams had already SECURED a top-2 (automatic knockout) place — so the
// result could not change either side's advancement. We restrict to
// both-secured ONLY (not "eliminated" teams): a side that could still reach
// the knockouts via a best-third place still had stakes, and best-third status
// can't be cleanly derived intra-group, so those matches stay full-stakes.
//
// Derivation is structural and pure (no writes):
//   1. Group the league's final group matches by group_code.
//   2. Matchday = kickoff order within the group (6 matches -> MD1/MD2/MD3).
//   3. Standings after MD1+MD2 (points, GD, GF) from actual results.
//   4. For each MD3 match, simulate all 9 combinations of the group's two MD3
//      results (W/D/L x W/D/L, nominal 1-0 / 0-0 margins for GD) and rank by
//      (points, GD, GF). A team is SECURED if it finishes top-2 in ALL 9
//      combinations. A match is a dead rubber iff BOTH its teams are SECURED.
//
// General + idempotent: works each matchday as results land (a group with an
// incomplete MD3 simply yields no dead rubbers for those matches yet).

const RESULTS = [
  [3, 0, 'H'], // home win (nominal 1-0)
  [1, 1, 'D'], // draw      (nominal 0-0)
  [0, 3, 'A'], // away win  (nominal 0-1)
];

export async function getDeadRubberMatchIds({ sql, leagueSlug }) {
  const gm = await sql`
    SELECT m.id, m.group_code AS gc,
           m.home_team_id AS h, m.away_team_id AS a,
           m.home_score AS hs, m.away_score AS as_, m.kickoff_at AS ko
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug}
       AND m.stage = 'group'
       AND m.status = 'final'
       AND m.group_code IS NOT NULL
       AND m.home_score IS NOT NULL
       AND m.away_score IS NOT NULL
  `;

  const groups = new Map();
  for (const m of gm) {
    if (!groups.has(m.gc)) groups.set(m.gc, []);
    groups.get(m.gc).push(m);
  }

  const deadIds = [];
  for (const [, all] of groups) {
    if (all.length < 6) continue; // group not complete -> no MD3 dead rubbers yet
    const ms = all.slice().sort((x, y) => new Date(x.ko) - new Date(y.ko));
    const md = { 1: ms.slice(0, 2), 2: ms.slice(2, 4), 3: ms.slice(4, 6) };

    // standings after MD1+MD2 (actual results)
    const base = new Map();
    const team = (id) => {
      if (!base.has(id)) base.set(id, { id, p: 0, gf: 0, ga: 0 });
      return base.get(id);
    };
    for (const d of [1, 2]) for (const m of md[d]) {
      const H = team(m.h), A = team(m.a);
      H.gf += m.hs; H.ga += m.as_; A.gf += m.as_; A.ga += m.hs;
      if (m.hs > m.as_) H.p += 3; else if (m.hs < m.as_) A.p += 3; else { H.p += 1; A.p += 1; }
    }

    // simulate all 9 combinations of the two MD3 matches; count top-2 finishes
    const top2Count = new Map([...base.keys()].map((id) => [id, 0]));
    let combos = 0;
    for (const r1 of RESULTS) for (const r2 of RESULTS) {
      combos++;
      const sim = new Map([...base.values()].map((t) => [t.id, { ...t }]));
      const apply = (m, r) => {
        const H = sim.get(m.h), A = sim.get(m.a);
        H.p += r[0]; A.p += r[1];
        if (r[2] === 'H') { H.gf += 1; A.ga += 1; }
        else if (r[2] === 'A') { A.gf += 1; H.ga += 1; }
      };
      apply(md[3][0], r1); apply(md[3][1], r2);
      const ranked = [...sim.values()].sort(
        (x, y) => y.p - x.p || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf,
      );
      top2Count.set(ranked[0].id, top2Count.get(ranked[0].id) + 1);
      top2Count.set(ranked[1].id, top2Count.get(ranked[1].id) + 1);
    }
    const secured = (id) => top2Count.get(id) === combos; // top-2 in EVERY combo

    for (const m of md[3]) {
      if (secured(m.h) && secured(m.a)) deadIds.push(m.id);
    }
  }

  return deadIds;
}

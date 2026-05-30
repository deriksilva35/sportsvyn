// lib/wcGroups.js — fetch 2026 World Cup group assignments from API-Sports.
//
// /standings?league=1&season=2026 returns `response[0].league.standings` as
// an array of arrays: one inner array per group. For the 2026 WC the
// provider returns 13 inner arrays — 12 real groups (labelled "Group A" …
// "Group L", 4 teams each) plus a 13th meta-aggregate labelled
// "Ranking of third-placed teams" (12 teams seeded for the new 48-team
// format's R32). We filter to ^Group [A-L]$ and ignore everything else.
//
// fetchWcGroups() returns { groups, map }:
//   groups: [{ letter: 'A', teams: [{ apiId: '27', name: 'Mexico' }, ...] }, ...]
//   map:    Map<api_sports_team_id (string), 'A'..'L'>
//
// assertWcGroupsIntegrity({ groups, map }) returns an issues[] (empty when
// sane). Callers should refuse to write to the DB if issues.length > 0.

const WC_LEAGUE_API_ID = 1;
const SEASON = 2026;
const GROUP_LABEL_RE = /^Group ([A-L])$/;

export async function fetchWcGroups() {
  const KEY = process.env.API_SPORTS_KEY;
  if (!KEY) throw new Error('API_SPORTS_KEY missing from env');

  const res = await fetch(
    `https://v3.football.api-sports.io/standings?league=${WC_LEAGUE_API_ID}&season=${SEASON}`,
    { headers: { 'x-apisports-key': KEY } },
  );
  const json = await res.json();
  const errs = json.errors;
  if (Array.isArray(errs) ? errs.length : errs && Object.keys(errs).length) {
    throw new Error(`API-Sports /standings error: ${JSON.stringify(errs)}`);
  }

  const raw = json.response?.[0]?.league?.standings ?? [];
  const groups = [];
  const map = new Map();
  const duplicates = []; // collected here, surfaced through assertWcGroupsIntegrity

  for (const groupArr of raw) {
    const label = groupArr[0]?.group;
    const m = GROUP_LABEL_RE.exec(label ?? '');
    if (!m) continue;
    const letter = m[1];
    const teams = groupArr.map((row) => ({
      apiId: String(row.team.id),
      name: row.team.name,
    }));
    groups.push({ letter, teams });
    for (const t of teams) {
      if (map.has(t.apiId)) {
        duplicates.push({ apiId: t.apiId, name: t.name, groups: [map.get(t.apiId), letter] });
      } else {
        map.set(t.apiId, letter);
      }
    }
  }

  groups.sort((a, b) => a.letter.localeCompare(b.letter));
  return { groups, map, duplicates };
}

export function assertWcGroupsIntegrity({ groups, map, duplicates }) {
  const issues = [];
  if (groups.length !== 12) issues.push(`expected 12 groups, got ${groups.length}`);
  for (const g of groups) {
    if (g.teams.length !== 4) issues.push(`Group ${g.letter} has ${g.teams.length} teams (expected 4)`);
  }
  const totalTeams = groups.reduce((a, g) => a + g.teams.length, 0);
  if (totalTeams !== 48) issues.push(`expected 48 teams across all groups, got ${totalTeams}`);
  if (map.size !== 48) issues.push(`map size ${map.size} (expected 48 unique team api_ids)`);
  for (const d of duplicates ?? []) {
    issues.push(`team "${d.name}" (api_id ${d.apiId}) appears in groups: ${d.groups.join(' AND ')}`);
  }
  const distinctLetters = new Set([...map.values()].filter((v) => /^[A-L]$/.test(v)));
  if (distinctLetters.size !== 12) {
    issues.push(`expected 12 distinct group letters, got ${distinctLetters.size}: [${[...distinctLetters].sort().join(',')}]`);
  }
  return issues;
}

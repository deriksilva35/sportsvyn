// lib/fantasy/dstName.test.mjs - a defense is named from its club, never from
// the provider's name field.
//
// 2 Sep 2026: the Fantrax pool's 32 defenses rendered "Team", "Team Offense",
// "Defense/Special Teams" and "Team Defense" as display names in the pick
// list, while each row's own sub-line knew DST·HOU. The provider field is not
// a name for a defense; the club is. This file pins the one derivation, that
// the provider field cannot reach a room for a DEF row, that a player's name
// is still the provider's verbatim, and that the matcher that joins a DEF row
// to its stats keys its write on the team (the same relay found it did not).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DST_SUFFIX, isTeamDefense, dstDisplayName, displayName, isDstName, dstNickname, dstShortName,
} from './dstName.js';
import { boardName } from './board.js';
import { viewFor } from './statView.js';
import { matchPoolIdentities, TEAM_ABBR_ALIAS, dstNameDialect, isDefPosition } from '../gridiron/nameMatch.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The 32 NFL rows of the teams table (abbreviation -> name), as on DEV and
// PROD on 2 Sep 2026. The table's codes are BDL's (WSH, JAX).
const CLUBS = new Map(Object.entries({
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WSH: 'Washington Commanders',
}));
// The pool's 32 codes: FFC/Fantrax spell Washington WAS.
const POOL_TEAMS = [...CLUBS.keys()].map((k) => (k === 'WSH' ? 'WAS' : k));

// The four strings the Fantrax feed put in its team rows' name field.
const JUNK = ['Team', 'Team Offense', 'Team Defense', 'Defense/Special Teams'];

test('all 32 defenses derive "<club name> D/ST" from the team, WAS via the alias', () => {
  assert.equal(CLUBS.size, 32);
  assert.equal(POOL_TEAMS.length, 32);
  const names = POOL_TEAMS.map((t) => dstDisplayName(t, CLUBS));
  assert.equal(new Set(names).size, 32, '32 distinct club names');
  for (const n of names) assert.match(n, /^[A-Z][A-Za-z0-9 .]+ D\/ST$/, n);
  assert.equal(dstDisplayName('HOU', CLUBS), 'Houston Texans D/ST');
  assert.equal(dstDisplayName('WAS', CLUBS), 'Washington Commanders D/ST');
  assert.equal(dstDisplayName('WSH', CLUBS), 'Washington Commanders D/ST');
  assert.equal(dstDisplayName('JAC', CLUBS), 'Jacksonville Jaguars D/ST');
  assert.equal(dstDisplayName('SF', CLUBS), 'San Francisco 49ers D/ST');
  assert.equal(dstDisplayName('hou', CLUBS), 'Houston Texans D/ST', 'case-insensitive on the code');
  assert.equal(DST_SUFFIX, 'D/ST');
  // The alias table is the matcher's own - one club for the name and the stats.
  assert.deepEqual(TEAM_ABBR_ALIAS, { WAS: 'WSH', JAC: 'JAX' });
});

test('a provider name of "Team Offense" is UNREACHABLE for a DEF row - the club is the name', () => {
  for (const junk of JUNK) {
    for (const team of POOL_TEAMS) {
      const out = displayName({ name: junk, position: 'DEF', team }, CLUBS);
      assert.ok(!out.includes(junk), `${team}: "${out}" carries the provider field`);
      assert.ok(out.endsWith(` ${DST_SUFFIX}`), out);
    }
  }
  assert.equal(displayName({ name: 'Team Offense', position: 'DEF', team: 'HOU' }, CLUBS), 'Houston Texans D/ST');
  assert.equal(displayName({ name: 'Seattle Defense', position: 'DEF', team: 'SEA' }, CLUBS), 'Seattle Seahawks D/ST', 'FFC grammar is replaced too');
  // Roster vocabulary spells it DST; still a defense.
  assert.equal(displayName({ name: 'Team', position: 'DST', team: 'DEN' }, CLUBS), 'Denver Broncos D/ST');
  assert.ok(isTeamDefense('DEF') && isTeamDefense('DST') && !isTeamDefense('WR'));
  // No clubs / unknown code: still never the provider field.
  assert.equal(displayName({ name: 'Team', position: 'DEF', team: 'HOU' }, null), 'HOU D/ST');
  assert.equal(displayName({ name: 'Team', position: 'DEF', team: 'XXX' }, CLUBS), 'XXX D/ST');
  assert.equal(displayName({ name: 'Team', position: 'DEF', team: null }, CLUBS), '? D/ST');
});

test('a player keeps the provider name verbatim', () => {
  for (const [name, position, team] of [
    ['CeeDee Lamb', 'WR', 'DAL'], ["Ja'Marr Chase", 'WR', 'CIN'], ['Amon-Ra St. Brown', 'WR', 'DET'],
    ['Marvin Harrison Jr.', 'WR', 'ARI'], ['Brandon Aubrey', 'PK', 'DAL'], ['Jahmyr Gibbs', 'RB', 'DET'],
  ]) {
    assert.equal(displayName({ name, position, team }, CLUBS), name);
  }
  assert.equal(displayName({ name: 'Team', position: 'WR', team: 'HOU' }, CLUBS), 'Team', 'the rule keys on position, not the string');
});

test('the flow-core hands every name to a room through displayName(): pool row, keeper, persisted pick, undo', () => {
  const core = stripComments(src('lib/fantasy/drafts.js'));
  assert.match(core, /import \{ displayName \} from '\.\/dstName\.js';/);
  // The old raw sites are gone.
  assert.doesNotMatch(core, /name: r\.name,/, 'mapPoolRow no longer copies the provider field');
  assert.doesNotMatch(core, /playerName: row\.player_name/, 'a persisted pick is not rendered raw');
  assert.doesNotMatch(core, /playerName: last\.player_name/, 'an undone pick is not rendered raw');
  assert.doesNotMatch(core, /playerName: r\.playerName,/, 'a keeper is not rendered raw');
  // The four DTO sites, each through the one derivation with the row's position + team.
  assert.match(core, /function mapPoolRow\(r, clubs\) \{\n  return \{\n    ffcPlayerId: r\.ffc_player_id, name: displayName\(r, clubs\), position: r\.position, team: r\.team,/);
  assert.match(core, /const clubs = await nflClubs\(\);\n  return rows\.map\(\(r\) => mapPoolRow\(r, clubs\)\);/);
  assert.match(core, /playerName: displayName\(\{ name: r\.playerName, position: r\.position, team: r\.team \}, clubs\)/);
  assert.match(core, /playerName: displayName\(\{ name: row\.player_name, position: row\.position, team: pl\?\.team \?\? null \}, clubs\)/);
  assert.match(core, /playerName: displayName\(\{ name: last\.player_name, position: last\.position, team: last\.team \}, clubs\)/);
  assert.equal((core.match(/displayName\(/g) ?? []).length, 4, 'four DTO sites, no fifth path');
  // Every read of the persisted name column in the flow-core is one of those.
  const reads = core.match(/\b(row|last)\.player_name\b/g) ?? [];
  assert.equal(reads.length, 2, `persisted name reads: ${reads.join(', ')}`);
  // The undo query carries the pick's team from the draft's own frozen pool.
  assert.match(core, /LEFT JOIN sim_player_pool sp\n\s+ON sp\.ffc_player_id = p\.ffc_player_id\n\s+AND sp\.source = \$\{draft\.pool_source \?\? 'ffc'\}\n\s+AND sp\.snapshot_date = \$\{draft\.pool_snapshot_date\}/);
  // The clubs load once per process and retry after a failure.
  assert.match(core, /clubsPromise \?\?= sql`SELECT t\.abbreviation, t\.name FROM teams t\n\s+JOIN leagues l ON l\.id = t\.league_id WHERE l\.slug = 'nfl'`/);
  assert.match(core, /\.catch\(\(e\) => \{ clubsPromise = null; throw e; \}\)/);
  // No component derives a defense's name for itself: the D/ST literal lives in dstName.js alone.
  for (const rel of ['components/sim/DraftRoom.js', 'components/sim/TrackerRoom.js', 'components/sim/DraftResults.js',
    'components/sim/TrackerResults.js', 'lib/fantasy/drafts.js', 'lib/fantasy/board.js', 'lib/fantasy/engine.js']) {
    assert.ok(!stripComments(src(rel)).includes("'D/ST'"), `${rel}: no private D/ST grammar`);
  }
});

test('short forms follow the grammar: the board cell shows the nickname, the tracker ledger "Texans D/ST"', () => {
  assert.equal(boardName('Houston Texans D/ST', 14), 'Texans');
  assert.equal(boardName('Washington Commanders D/ST', 14), 'Commanders');
  assert.equal(boardName('San Francisco 49ers D/ST', 14), '49ers');
  assert.equal(boardName('Amon-Ra St. Brown', 14), 'Brown', 'a person is still the last name');
  assert.equal(boardName('Christian McCaffrey'), 'McCaffre', 'the default cap is untouched');
  assert.equal(dstShortName('Houston Texans D/ST'), 'Texans D/ST');
  assert.equal(dstShortName('CeeDee Lamb'), null);
  assert.equal(dstNickname('Team Offense'), null, 'the provider field is not the grammar');
  assert.ok(isDstName('Houston Texans D/ST') && !isDstName('Seattle Defense'));
  for (const t of POOL_TEAMS) {
    const full = dstDisplayName(t, CLUBS);
    const nick = dstNickname(full);
    assert.ok(nick && !nick.includes('/') && nick.length <= 10, `${full} -> ${nick}`);
  }
  const tracker = stripComments(src('components/sim/TrackerRoom.js'));
  assert.match(tracker, /import \{ dstShortName \} from '@\/lib\/fantasy\/dstName';/);
  assert.match(tracker, /const shortName = \(full\) => \{\n  const dst = dstShortName\(full\);\n  if \(dst\) return dst;/);
});

// A fake tagged-template sql that answers the matcher's four reads with the
// given identities and records its writes.
function fakeSql(identities, updates) {
  return async (strings, ...vals) => {
    const q = strings.join('?');
    if (q.includes('WHERE is_team_defense = false')) return [{ id: 7, normalized_name: 'travis kelce', position: 'TE' }];
    if (q.includes('WHERE np.is_team_defense = true')) {
      return [{ id: 101, abbreviation: 'HOU', club: 'Houston Texans' }, { id: 102, abbreviation: 'DEN', club: 'Denver Broncos' },
        { id: 103, abbreviation: 'WSH', club: 'Washington Commanders' }, { id: 104, abbreviation: 'LAR', club: 'Los Angeles Rams' }];
    }
    if (q.includes('SELECT DISTINCT name, position, team')) return identities;
    if (q.startsWith('UPDATE sim_player_pool')) { updates.push({ q, vals }); return []; }
    if (q.includes('count(*)')) return [{ n: updates.length }];
    throw new Error(`unexpected query: ${q}`);
  };
}

test('the matcher writes a DEF identity to ITS team: two "Team" rows land on two DST ids', async () => {
  const updates = [];
  const r = await matchPoolIdentities(fakeSql([
    { name: 'Team', position: 'DEF', team: 'DEN' },
    { name: 'Team', position: 'DEF', team: 'HOU' },
    { name: 'Team Offense', position: 'DEF', team: 'WAS' },
  ], updates));
  assert.equal(r.counts.matched, 3);
  assert.equal(updates.length, 3);
  for (const u of updates) {
    assert.match(u.q, /WHERE name = \? AND position = \?\n\s+AND team IS NOT DISTINCT FROM \?/, 'the write keys on the whole identity');
  }
  // (targetId, name, position, team) per write: the team decides the id.
  assert.deepEqual(updates.map((u) => [u.vals[0], u.vals[3]]), [[102, 'DEN'], [101, 'HOU'], [103, 'WAS']]);
  // 2 SEP 2026 RECORDED: keyed on name + position alone, the second "Team"
  // write would have covered the first's rows - the assertion below is what
  // that defect failed.
  assert.notEqual(updates[0].vals[0], updates[1].vals[0]);
  const nm = stripComments(src('lib/gridiron/nameMatch.js'));
  assert.match(nm, /export const TEAM_ABBR_ALIAS = \{ WAS: 'WSH', JAC: 'JAX' \};/);
  assert.equal((nm.match(/UPDATE sim_player_pool SET matched_player_id/g) ?? []).length, 1, 'one write path');
});

test('DST name matching (ruling 2 Sep): both dialects, case-insensitive, DEF rows only', async () => {
  // The dialect reader.
  assert.equal(dstNameDialect('Houston Texans D/ST'), 'derived');
  assert.equal(dstNameDialect('houston texans d/st'), 'derived');
  assert.equal(dstNameDialect('Team Offense'), 'provider');
  assert.equal(dstNameDialect('TEAM'), 'provider');
  assert.equal(dstNameDialect('Defense/Special Teams'), 'provider');
  assert.equal(dstNameDialect('Team Defense'), 'provider');
  assert.equal(dstNameDialect('LA Rams Defense'), 'provider', 'the FFC grammar');
  assert.equal(dstNameDialect('Texans'), null);
  assert.equal(dstNameDialect('Travis Kelce'), null);
  assert.equal(dstNameDialect(''), null);
  assert.ok(isDefPosition('DEF') && isDefPosition('DST') && isDefPosition('def') && !isDefPosition('TE'));

  // Both dialects, mixed case, resolve to the same club - by the team code.
  const updates = [];
  const r = await matchPoolIdentities(fakeSql([
    { name: 'Houston Texans D/ST', position: 'DEF', team: 'HOU' },
    { name: 'HOUSTON TEXANS d/st', position: 'DST', team: 'hou' },
    { name: 'Team Offense', position: 'DEF', team: 'HOU' },
    { name: 'Houston Defense', position: 'DEF', team: 'HOU' },
    { name: 'Washington Commanders D/ST', position: 'DEF', team: 'WAS' },
    { name: 'Travis Kelce', position: 'TE', team: 'KC' },
  ], updates));
  assert.equal(r.counts.unmatched, 0, JSON.stringify(r.unmatched));
  assert.deepEqual(updates.map((u) => u.vals[0]), [101, 101, 101, 101, 103, 7]);
  // The player went through the name+position index, not the DST branch.
  assert.deepEqual(r.matched.at(-1), { name: 'Travis Kelce', position: 'TE', team: 'KC', matched_player_id: 7 });
});

test('DST name matching: a miss still fails loudly - reported with its reason, logged, nothing written', async () => {
  const updates = []; const logs = [];
  const r = await matchPoolIdentities(fakeSql([
    { name: 'Texans', position: 'DEF', team: 'HOU' },                 // neither dialect
    { name: 'Denver Broncos D/ST', position: 'DEF', team: 'HOU' },    // name and code disagree
    { name: 'Team', position: 'DEF', team: 'XXX' },                    // no such club
    { name: 'Team', position: 'TE', team: 'HOU' },                     // DEF rule is for DEF rows only
  ], updates), { log: (m) => logs.push(m) });
  assert.equal(updates.length, 0, 'no write on a miss');
  assert.equal(r.counts.matched, 0);
  assert.equal(r.counts.unmatched, 4);
  assert.deepEqual(r.unmatched.map((u) => u.reason), [
    'DST name "Texans" is neither "<Club> D/ST" nor a provider string',
    'name says "Denver Broncos D/ST", team code says Houston Texans',
    "no DST identity for team 'XXX'",
    'no normalized name+position match',
  ]);
  const defMisses = logs.filter((m) => m.startsWith('match: DEF miss '));
  assert.equal(defMisses.length, 3, defMisses.join('\n'));
  assert.match(defMisses[0], /^match: DEF miss HOU "Texans": DST name/);
  assert.match(logs.at(-1), /^match: 0\/4 identities \(4 unmatched, 0 ambiguous\)/);
});

test('the DEF quick line names its number; both rooms render line 2 as whole-fact tokens', () => {
  const q = viewFor('DEF').quick({ sacks: 42, defInt: 12 });
  assert.deepEqual(q, ['42 SACKS', '12 INT']);
  assert.ok(q.every((s) => /^\d[\d,]* [A-Z]+$/.test(s)), 'every token is number + label');
  const room = stripComments(src('components/sim/DraftRoom.js'));
  const tracker = stripComments(src('components/sim/TrackerRoom.js'));
  assert.match(room, /\{quick && quick\.map\(\(q\) => <span className="q" key=\{q\}>· \{q\}<\/span>\)\}/);
  assert.match(tracker, /\{quick && quick\.map\(\(q\) => <span className="trk-quick" key=\{q\}>· \{q\}<\/span>\)\}/);
  assert.doesNotMatch(room, /quick\.join/, 'no joined string on the Mock row');
  assert.doesNotMatch(tracker, /quick\.join/, 'no joined string on the Tracker row');
});

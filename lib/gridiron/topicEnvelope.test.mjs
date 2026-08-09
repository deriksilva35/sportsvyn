// lib/gridiron/topicEnvelope.test.mjs - the football envelope.
//
// WHAT GOES WRONG WITHOUT THIS. `teams` and `matches` carry both sports'
// columns. Pointing the soccer envelope builders at an NFL team returns a shape
// where confederation, fifa_rank, group_code and every tournament_* field is
// NULL and match_watch_score_history has no rows - so the model gets a wall of
// nulls, writes around them, and validateTopicDraft fails the draft for a
// grounding violation that was really a schema mismatch. The failure reads as
// "the model could not write about football". It is not.
//
// So these tests check the two things that make a football envelope usable:
// it is POPULATED (grounding passes because there is data, not because the rule
// was loosened) and it is CLEAN (no soccer column reaches the prompt).
//
// The reads run against DEV. They are read-only and assert on shape and on
// invariants rather than on specific teams, so a data refresh does not break
// them; the one place a concrete value is pinned, it is pinned as a floor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchTeam, pruneZeroStats, seasonAnchor, gridironTeamList,
  resolveGridironEntities, buildGridironTeamEnvelope,
  buildGridironLeagueEnvelope, buildGridironEnvelope,
  SEASON_PHASES, STAT_PHASE,
} from './topicEnvelope.js';

const MODULE_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'topicEnvelope.js'), 'utf8');

// Soccer columns that must never appear anywhere in a gridiron envelope. Each
// one exists on the shared table and is NULL for every gridiron row.
const SOCCER_KEYS = [
  'confederation', 'fifa_rank', 'group_code', 'group',
  'tournament_record', 'tournament_wins', 'tournament_draws', 'tournament_losses',
  'tournament_goals_for', 'tournament_goals_against',
  'watch_peak', 'watch_scores', 'bracket', 'next_ko', 'stage',
];

function assertNoSoccerKeys(value, where = '$') {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSoccerKeys(v, `${where}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      assert.ok(!SOCCER_KEYS.includes(k), `soccer key "${k}" leaked into the gridiron envelope at ${where}`);
      assertNoSoccerKeys(v, `${where}.${k}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('matchTeam prefers exact over containment - two LA teams must not collide', () => {
  const teams = [
    { id: 1, name: 'Los Angeles Rams', slug: 'los-angeles-rams', abbreviation: 'LAR' },
    { id: 2, name: 'Los Angeles Chargers', slug: 'los-angeles-chargers', abbreviation: 'LAC' },
    { id: 3, name: 'Ohio State', slug: 'ohio-state', abbreviation: 'OSU' },
  ];
  assert.equal(matchTeam(teams, 'Los Angeles Rams').id, 1, 'exact name');
  assert.equal(matchTeam(teams, 'los angeles chargers').id, 2, 'exact, case-insensitive');
  assert.equal(matchTeam(teams, 'ohio-state').id, 3, 'by slug');
  assert.equal(matchTeam(teams, 'LAC').id, 2, 'by abbreviation');
  // Ambiguous prefix resolves to SOMETHING deterministic (first listed) rather
  // than to whichever row the database happened to return first.
  assert.equal(matchTeam(teams, 'Los Angeles').id, 1, 'containment is deterministic on input order');
});

test('matchTeam refuses short fragments but honours a real abbreviation', () => {
  const teams = [{ id: 1, name: 'Baltimore Ravens', slug: 'baltimore-ravens', abbreviation: 'BAL' }];
  // "Rav" is three characters and WOULD match by containment. That is how a
  // stray syllable becomes a team the piece is suddenly about, so containment
  // requires four.
  assert.equal(matchTeam(teams, 'Rav'), null);
  assert.equal(matchTeam(teams, 'Ravens').id, 1, 'four or more is allowed');
  // An exact abbreviation is a different case and is allowed at any length: it
  // is the team's actual name in short form, not a fragment of one.
  assert.equal(matchTeam(teams, 'BAL').id, 1);
  assert.equal(matchTeam(teams, 'bal').id, 1, 'case-insensitive');
  assert.equal(matchTeam(teams, 'Arsenal'), null, 'a team from another league does not resolve');
});

test('pruneZeroStats drops nulls and zeroes but keeps games', () => {
  // A receiver handed pass_yds: 0 invites a sentence about his passing.
  const out = pruneZeroStats({ games: 17, pass_yds: 0, rush_yds: null, rec: 96, rec_yds: 1200, rec_td: 8 });
  assert.deepEqual(out, { games: 17, rec: 96, rec_yds: 1200, rec_td: 8 });
  assert.deepEqual(pruneZeroStats({ games: 0 }), { games: 0 }, 'games survives even at zero');
  assert.deepEqual(pruneZeroStats(null), {});
});

// ---------------------------------------------------------------------------
// Season anchoring
// ---------------------------------------------------------------------------

test('the anchor is the last season PLAYED, not the last season scheduled', async () => {
  // PROD carries a full 2026 schedule with zero results. Anchoring on
  // max(season_year) would report 0-0 records under a season that has not
  // kicked off.
  for (const league of ['nfl', 'cfb']) {
    const a = await seasonAnchor(league);
    assert.ok(Number.isInteger(a.seasonYear), `${league} must anchor to a real season`);
    assert.ok(a.gamesPlayed > 0, `${league} anchor season must have completed games`);
    if (a.upcomingSeason) {
      assert.ok(a.upcomingSeason.season_year > a.seasonYear,
        'an upcoming season must be LATER than the one being reported on');
      assert.ok(a.upcomingSeason.games_scheduled > 0);
    }
  }
});

// ---------------------------------------------------------------------------
// Preseason never reaches the model
// ---------------------------------------------------------------------------
//
// THIS GUARD CANNOT BE PROVED BY DATA, AND THAT IS THE POINT. There is not one
// PRE row in any database - the ingest has only ever pulled REG and POST, for
// any season - so a behavioural test would pass today no matter what the SQL
// said, and would keep passing right up until the moment a preseason import
// landed and quietly broke three envelopes at once. The invariant is checked
// structurally instead: every query in this module that scopes to a season must
// also scope to a phase, including one written next month by someone who has
// never read this comment.

test('the phase lists exclude PRE, and say what they are for', () => {
  assert.deepEqual(SEASON_PHASES, ['REG', 'POST'], 'records and results: the real season');
  assert.equal(STAT_PHASE, 'REG', 'player stat lines: regular season only, per playerStats.js');
  assert.ok(!SEASON_PHASES.includes('PRE'));
  assert.notEqual(STAT_PHASE, 'PRE');
});

test('EVERY season-scoped query in this module also filters phase', () => {
  // Pull each sql`...` template out of the module and check the pairing. A new
  // reader added without a phase filter fails here by name.
  const templates = [...MODULE_SRC.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]);
  assert.ok(templates.length >= 6, `expected the module's queries, found ${templates.length}`);

  const offenders = [];
  let checked = 0;
  for (const q of templates) {
    // Only queries that READ MATCHES can see a phase. team_season_membership
    // is also season-scoped and has no phase column - a conference is a
    // property of a season, not of a phase within one.
    const readsMatches = /(FROM|JOIN)\s+matches\b/.test(q);
    const scopesSeason = /season_year\s*(=|IS NOT NULL)/.test(q);
    if (!readsMatches || !scopesSeason) continue;
    checked++;
    const filtersPhase = /season_phase\s*=\s*(ANY\(|\$\{STAT_PHASE\})/.test(q);
    if (!filtersPhase) {
      offenders.push(q.replace(/\s+/g, ' ').trim().slice(0, 110));
    }
  }
  // If the extraction ever stops finding queries, this test would pass while
  // checking nothing. Pin the count so that failure is loud.
  assert.ok(checked >= 5, `expected at least 5 season-scoped match queries, checked ${checked}`);
  assert.deepEqual(offenders, [],
    'a season-scoped query with no phase filter will absorb preseason the day one is imported');
});

test('the player queries are REG-only, not merely PRE-free', () => {
  // The team record keeps POST on purpose (it is reported as its own count).
  // A player stat line must not: including the postseason flatters exactly the
  // players whose teams went deep - Stafford 4,707/46 over 17, or 5,643/52
  // over 20 with the playoffs folded in.
  const playerFn = MODULE_SRC.slice(
    MODULE_SRC.indexOf('export async function buildGridironPlayerEnvelope'),
    MODULE_SRC.indexOf('export function pruneZeroStats'),
  );
  const stat = [...playerFn.matchAll(/season_phase\s*=\s*\$\{STAT_PHASE\}/g)];
  assert.equal(stat.length, 2, 'both the totals and the game log must pin STAT_PHASE');
  assert.ok(!/SEASON_PHASES/.test(playerFn),
    'the player envelope must not use the record phase list - that would readmit POST');
});

test('a preseason row would change nothing, because the filters are in the SQL', async () => {
  // Belt and braces on the structural check: confirm the live queries carry the
  // predicate as executed, not just as written. The anchor is the load-bearing
  // one - it decides which season the whole envelope describes, so a preseason
  // opener must not be able to declare a season "started".
  for (const league of ['nfl', 'cfb']) {
    const a = await seasonAnchor(league);
    assert.ok(a.gamesPlayed > 0, `${league} still anchors to a played season`);
    const env = await buildGridironTeamEnvelope(
      league,
      (await resolveGridironEntities(league, [{ kind: 'team', name: league === 'nfl' ? 'Baltimore Ravens' : 'Ohio State' }])).resolved[0].id,
      a,
    );
    assert.ok(env.recent_games.every((g) => g.phase !== 'PRE'), 'no PRE in recent games');
    assert.ok(env.season_record.wins + env.season_record.losses > 0,
      'and the filter did not empty the record');
  }
});

// ---------------------------------------------------------------------------
// Per-league envelope construction
// ---------------------------------------------------------------------------

test('NFL: a named team produces a populated, soccer-free envelope', async () => {
  const anchor = await seasonAnchor('nfl');
  const teams = await gridironTeamList('nfl');
  assert.equal(teams.length, 32, 'the planner sees all 32 NFL teams');

  const { resolved, unresolved } = await resolveGridironEntities('nfl', [
    { kind: 'team', name: 'Baltimore Ravens' },
  ]);
  assert.equal(unresolved.length, 0);
  assert.equal(resolved[0].matched_name, 'Baltimore Ravens');

  const env = await buildGridironTeamEnvelope('nfl', resolved[0].id, anchor);
  assert.equal(env.kind, 'team');
  assert.equal(env.name, 'Baltimore Ravens');
  assert.ok(env.season_record, 'a played season must yield a record');
  assert.ok(env.season_record.wins + env.season_record.losses > 0, 'the record must be non-empty');
  assert.ok(env.recent_games.length > 0, 'and recent games must be present');
  assert.ok(env.profile.conference, 'conference comes from team_season_membership');
  assertNoSoccerKeys(env);
});

test('NFL: the team envelope carries its editorial-board placements', async () => {
  // The boards store a selection_label with NULL team_id, so this is a
  // label match - and it is the main piece of Sportsvyn's own opinion the
  // envelope can hand the model about a team.
  const anchor = await seasonAnchor('nfl');
  const { resolved } = await resolveGridironEntities('nfl', [{ kind: 'team', name: 'Los Angeles Rams' }]);
  const env = await buildGridironTeamEnvelope('nfl', resolved[0].id, anchor);
  const power = env.ranking_placements.find((p) => p.board === 'Power Rankings');
  assert.ok(power, 'a top-32 NFL team must appear on the power board');
  assert.ok(power.rank >= 1 && power.rank <= power.of);
});

test('CFB: a league-scope prompt still gets a full envelope', async () => {
  // The counterpart to the World Cup tournament fallback. No named entity must
  // NOT mean an empty envelope, or grounding fails for want of a reader.
  const env = await buildGridironEnvelope('cfb', []);
  assert.equal(env.length, 1);
  const l = env[0];
  assert.equal(l.kind, 'league');
  assert.equal(l.league, 'College Football');
  assert.ok(l.ranking_boards.length >= 1, 'the boards are the league-scope spine');
  const top25 = l.ranking_boards.find((b) => b.board === 'The Sportsvyn 25');
  assert.ok(top25, 'the Sportsvyn 25 must be in a CFB league envelope');
  assert.ok(top25.entries.length > 0);
  assert.ok(top25.entries[0].name, 'entries carry names, which is what grounding checks');
  assertNoSoccerKeys(l);
});

test('CFB: a named player is unresolved with a reason, never guessed', async () => {
  // There is no college player table. Reaching into nfl_players would resolve a
  // different human who happens to share the name.
  const { resolved, unresolved } = await resolveGridironEntities('cfb', [
    { kind: 'player', name: 'Arch Manning' },
  ]);
  assert.equal(resolved.length, 0);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].reason, 'no college player table');
});

test('entity resolution is scoped to the CHOSEN league', async () => {
  // "Washington" exists in both gridiron leagues and the soccer tables. Without
  // the league filter the envelope silently describes the wrong team.
  const nfl = await resolveGridironEntities('nfl', [{ kind: 'team', name: 'Ohio State' }]);
  assert.equal(nfl.resolved.length, 0, 'a college team must not resolve inside the NFL');
  assert.equal(nfl.unresolved[0].name, 'Ohio State');

  const cfb = await resolveGridironEntities('cfb', [{ kind: 'team', name: 'Ohio State' }]);
  assert.equal(cfb.resolved.length, 1, 'and must resolve inside CFB');
  assert.equal(cfb.resolved[0].matched_name, 'Ohio State');
});

test('the league envelope names its upcoming season rather than faking records', async () => {
  const anchor = await seasonAnchor('nfl');
  const l = await buildGridironLeagueEnvelope('nfl', anchor);
  assert.equal(l.season, anchor.seasonYear);
  // Either there is an upcoming season stated as a separate fact, or there is
  // not one - never a set of 0-0 records standing in for it.
  if (anchor.upcomingSeason) {
    assert.equal(l.upcoming_season.season_year, anchor.upcomingSeason.season_year);
  } else {
    assert.equal(l.upcoming_season, null);
  }
  assert.ok(l.recent_games.every((g) => /\d+-\d+/.test(g.matchup)), 'recent games are completed results');
});

// ---------------------------------------------------------------------------
// The grounding claim, made concrete
// ---------------------------------------------------------------------------

test('a gridiron envelope supplies names for the grounding check', async () => {
  // validateTopicDraft passes a draft only if it mentions an envelope entity.
  // This asserts the envelope actually offers names to mention - which is why
  // grounding passes for football, rather than the rule having been relaxed.
  const { validateTopicDraft } = await import('../topicDraft.js');
  const env = await buildGridironEnvelope('nfl', []);
  const names = env[0].ranking_boards.flatMap((b) => b.entries.map((e) => e.name));
  assert.ok(names.length >= 5, 'the league envelope must offer several names');

  const body = `${names[0]} did something measurable. `.repeat(240);
  const draft = {
    headline: 'A headline about the league',
    dek: 'One sentence.',
    sections: [
      { heading: 'One', body }, { heading: 'Two', body }, { heading: 'Three', body },
    ],
  };
  const v = validateTopicDraft(draft, env);
  assert.ok(!v.issues.includes('draft does not mention any envelope entity (grounding)'),
    `grounding must pass on a populated football envelope; issues: ${v.issues.join('; ')}`);

  // And the rule still BITES: the same draft with no envelope name fails.
  const ungrounded = {
    ...draft,
    sections: draft.sections.map((s) => ({ ...s, body: 'Nothing identifiable happened here. '.repeat(120) })),
  };
  const v2 = validateTopicDraft(ungrounded, env);
  assert.ok(v2.issues.includes('draft does not mention any envelope entity (grounding)'),
    'the grounding rule must not have been loosened');
});

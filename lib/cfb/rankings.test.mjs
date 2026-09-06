// lib/cfb/rankings.test.mjs - the polls, the badges, the inclusion rule.
//
// The tests that matter most are the ones guarding things that would look fine
// in a diff: poll selection by NAME (an index reads the Coaches Poll, which has
// the identical shape and different teams), and board 1 being untouched by a
// filter added to the query that built it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pollFromWeek, normalizeRanks, AP_POLL, COACHES_POLL } from './rankings.js';
import { RANKING_TABS, resolveActiveTab, boardHref } from '../gridiron/rankingsHub.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

// The real 2026 week 1 envelope shape: Coaches FIRST, AP fourth, and a tie.
const WEEK = {
  season: 2026, seasonType: 'regular', week: 1,
  polls: [
    { poll: 'Coaches Poll', ranks: [{ rank: 1, teamId: 194, school: 'Ohio State', points: 1741, firstPlaceVotes: 38 }] },
    { poll: 'FCS Coaches Poll', ranks: [{ rank: 1, teamId: 999, school: 'North Dakota State' }] },
    { poll: 'AP Top 25', ranks: [
      { rank: 1, teamId: 194, school: 'Ohio State', points: 1672, firstPlaceVotes: 40 },
      { rank: 14, teamId: 30, school: 'USC', points: 612, firstPlaceVotes: 0 },
      { rank: 14, teamId: 252, school: 'BYU', points: 610, firstPlaceVotes: 0 },
    ] },
  ],
};

// ------------------------------------------------------- selection by NAME

test('the poll is selected by NAME - polls[0] is the Coaches Poll, not AP', () => {
  assert.equal(WEEK.polls[0].poll, 'Coaches Poll', 'precondition: AP is not first');
  assert.equal(pollFromWeek(WEEK, AP_POLL).ranks[0].points, 1672);
  assert.equal(pollFromWeek(WEEK, COACHES_POLL).ranks[0].points, 1741);
  // Same team, same rank, different poll - which is exactly why an index read
  // would be undetectable by eye.
  assert.notEqual(
    pollFromWeek(WEEK, AP_POLL).ranks[0].points,
    pollFromWeek(WEEK, COACHES_POLL).ranks[0].points,
  );
});

test('a missing poll THROWS - it never falls back or returns empty', () => {
  // An empty AP list would mean "nobody is ranked", which for the inclusion
  // rule means an empty board. Loud is the only safe failure here.
  assert.throws(() => pollFromWeek({ polls: [{ poll: 'Coaches Poll', ranks: [{}] }] }, AP_POLL),
    /AP Top 25" absent/);
  assert.throws(() => pollFromWeek({ polls: [] }, AP_POLL), /absent/);
  assert.throws(() => pollFromWeek({}, AP_POLL), /no polls array/);
  assert.throws(() => pollFromWeek({ polls: [{ poll: AP_POLL, ranks: [] }] }, AP_POLL), /no ranks/);
});

test('the source reads polls by name in code, never by index', () => {
  const code = strip(src('lib/cfb/rankings.js'));
  assert.match(code, /polls\.find\(\(p\) => p\.poll === pollName\)/);
  assert.doesNotMatch(code, /polls\[0\]/, 'no index access to the polls array');
});

// ------------------------------------------------------------ ties + gaps

test('a tie is stored as published - two 14s, no 15, nothing renumbered', () => {
  const { rows } = normalizeRanks(pollFromWeek(WEEK, AP_POLL), new Map([['194', 1], ['30', 2], ['252', 3]]));
  assert.deepEqual(rows.map((r) => r.rank), [1, 14, 14]);
  assert.equal(new Set(rows.map((r) => r.teamId)).size, 3, 'teams are distinct even when ranks are not');
});

test('the schema keys on TEAM, not rank - a rank unique index would reject a tie', () => {
  const m = src('migrations/075_rankings.sql');
  assert.match(m, /UNIQUE \(season, week, season_type, team_id\)/);
  assert.doesNotMatch(m, /UNIQUE \([^)]*\brank\b/);
});

test('an unresolvable ranked team is NAMED and dropped, never stored against null', () => {
  // team_id is what the inclusion rule joins on, so a null would silently
  // un-rank a team rather than fail.
  const { rows, unresolved } = normalizeRanks(pollFromWeek(WEEK, AP_POLL), new Map([['194', 1]]));
  assert.equal(rows.length, 1);
  assert.deepEqual(unresolved, ['14 USC', '14 BYU']);
});

// ------------------------------------------------------------- the tabs

test('CFB has five tabs, AP first, and the three existing KEYS are unchanged', () => {
  const keys = RANKING_TABS.cfb.map((t) => t.key);
  assert.deepEqual(keys, ['ap', 'coaches', 'top25', 'heisman', 'playoff']);
  // app/page.js links boardHref('cfb','top25'); moving that key would dangle it.
  assert.equal(boardHref('cfb', 'top25'), '/cfb/rankings?tab=top25');
  assert.match(strip(src('app/page.js')), /boardHref\('cfb', 'top25'\)/);
  assert.match(strip(src('app/page.js')), /boardHref\('nfl', 'power'\)/);
});

test('the three pre-existing CFB tabs keep their kind and list verbatim', () => {
  const byKey = Object.fromEntries(RANKING_TABS.cfb.map((t) => [t.key, t]));
  assert.deepEqual(byKey.top25, { key: 'top25', label: 'The Sportsvyn 25', list: 'cfb-top25', kind: 'editorial' });
  assert.deepEqual(byKey.heisman, { key: 'heisman', label: 'Heisman', list: 'cfb-heisman', kind: 'editorial' });
  assert.deepEqual(byKey.playoff, { key: 'playoff', label: 'Playoff Picture', kind: 'market', n: 25 });
});

test('NFL\'s registry is untouched - only CFB\'s array grew', () => {
  assert.deepEqual(RANKING_TABS.nfl.map((t) => t.key), ['power', 'mvp-offense', 'mvp-defense', 'playoff']);
  assert.deepEqual(RANKING_TABS.nfl.find((t) => t.key === 'playoff'), { key: 'playoff', label: 'Playoff Picture', kind: 'market', n: 12 });
  assert.equal(RANKING_TABS.nfl.filter((t) => t.kind === 'poll').length, 0, 'no poll tab leaks into NFL');
});

test('AP is the default tab, and that is a deliberate change', () => {
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, undefined).key, 'ap');
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'top25').key, 'top25');
  assert.equal(resolveActiveTab(RANKING_TABS.cfb, 'nonsense').key, 'ap', 'unknown falls back to first');
});

test('the poll branch is a SIBLING - editorial and market dispatch unchanged', () => {
  const hub = strip(src('components/gridiron/RankingsHub.js'));
  assert.match(hub, /active\?\.kind === 'editorial'/);
  assert.match(hub, /active\?\.kind === 'market'/);
  assert.match(hub, /active\?\.kind === 'poll'/);
  // The two original readers are called exactly as before.
  assert.match(hub, /board = await getEditorialBoard\(active\.list, leagueSlug\);/);
  assert.match(hub, /contenders = leagueId \? await getTitleContenders\(leagueId, active\.n \?\? 25\) : \[\];/);
});

// ------------------------------------------------------------- the badges

test('an unranked team renders NO badge - not a dash, not an empty span', () => {
  const b = strip(src('components/gridiron/RankBadge.js'));
  assert.match(b, /if \(rank == null\) return null;/);
  assert.doesNotMatch(b, /['"`]-['"`]|&mdash;|&ndash;/);
});

test('badges read AP only - the Coaches Poll drives nothing off the page', () => {
  for (const f of ['lib/gridiron/readers.js', 'lib/pickem/entry.js', 'app/cfb/game/[slug]/page.js']) {
    const code = strip(src(f));
    if (!/apRankMap/.test(code)) continue;
    assert.doesNotMatch(code, /COACHES_POLL|coaches_rankings/, `${f} must not read the Coaches Poll`);
  }
  assert.match(strip(src('lib/cfb/rankings.js')), /FROM ap_rankings/);
});

test('the scoreboard and CFB game page render the one badge component', () => {
  assert.match(strip(src('components/gridiron/Scoreboard.js')), /<RankBadge rank=\{t\.apRank\} \/>/);
  assert.match(strip(src('app/cfb/game/[slug]/page.js')), /<RankBadge rank=\{rank\} size="big" \/>/);
});

// PICK'EM LEFT THE SHARED BADGE (relay 2c item 4): its row folds rank into
// the record line as text ("#12 · 3-0") rather than a second visual chip
// beside the name, so RankBadge itself is gone from this surface - the rank
// is still sourced from the identical apRanks map, just rendered as words.
test("Pick'em folds rank into the record line, not a second badge", () => {
  const code = strip(src('components/pickem/PickemBoard.js'));
  assert.doesNotMatch(code, /RankBadge/);
  assert.match(code, /import \{ recordLine \} from '@\/lib\/pickem\/recordLine'/);
});

test('THE PICKEM VIEW CHANGE - the wire now carries ranks, which it did not', () => {
  // This is a reader change, not a markup edit: the board previously sent only
  // the two team NAME strings, so a badge was impossible without it.
  const v = strip(src('lib/pickem/view.js'));
  assert.match(v, /home_team_id: g\.home_team_id \?\? null/);
  assert.match(v, /home_rank: apRanks\?\.get\(g\.home_team_id\) \?\? null/);
  assert.match(v, /away_rank: apRanks\?\.get\(g\.away_team_id\) \?\? null/);
  // Optional param, so every existing caller and test keeps working.
  assert.match(v, /apRanks = new Map\(\)/);
  // THE RULE IS THAT apRanks REACHES gameRows, not that the argument list has
  // exactly five names in it. The list has since grown records and spreads;
  // pinning it verbatim made an unrelated wire addition look like a rankings
  // regression, which is a guard crying wolf rather than guarding.
  const e = strip(src('lib/pickem/entry.js'));
  assert.match(e, /gameRows\(\{[^}]*\bapRanks\b[^}]*\}\)/);
  assert.match(e, /gameRows\(\{ board: contest\.board, liveById, picks, now,/);
});

// -------------------------------------------------------- the inclusion rule

test('the inclusion rule is an EXISTS in the slate query, not a post-filter', () => {
  const c = src('lib/pickem/create.js');
  assert.match(c, /EXISTS \(\s*\n\s*SELECT 1 FROM ap_rankings r/);
  assert.match(c, /r\.team_id IN \(m\.home_team_id, m\.away_team_id\)/);
  // AP only.
  assert.doesNotMatch(c, /coaches_rankings/);
});

test('no AP week means NO FILTER - a missing poll must not empty the board', () => {
  // Failing open is deliberate: too many games is a product problem, zero is an
  // outage.
  assert.match(src('lib/pickem/create.js'), /\$\{apWeek\}::int IS NULL OR EXISTS/);
});

test('BOARD 1 IS UNTOUCHED - nothing re-reads slateFor for an existing board', () => {
  const c = strip(src('lib/pickem/create.js'));
  // slateFor is called from boardPlan only, and boardPlan is what CREATES a
  // board. An existing contest's games come from its frozen board jsonb.
  assert.equal((c.match(/slateFor\(/g) ?? []).length, 2, 'one definition, one call site');
  const view = strip(src('lib/pickem/view.js'));
  assert.match(view, /board\.map\(\(g\) =>/, 'the view reads the stored snapshot');
  assert.doesNotMatch(view, /slateFor|ap_rankings/, 'no re-selection at read time');
});

test('CONTRAST: the team name states its own colour, whatever wraps it', () => {
  // THE SHIPPED DEFECT, and how its fix changed shape. The hub shell used to be
  // data-surface="paper", which set color: var(--ink) - #0A0A0A. PollBoard
  // painted an --ink-2 (#141414) background without flipping the surface, so
  // team names rendered at a measured 1.07:1 and were invisible, while the
  // points column survived because .pb-v sets its colour explicitly (5.31:1).
  // The fix was a data-surface="ink" wrapper on the section.
  //
  // v1.3 RETIRED PAPER, so the hub is ink and that wrapper became a no-op -
  // it re-declared the surface its own ancestor already provides. It is gone.
  // What is NOT gone is the SECOND lock, and the second lock is now the whole
  // guard: .pb-t states its colour rather than inheriting it, so no wrapper,
  // present or absent, can hide a team name again. That is the durable rule -
  // the wrapper only ever patched one ancestor.
  assert.match(src('components/gridiron/pollboard.css'), /\.pb-t \{[^}]*color: var\(--paper/s);
  // and .pb-v, which never had the bug, still states its own too.
  assert.match(src('components/gridiron/pollboard.css'), /\.pb-v \{[^}]*color:/s);
  // The hub that supplies the surface must keep supplying it.
  assert.match(src('components/gridiron/RankingsHub.js'), /data-surface="ink"/);
});

test('the editorial rank line wears AP\'s grammar; the prose does not', () => {
  // EditorialBoard is SHARED by Sportsvyn 25 and Heisman, so this pins the four
  // rules that may change and the four that may not.
  const css = src('components/gridiron/gridiron.css');
  const rule = (sel) => (css.match(new RegExp(`^\\${sel} \\{[^}]*\\}`, 'm')) ?? [''])[0];

  // IN SCOPE: the numeral takes .pb-rn's treatment verbatim.
  assert.match(rule('.gi-ed-rk'), /font-style: italic/);
  assert.match(rule('.gi-ed-rk'), /font-weight: 900/);
  assert.match(rule('.gi-ed-rk'), /color: var\(--volt\)/);
  assert.match(rule('.gi-ed-rk'), /font-variant-numeric: tabular-nums/);

  // The row takes ground/rule/radius but KEEPS its grid and baseline - the
  // blurb shares this grid cell and a flex/card port would re-anchor it.
  assert.match(rule('.gi-ed-row'), /display: grid/);
  assert.match(rule('.gi-ed-row'), /align-items: baseline/);
  assert.match(rule('.gi-ed-row'), /background: var\(--ink-2\)/);
  assert.match(rule('.gi-ed-row'), /border-radius: 9px/);
  assert.doesNotMatch(rule('.gi-ed-row'), /display: flex/);

  // OUT OF SCOPE, byte-for-byte as they were.
  assert.match(rule('.gi-ed-read'), /^\.gi-ed-read \{ font-family: var\(--font-source-serif\), serif; font-style: italic; font-size: 13\.5px; line-height: 1\.5; color: var\(--paper-dim\); margin-top: 4px; \}$/);
  assert.match(rule('.gi-ed-band'), /border-top: 1px solid var\(--volt\); padding: 14px 0 4px; margin-top: 6px; \}$/);
  assert.match(rule('.gi-ed-footer'), /^\.gi-ed-footer \{ font-family: var\(--font-source-serif\), serif; font-style: italic; font-size: 13px; line-height: 1\.55; color: var\(--muted\); margin-top: 14px; padding-top: 12px; border-top: 1px solid var\(--rule-dim\); \}$/);
  assert.match(css, /\.gi-ed-row\.rank-only \.gi-ed-nm \{ color: var\(--muted\); \}/);

  // HAZARD 1: the Today preview shares the numeral column but not the card.
  const compact = (css.match(/^\.gi-ed-row\.compact \{[^}]*\}/m) ?? [''])[0];
  assert.match(compact, /grid-template-columns: 28px 1fr/, 'wide enough for a 16px numeral');
  assert.match(compact, /background: none/);
  assert.match(compact, /border: 0/);

  // Playoff Picture is a different component and must not render editorial rows.
  assert.doesNotMatch(src('components/gridiron/PlayoffPicture.js'), /gi-ed-row|gi-ed-rk/);
});

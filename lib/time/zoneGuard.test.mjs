// lib/time/zoneGuard.test.mjs - NO HARD-CODED ZONE IN DISPLAYED OUTPUT
// (sun-16 item B).
//
// THE DEFECT: three clocks for one first pitch - Eastern on the lobby cards,
// "1:00 PM PT" on /october, "4:00 PM EDT" on the MLB game page - each surface
// had spelled its own zone. A displayed time now goes through lib/time/
// display.js in the reader's zone (components/time/ViewerTz.js).
//
// HOW THIS GUARD WORKS. It walks app/, components/ and lib/ (tests excluded),
// strips comments, and counts the lines that name a zone: ET PT EDT EST PDT PST
// as a word, or a US IANA zone (lib/time/zoneScan.mjs). Every file with a hit
// must be in ALLOW below with EXACTLY that count, and every ALLOW entry must
// still have exactly that count. So:
//   - a new hard-coded zone in a file that had none fails (not allowlisted);
//   - a new one in an allowlisted file fails (its count moved);
//   - removing one fails too, until the entry is lowered - the list can only
//     be edited on purpose, and it can only be honest.
// A guard that only looked at the six surfaces this relay fixed could not see
// the seventh (the a-guard-cannot-see-a-file-it-does-not-name rule).
//
// THE ALLOWLIST IS NOT "FINE". Each entry says which of these it is:
//   RULE      a sports-day / settle / window rule that IS Eastern (or the
//             daily-card's Pacific day) - which day a game belongs to, when a
//             board opens, SQL day bucketing. Not a display; stays.
//   RULE_COPY copy that STATES such a rule ("closes midnight ET", "opens at 6
//             AM ET"): the zone is part of the rule's definition, and it is
//             labelled.
//   FALLBACK  the labelled Eastern fallback for a render with no sv_tz yet.
//   CODE      not a zone at all: soccer status ET = Extra Time, PST =
//             postponed, the flag code EST = Estonia, the scanner's own regex.
//   ADMIN     /admin pages and operator email - staff, not readers.
//   OPS       server-side text with no reader to have a zone (push bodies,
//             the LLM prompt, cron mail).
//   DEFERRED  a DISPLAYED time still in a fixed zone, on a surface outside
//             this relay's six (lobby, October, MLB game page, Pick'em, Six,
//             EPL). Real debt, pinned so it can only shrink: the follow-up
//             moves each onto lib/time/display.js and deletes its entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoneHits, stripComments } from './zoneScan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const RULE = 'RULE', RULE_COPY = 'RULE_COPY', FALLBACK = 'FALLBACK', CODE = 'CODE';
const ADMIN = 'ADMIN', OPS = 'OPS', DEFERRED = 'DEFERRED';

// [count, kind, what] - PINNED. See the header before editing.
const ALLOW = {
  // --- the formatter and the guard themselves
  'lib/time/display.js': [2, FALLBACK, 'FALLBACK_TZ / FALLBACK_LABEL: the one display-side spelling of the fallback'],
  'lib/time/zoneScan.mjs': [1, CODE, "the scanner's own pattern"],

  // --- RULE: which ET day / week / window something belongs to
  'app/api/cron/daily-puzzle/route.js': [2, RULE, "today/tomorrow's ET puzzle date"],
  'app/api/cron/nfl-preseason/route.js': [4, RULE, 'ET day budget for the poller; 2 of the 4 are its alert email'],
  'lib/daily/create.js': [2, RULE, 'a board spans its ET day'],
  'lib/games/howItWorks.js': [1, RULE, 'a game\'s season window is an ET calendar month-day (stale-pages)'],
  'lib/daily/entries.js': [1, RULE, "today's ET edition"],
  'lib/daily/guestRuns.js': [2, RULE, "a guest run's claim lapses at midnight PT after the edition's ET date; one claim per account per ET day"],
  'lib/daily/seasonBoardTick.js': [1, RULE, "the tick's ET edition date"],
  'lib/daily/morningPush.js': [1, RULE, "the morning push's fallback zone: a run with no stamped zone is pushed at 9:00 ET"],
  'lib/fantasy/drafts.js': [3, RULE, 'the ET week a draft cap counts in'],
  'lib/gridiron/ingest.js': [1, RULE, 'easternLocalToUtc: provider ET-local strings (CLAUDE.md boundary)'],
  'lib/gridiron/inYourGames.js': [1, RULE, 'ISO week of the ET Monday'],
  'lib/gridiron/readers.js': [8, RULE, 'the scoreboard ET-day grouping (et_day, et_weekday)'],
  'lib/gridiron/scoresNav.js': [2, RULE, 'which ET day the no-param scoreboard opens on'],
  'lib/gridiron/scoresV2.js': [4, RULE, 'ET-day SQL; tz param defaults to the ET fallback'],
  'lib/gridiron/scoresV2Shape.js': [4, RULE, 'ET constant + ET-day defaults for the scoreboard day'],
  'lib/gridiron/stuckLive.js': [1, RULE, 'ET day of a stuck-live game'],
  'lib/gridiron/todayV2.js': [2, RULE, "today's ET day; eyebrow tz param fallback"],
  'lib/leagues/start.js': [1, RULE, 'a league starts on an ET day'],
  'lib/mlb/advance.js': [1, RULE, 'the ET day of the postseason advance'],
  'lib/mlb/advanceKick.js': [1, RULE, "an ET day's last postseason game"],
  'lib/mlb/resync.js': [1, RULE, 'ET day of a resync'],
  'lib/nba/dayPickem.js': [2, RULE, "the NBA day board's ET day"],
  'lib/october/create.js': [7, RULE, 'the October day is an ET day'],
  'lib/pickem/create.js': [1, RULE, 'a football board covers an ET week'],
  'lib/pollers/liveWindow.js': [1, RULE, 'the live poll window, ET clock'],
  'lib/pollers/preseasonWindow.js': [2, RULE, 'the preseason poll window, ET clock'],
  'lib/run/create.js': [3, RULE, "The Run's ET day"],
  'lib/run/preview.js': [2, RULE, 'the ET calendar day a kickoff belongs to'],
  'lib/six/night.js': [1, RULE, "Tonight's Six is an ET night"],
  'lib/soccer/eplPageArcade.js': [2, RULE, 'ET constant + the ET weekday a final is filed under'],
  'lib/gridiron/gamePageArcade.js': [1, RULE, 'the ET weekday a final is filed under ("Final · Sun")'],
  'lib/today/daySlate.js': [6, RULE, "today's slate is an ET day"],
  'lib/today/signals.js': [3, RULE, 'plays-today is an ET day'],
  'lib/you/reads.js': [1, RULE, 'streak dots count back from the ET day'],
  'lib/push/notify.js': [2, RULE, "1 = today's ET date for the v2 epoch; 1 = push body below"],
  'lib/articles.js': [3, RULE, "the daily card's Pacific day"],
  'lib/watchScore.js': [4, RULE, "the daily card's Pacific day"],
  'lib/scheduleData.js': [4, RULE, '3 = Pacific-day grouping of the WC schedule; 1 = its date label (WC archive)'],
  'app/app/data.js': [20, DEFERRED, 'the World Cup app shell (/app): Pacific-day grouping AND "... PT" / "... ET" kickoff labels'],

  // --- RULE_COPY: copy that states an Eastern rule, labelled
  'app/daily/board/[date]/page.js': [1, RULE_COPY, 'settled at midnight ET'],
  'app/daily/board/page.js': [3, RULE_COPY, 'unlock at midnight ET (signed-in DNF; guest and already-played-as-guest notes say "a new one opens at midnight ET")'],
  'app/games/how-it-works/page.js': [2, RULE_COPY, 'a new board at midnight ET'],
  'app/six/page.js': [1, RULE_COPY, "Tonight's Six opens at 6 AM ET"],
  'components/daily/DailyRoom.js': [3, RULE_COPY, 'answer unlocks / reveal at midnight ET'],
  'components/daily/season/OpenReveal.js': [2, RULE_COPY, 'perfect roster at midnight ET'],
  'components/daily/season/SeasonBoard.js': [5, RULE_COPY, 'midnight ET reveal; its close time is StandaloneTime "your time"'],
  'components/home/DailyModule.js': [2, RULE_COPY, 'closes / unlocks at midnight ET'],
  'lib/games/dailyRow.js': [1, RULE_COPY, 'DAILY_CLOSES = closes midnight ET'],
  'lib/games/lobbyV2Shape.js': [3, RULE_COPY, '"Board opens at midnight ET"; ET weekday of an opening; tonightTitle tz fallback'],
  'lib/games/read.js': [7, RULE_COPY, '4 = "midnight ET" daily copy; 3 = ET date labels on lobby ghosts (DEFERRED display)'],

  // --- FALLBACK: the labelled Eastern render when sv_tz is unknown
  'app/nba/game/[slug]/page.js': [1, FALLBACK, 'tz ?? ET for GamePageArcade'],
  'app/scores/page.js': [3, FALLBACK, 'viewerTz ?? ET; the ET date param default'],
  'components/games/LobbyV3.js': [1, FALLBACK, 'zone name for tz ?? ET in the header'],
  'components/games/PlayCloses.js': [1, FALLBACK, "null = ET: the 'closes midnight' test for a render with no sv_tz yet (play-collapse)"],
  'components/gridiron/GamePageArcade.js': [1, FALLBACK, 'tz prop default'],
  'components/sim/MyLeagues.js': [2, FALLBACK, 'tz ?? ET for draft day / time'],
  'lib/gridiron/leagueLanding.js': [2, FALLBACK, 'tz param defaults'],
  'lib/rankings/editionKicker.js': [1, FALLBACK, 'tz param default'],
  'lib/scores/v4.js': [3, FALLBACK, 'ET import + tz param defaults'],

  // --- CODE: not a zone
  'app/app/app-shell.js': [1, CODE, "soccer period 'ET' = Extra Time"],
  'components/match/LiveHero.js': [1, CODE, "'ET' = Extra Time"],
  'lib/flags.js': [1, CODE, 'EST = Estonia'],
  'lib/formSync.js': [2, CODE, 'ET = Extra Time, PST = postponed'],
  'lib/soccer/epl.js': [2, CODE, 'ET = Extra Time, PST = postponed'],
  'lib/stuckLiveSweep.js': [2, CODE, 'ET = Extra Time, PST = postponed'],
  'lib/syncFixture.js': [2, CODE, 'ET = Extra Time, PST = postponed'],

  // --- ADMIN / OPS
  'app/admin/blurbs/page.js': [1, ADMIN, 'admin timestamps'],
  'app/admin/console/page.js': [5, ADMIN, 'admin console, ET'],
  'app/admin/daily-card/page.js': [3, ADMIN, 'admin daily card, PT day'],
  'app/admin/prematch/page.js': [3, ADMIN, 'admin prematch, PT'],
  'app/admin/signups/TableControls.js': [1, ADMIN, 'admin signups'],
  'app/admin/signups/page.js': [1, ADMIN, 'admin signups'],
  'app/api/cron/gridiron-games/route.js': [1, OPS, 'operator email subject ("ET/UTC drift")'],
  'lib/gridiron/kickoffGuard.js': [1, OPS, 'operator refusal text ("ET/UTC-mislabel drift")'],
  'lib/dailyCardIntro.js': [1, OPS, 'LLM prompt: "the PT date in the envelope"'],

  // --- DEFERRED: displayed in a fixed zone, outside this relay's six surfaces
  'app/cfb/game/[slug]/page.js': [6, DEFERRED, 'legacy CFB game page: "{kickoff} ET" chip and When row'],
  'app/nfl/game/[slug]/page.js': [6, DEFERRED, 'legacy NFL game page: "{kickoff} ET" chip and When row'],
  'app/match/[slug]/page.js': [1, DEFERRED, 'World Cup match date, ET'],
  'app/page.js': [3, DEFERRED, 'home: Daily Card PT dateline; ET day label (1 is the ET slate-day RULE)'],
  'app/world-cup-2026/bracket/page.js': [1, DEFERRED, 'WC bracket dates, PT (archive)'],
  'app/world-cup-2026/rankings/players/page.js': [2, DEFERRED, 'WC "updated ... PT" (archive)'],
  'app/world-cup-2026/rankings/power/page.js': [2, DEFERRED, 'WC "updated ... PT" (archive)'],
  'components/boards/BoardPage.js': [2, DEFERRED, 'boards: "{lock} ET"'],
  'components/home/DraftModule.js': [2, DEFERRED, 'home draft module: "{first kickoff} ET"'],
  'components/home/WeeklyModule.js': [2, DEFERRED, 'home weekly module: "{first kickoff} ET"'],
  'components/leagues/LeagueBoard.js': [1, DEFERRED, 'league members: "Joined {date}" in ET'],
  'components/market/LineTable.js': [1, DEFERRED, 'market kickoff, ET (market filters are out of scope)'],
  'components/market/MarketClient.js': [2, DEFERRED, 'market kickoff + day, ET'],
  'components/market/PlayerPropCard.js': [1, DEFERRED, 'market kickoff, ET'],
  'components/market/PropsBoard.js': [1, DEFERRED, 'market kickoff, ET'],
  'components/market/PropsIndex.js': [1, DEFERRED, 'market kickoff, ET'],
  'components/market/PropsTable.js': [1, DEFERRED, 'market kickoff, ET'],
  'components/my/panels.js': [2, DEFERRED, '/my panels: ET weekday / short date'],
  'components/player/GridironTeamNext.js': [2, DEFERRED, 'player page next game, ET'],
  'components/player/PlayerMatchLog.js': [2, DEFERRED, 'player match log, PT'],
  'lib/fantasy/yourDrafts.js': [1, DEFERRED, 'your drafts: date in ET'],
  'lib/gridiron/gameBrief.js': [2, DEFERRED, 'game brief "{HH:MM} ET" stamp'],
  'lib/leagues/settings.js': [1, DEFERRED, 'league start date in ET'],
  'lib/market/lineTables.js': [1, DEFERRED, 'market kickoff, ET'],
  'lib/market/propsBoard.js': [1, DEFERRED, 'market kickoff, ET'],
  'lib/pickem/read.js': [3, DEFERRED, 'lockLabel "Sat Aug 29, noon ET" for /my and Today (not the Pick\'em page)'],
  'lib/rankings/view.js': [1, DEFERRED, 'rankings eyebrow weekday, ET'],
  'lib/run/entry.js': [3, DEFERRED, 'The Run panel: "lineup posted {time} PT"'],
  'lib/soccer/fixtures.js': [3, DEFERRED, 'fixture rows: ET weekday/time'],
  'lib/teamOutlook.js': [1, DEFERRED, 'team outlook date, PT'],
  'lib/today/gamesBandCards.js': [1, DEFERRED, 'Today band: "Sep 29" in ET'],
  'lib/today/slateRow.js': [3, DEFERRED, 'Today slate rows: ET time / weekday'],
  'lib/wire/read.js': [2, DEFERRED, 'wire timestamps, PT'],
};

// THE SIX SURFACES THIS RELAY FIXED: none of their files may appear above.
const FIXED = [
  'components/games/PlayWhen.js', 'lib/games/playTime.js', 'lib/games/playRegistry.js',
  'lib/survivor/lobbyRow.js', 'lib/eplWeekly5/lobbyRow.js',
  'components/october/OctoberCard.js', 'app/october/page.js', 'components/run/RunRoster.js',
  'app/mlb/game/[slug]/page.js',
  'components/pickem/PickemBoard.js', 'lib/pickem/dayGroups.js', 'app/pickem/[sport]/page.js', 'components/pickem/PickemGrade.js',
  'components/six/SixCard.js',
  'components/eplWeekly5/EplWeekly5Card.js', 'components/eplWeekly5/WindowLabel.js', 'lib/eplWeekly5/labels.js', 'app/epl-weekly-5/page.js',
  'components/soccer/SoccerMatchPage.js', 'components/soccer/EplPageArcade.js',
  'components/StandaloneTime.js', 'components/StandaloneDate.js', 'components/StandaloneDateOnly.js',
  'components/time/ViewerTz.js', 'lib/time/standaloneLabel.js', 'lib/gridiron/kickoff.js',
];

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const counts = () => {
  const out = {};
  for (const d of ['app', 'components', 'lib']) {
    for (const f of walk(path.join(ROOT, d))) {
      const n = zoneHits(readFileSync(f, 'utf8')).length;
      if (n) out[path.relative(ROOT, f)] = n;
    }
  }
  return out;
};

test('THE SCANNER: comments do not count, strings and JSX text do, one per line', () => {
  assert.equal(zoneHits('// closes at 5 PM ET\n/* 9 AM PT */ const a = 1;').length, 0);
  assert.equal(zoneHits("const s = `${t} ET`;").length, 1);
  assert.equal(zoneHits('<span>{t} PDT</span>').length, 1);
  assert.equal(zoneHits("new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })").length, 1);
  assert.equal(zoneHits("const a = 'America/New_York'; const b = ' ET';").length, 1, 'a line counts once');
  // Not zones: words that merely contain the letters.
  assert.equal(zoneHits("const x = 'GET'; const PTS = 1; const ET_DAY = 2; const y = 'PST_x';").length, 0);
  // A URL in a string is not a comment start.
  assert.equal(stripComments("const u = 'https://x.test'; // c").includes('https://x.test'), true);
});

test('EVERY HARD-CODED ZONE IN app/, components/, lib/ IS ALLOWLISTED AT ITS EXACT COUNT', () => {
  const got = counts();
  const unlisted = Object.keys(got).filter((f) => !(f in ALLOW)).map((f) => `${f} (${got[f]})`);
  assert.deepEqual(unlisted, [],
    'a displayed time goes through lib/time/display.js in the reader\'s zone; a genuine rule use gets an ALLOW entry saying which rule');
  const moved = Object.entries(ALLOW)
    .filter(([f, [n]]) => (got[f] ?? 0) !== n)
    .map(([f, [n]]) => `${f}: pinned ${n}, found ${got[f] ?? 0}`);
  assert.deepEqual(moved, [], 'an allowlisted count moved: re-read the file, then fix it or re-pin it on purpose');
});

test('every ALLOW entry says what it is', () => {
  const kinds = new Set([RULE, RULE_COPY, FALLBACK, CODE, ADMIN, OPS, DEFERRED]);
  for (const [f, [n, kind, why]] of Object.entries(ALLOW)) {
    assert.ok(Number.isInteger(n) && n > 0, `${f}: count`);
    assert.ok(kinds.has(kind), `${f}: kind ${kind}`);
    assert.ok(typeof why === 'string' && why.length > 8, `${f}: a reason`);
  }
});

test('THE SIX SURFACES ARE CLEAN - none of their files is on the list', () => {
  const got = counts();
  for (const f of FIXED) {
    assert.ok(!(f in ALLOW), `${f} must not be allowlisted`);
    assert.equal(got[f] ?? 0, 0, `${f} names a zone: ${zoneHits(readFileSync(path.join(ROOT, f), 'utf8')).map((h) => h.text).join(' | ')}`);
  }
});

test('the house zone is gone and the cookie is written on every page', () => {
  const kickoff = stripComments(readFileSync(path.join(ROOT, 'lib/gridiron/kickoff.js'), 'utf8'));
  assert.doesNotMatch(kickoff, /HOUSE_TZ|ptTime/);
  const layout = readFileSync(path.join(ROOT, 'app/layout.js'), 'utf8');
  assert.match(layout, /import TzCookie from '@\/components\/gridiron\/TzCookie'/);
  assert.match(stripComments(layout), /<TzCookie \/>/);
  // And each fixed page hands the reader's zone to its times.
  for (const f of ['app/october/page.js', 'app/six/page.js', 'app/epl-weekly-5/page.js', 'app/pickem/[sport]/page.js']) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /const tz = await readViewerTz\(\)/, f);
    assert.match(src, /<ViewerTzProvider tz=\{tz\}>/, f);
  }
  assert.match(readFileSync(path.join(ROOT, 'app/mlb/game/[slug]/page.js'), 'utf8'), /<StandaloneTime iso=\{g\.kickoffAt\} serverTz=\{viewerTz\} \/>/);
});

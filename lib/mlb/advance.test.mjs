// lib/mlb/advance.test.mjs - the advance's pure half (tue-2): the day-done rule,
// the import output read back, and the journal line. The two import outputs
// below are tonight's REAL runs on PROD (29 Sep), trimmed of the placeholder
// list, so the parser is pinned to the shape the script actually prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slateDone, parseImportOutput, journalLine, etDay, kickUnitName, ADVANCE_UNIT, KICK_DELAY_SEC } from './advance.js';

const FIRST_RUN = `TARGET ep-winter-dawn.neon.tech | FP 90e84b2cd485 | APPLY | stage from SEEDS (--bdl)

2026: 53 postseason games from the schedule feed
  seeds from team_records: 12 clubs

  round                games   series
  Wild Card               12        4 ok
  Division Series          0        0
  Championship Series      0        0
  World Series             0        0
  (unstaged)              41

  series
    wild_card:ATL-PHI          3 games
    wild_card:BOS-NYY          3 games
    wild_card:CHC-SD           3 games
    wild_card:CHW-HOU          3 games

  COULD NOT PLACE (left unstaged, absent from the bracket):
    TB-UNK  ["seeds - v 1"]
    CLE-UNK  ["seeds - v 2"]
    UNK-UNK  ["seeds - v -"]

APPLIED  inserted 0 | updated 12 | refused 41
  refused: mlb-2026-10-03-unk-tb, mlb-2026-10-03-unk-cle

  october days

  the run
    wild_card      no-series-yet
    division       no-series-yet
    championship   no-series-yet
    world_series   no-series-yet

  round boards
    Wild Card            no-series-yet
    Division Series      no-series-yet
    Championship Series  no-series-yet
    World Series         no-series-yet
`;

const SECOND_RUN = FIRST_RUN
  .replace('  october days\n', `  october days
    2026-09-29  CREATED id=27 · 4 games · first pitch 18:00Z
             house: chalk 5/5 · fade skip · gut 5/5 · homer 5/5
    2026-09-30  CREATED id=28 · 4 games · first pitch 18:00Z
             house: chalk 5/5 · fade skip · gut 5/5 · homer 5/5
    2026-10-01  CREATED id=29 · 4 games · first pitch 18:00Z
             house: chalk 5/5 · fade skip · gut 5/5 · homer 5/5
`)
  .replace('    wild_card      no-series-yet', '    wild_card      CREATED id=30 · 8 clubs alive of 12 · locks 2026-09-29T18:00')
  .replace('    Wild Card            no-series-yet', '    Wild Card            CREATED id=31 · 4 series · max 4 · locks 2026-09-29T18:00');

test('slateDone: over only when something was decided and nothing is left to play', () => {
  const g = (status) => ({ status });
  assert.equal(slateDone([g('final'), g('final')]), true);
  assert.equal(slateDone([g('final'), g('live')]), false);
  assert.equal(slateDone([g('final'), g('scheduled')]), false, 'a doubleheader\'s game 2 still to come');
  assert.equal(slateDone([g('final'), g('postponed')]), true, 'a postponement does not hold the day open');
  assert.equal(slateDone([g('final'), g('cancelled')]), true);
  assert.equal(slateDone([g('postponed')]), false, 'nothing decided, nothing to advance');
  assert.equal(slateDone([]), false);
});

test('parse: tonight\'s first run - 12 staged, nothing opened (lib/db.js pointed at DEV), placeholders not reported', () => {
  const s = parseImportOutput(FIRST_RUN);
  assert.deepEqual(s, { applied: true, staged: 12, unstaged: 41, inserted: 0, updated: 12, refused: 41,
    opened: { octoberDays: 0, runRounds: 0, boards: 0 }, unplaced: [], refusedToRun: null, notNeeded: [] });
});

test('parse: tonight\'s second run - 3 October days, 1 Run round, 1 board opened', () => {
  const s = parseImportOutput(SECOND_RUN);
  assert.deepEqual(s.opened, { octoberDays: 3, runRounds: 1, boards: 1 });
  assert.equal(s.staged, 12); assert.equal(s.refused, 41); assert.deepEqual(s.unplaced, []);
});

test('parse: a series with two KNOWN clubs that could not be placed is UNPLACED; UNK placeholders never are', () => {
  const text = FIRST_RUN.replace('    TB-UNK  ["seeds - v 1"]', '    TB-UNK  ["seeds - v 1"]\n    CHW-HOU  ["seeds 6 v 7"]\n    CHW-HOU  ["seeds 6 v 7"]');
  assert.deepEqual(parseImportOutput(text).unplaced, ['CHW-HOU'], 'named once');
});

test('parse: the import refusing to run is read as such, not as zero counts', () => {
  const s = parseImportOutput('REFUSE: --prod --apply opens October days, Run rounds and series boards through lib/db.js,\nwhich reads DATABASE_URL - and it is not PROD here.');
  assert.equal(s.applied, false);
  assert.match(s.refusedToRun, /^--prod --apply opens October days/);
});

test('the journal line: one fixed shape per run', () => {
  assert.equal(journalLine(parseImportOutput(SECOND_RUN), { trigger: 'event' }),
    '[mlb-advance] event staged 12 / opened {october days 3, run rounds 1, boards 1} / refused 41 / unplaced none');
  const unplaced = parseImportOutput(FIRST_RUN.replace('    TB-UNK', '    SD-CHC  ["x"]\n    TB-UNK'));
  assert.equal(journalLine(unplaced, { trigger: 'timer' }),
    '[mlb-advance] timer staged 12 / opened {october days 0, run rounds 0, boards 0} / refused 41 / UNPLACED SD-CHC');
  assert.match(journalLine(parseImportOutput('REFUSE: nope'), { trigger: 'manual' }), /^\[mlb-advance\] manual REFUSED: nope$/);
  assert.match(journalLine(parseImportOutput('boom'), {}), /^\[mlb-advance\] manual DID NOT APPLY/);
});

test('the ET day and the kick unit', () => {
  assert.equal(etDay('2026-09-30T02:00:00Z'), '2026-09-29', 'CHC@SD at 7 pm Pacific is Tuesday\'s game');
  assert.equal(kickUnitName('2026-09-29'), 'sportsvyn-mlb-advance-kick-2026-09-29');
  assert.equal(ADVANCE_UNIT, 'sportsvyn-mlb-advance@event.service');
  assert.equal(KICK_DELAY_SEC, 300, 'five minutes: BDL needs a moment to list the next series');
});

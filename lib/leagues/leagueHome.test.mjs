// lib/leagues/leagueHome.test.mjs - the league home (Leagues Phase 1, slices
// 1-2, thu-4): the LEAD / BACK OF 1ST tile, nothing overflowing at 390, the
// movement arrows, crew points (ties included), "Latest in the league" written
// once, and who may do what on the Members tab.
//
// Fixture (the DB half): SENTINEL users (@example.invalid, "lhtest" in the
// address - found by scripts/dev-orphan-sweep.mjs if a killed run leaves them)
// and leagues named "Test home ...". after() deletes every one and asserts it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const home = await import('./home.js');
const crew = await import('./crew.js');
const { computeStandings } = await import('./standings.js');
const { buildTable } = await import('./table.js');
const members = await import('./members.js');
const events = await import('./events.js');
const core = await import('./core.js');
const invite = await import('./invite.js');
const { REFUSALS } = await import('./code.js');
const { sql } = await import('../db.js');

// ---------------------------------------------------------------------------
// the tiles
// ---------------------------------------------------------------------------

const R = (userId, place, total) => ({ userId, place, total });

test('LEAD +margin over 2nd when you are 1st; BACK OF 1ST otherwise', () => {
  const lead = home.statTiles({ rows: [R(1, 1, 42126.1), R(2, 2, 39880.4), R(3, 3, 100)], uid: 1, now: 1912.4 });
  assert.deepEqual(lead.map((t) => [t.label, t.value]), [['You', '1ST'], ['Lead', '+2,246'], ['Today', '1,912']]);

  const back = home.statTiles({ rows: [R(1, 1, 42126.1), R(2, 2, 39880.4)], uid: 2, now: null });
  assert.deepEqual(back.map((t) => [t.label, t.value]), [['You', '2ND'], ['Back of 1st', '2,246'], ['Today', '—']]);
  // The 16 Oct case on PROD: 44,214.3 back of 1st printed "44,21..." in the arcade face.
  assert.equal(home.statTiles({ rows: [R(1, 1, 44214.3), R(2, 2, 0)], uid: 2 })[1].value, '44.2K');

  const tied = home.statTiles({ rows: [R(1, 1, 50), R(2, 1, 50)], uid: 2 });
  assert.deepEqual(tied[1], { key: 'lead', label: 'Lead', value: 'Tied' }, 'tied for 1st is not "+0"');

  const alone = home.statTiles({ rows: [R(1, 1, 50)], uid: 1 });
  assert.equal(alone[1].value, '—', 'a league of one has nobody to lead');

  const weekly = home.statTiles({ rows: [R(1, 1, 5)], uid: 1, unit: 'week', now: 3 });
  assert.equal(weekly[2].label, 'This week', 'a weekly league says THIS WEEK');

  const none = home.statTiles({ rows: [], uid: 9, hasTable: false });
  assert.deepEqual(none.map((t) => t.value), ['—', '—', '—']);
});

// ---------------------------------------------------------------------------
// overflow at 390
// ---------------------------------------------------------------------------

test('A TILE NEVER TRUNCATES (fri-1): every tile number is at most five characters before its sign', () => {
  const cases = [[0, '0'], [912.44, '912.4'], [1569.2, '1,569'], [9999.4, '9,999'], [9999.6, '10K'], [44214.3, '44.2K'],
    [12000, '12K'], [99949, '99.9K'], [99950, '100K'], [312400, '312K'], [999500, '1M'], [1234567, '1.2M'], [-44214.3, '-44.2K']];
  for (const [x, want] of cases) assert.equal(home.fmtTile(x), want, String(x));
  for (let e = 0; e <= 9; e += 0.05) {
    const v = home.fmtTile(10 ** e);
    assert.ok(v.length <= 5, `${10 ** e} -> ${v}`);
  }
  // Every tile reads fmtTile; the tables keep the full fmtNum value.
  const board = src('components/leagues/LeagueBoard.js');
  assert.match(board, /value: meNow \? fmtTile\(meNow\.current\)/);
  assert.match(src('lib/leagues/home.js'), /value: fmtTile\(Math\.max\(0, lead - me\.total\)\)/);
  assert.match(board, /<span className="lh-total">\s*\{fmtNum\(r\.total\)\}/);
});

test('numbers carry thousands separators and one decimal at most', () => {
  assert.equal(home.fmtNum(42126.08), '42,126.1');
  assert.equal(home.fmtNum(1912), '1,912');
  assert.equal(home.fmtNum(0), '0');
  assert.equal(home.fmtNum(1234567.89), '1,234,567.9');
  assert.equal(home.fmtNum(null), '—');
});

test('NOTHING OVERFLOWS AT 390: names shrink and ellipsise, number columns size to their content', () => {
  const css = src('app/leagues/leagueHome.css');
  const rule = (sel) => {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i >= 0, `${sel} is styled`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(rule('.lh-row'), /grid-template-columns: 24px minmax\(0, 1fr\) auto auto/, 'the name column can shrink to 0');
  assert.match(rule('.lh-row--crew'), /minmax\(0, 1fr\) auto/);
  for (const sel of ['.lh-handle', '.lh-sub']) {
    const r = rule(sel);
    assert.match(r, /text-overflow: ellipsis/, sel);
    assert.match(r, /white-space: nowrap/, sel);
  }
  assert.match(rule('.lh-who'), /min-width: 0/);
  assert.match(rule('.lh-total'), /white-space: nowrap/);
  assert.match(rule('.lh-chips'), /flex-wrap: wrap/, 'the chips wrap, they never push the page sideways');
  assert.match(rule('.lh-member'), /minmax\(0, 1fr\)/);
  // The widest total a season can plausibly print fits its column at 14px.
  assert.ok(home.fmtNum(999999.9).length <= 9);
});

// ---------------------------------------------------------------------------
// movement
// ---------------------------------------------------------------------------

test('movement: ▲ jade / ▼ terra since the previous period, nothing when level', () => {
  assert.deepEqual(home.moveMark(2), { text: '▲2', dir: 'up' });
  assert.deepEqual(home.moveMark(-1), { text: '▼1', dir: 'down' });
  assert.deepEqual(home.moveMark(0), { text: '', dir: null });
  assert.deepEqual(home.moveMark(null), { text: '', dir: null });
  // Through the real table: B leads after day 1, A passes B on day 2.
  const ms = [{ userId: 1, handle: 'a' }, { userId: 2, handle: 'b' }];
  const res = (u, day, score) => ({ userId: u, game: 'daily', sport: 'all', period: day, bucket: day, score, final: true });
  const st = computeStandings({
    members: ms, scoring: 'total', bucketOrder: ['2026-10-13', '2026-10-14'],
    results: [res(1, '2026-10-13', 100), res(2, '2026-10-13', 200), res(1, '2026-10-14', 300), res(2, '2026-10-14', 50)],
  });
  const a = st.rows.find((r) => r.userId === 1); const b = st.rows.find((r) => r.userId === 2);
  assert.equal(home.moveMark(a.move).text, '▲1');
  assert.equal(home.moveMark(b.move).text, '▼1');
  const board = src('components/leagues/LeagueBoard.js');
  assert.match(board, /<Move m=\{r\.move\} \/>/);
  const css = src('app/leagues/leagueHome.css');
  assert.match(css, /\.lh-move--up \{ color: var\(--tok-up\); \}/, 'jade');
  assert.match(css, /\.lh-move--down \{ color: var\(--tok-down\); \}/, 'terra');
});

// ---------------------------------------------------------------------------
// period chips
// ---------------------------------------------------------------------------

test('period chips: Season · This week · the last two final days; each chip is its own window', () => {
  const finalBuckets = ['2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14'];
  const chips = home.periodChips({ span: 'season', unit: 'day', finalBuckets });
  assert.deepEqual(chips.map((c) => c.label), ['Season', 'This week', 'Oct 14', 'Oct 13']);
  const today = '2026-10-15';   // a Thursday: its week began Tue Oct 13
  assert.deepEqual(home.windowFor('season', { span: 'season', unit: 'day', finalBuckets, today }), finalBuckets);
  assert.deepEqual(home.windowFor('week', { span: 'season', unit: 'day', finalBuckets, today }), ['2026-10-13', '2026-10-14']);
  assert.deepEqual(home.windowFor('2026-10-13', { span: 'season', unit: 'day', finalBuckets, today }), ['2026-10-13']);
  assert.equal(home.parsePeriod('junk', chips), 'season', 'an unknown chip falls to the first');
  // A daily league's chips ARE its days, newest first.
  assert.deepEqual(home.periodChips({ span: 'daily', unit: 'day', finalBuckets }).map((c) => c.key), ['2026-10-14', '2026-10-13', '2026-10-12']);
  // The table builder honours the chip: one day's table has one bucket.
  const ms = [{ userId: 1, handle: 'a' }];
  const res = (day, score) => ({ userId: 1, game: 'daily', sport: 'all', period: day, bucket: day, score, final: true });
  const t = buildTable({
    league: { span: 'season', scoring: 'total', format: 'table' }, members: ms, unit: 'day',
    results: finalBuckets.map((d) => res(d, 10)), period: '2026-10-13', now: new Date('2026-10-15T16:00:00Z'),
  });
  assert.deepEqual(t.standings.buckets, ['2026-10-13']);
  assert.equal(t.standings.rows[0].total, 10);
  assert.deepEqual(t.extras[1], { played: 1, best: 10 });
});

test('the second tab is TODAY ("This day" is gone); a weekly league reads THIS WEEK', () => {
  assert.equal(home.tabLabel('today', 'day'), 'Today');
  assert.equal(home.tabLabel('today', 'week'), 'This week');
  assert.ok(!/This day|`This \$\{unitWord\}`/.test(src('components/leagues/LeagueBoard.js')));
});

// ---------------------------------------------------------------------------
// crew points
// ---------------------------------------------------------------------------

test('crew points: 10, 8, 6, 5, 4, 3 by finish, 0 after 6th; ties share the higher place', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(crew.crewPointsFor), [10, 8, 6, 5, 4, 3, 0, 0]);
  const finish = crew.awardWeek(new Map([[1, 100], [2, 100], [3, 80], [4, 70], [5, 70], [6, 10]]));
  assert.deepEqual([...finish].map(([u, v]) => [u, v.place, v.points]),
    [[1, 1, 10], [2, 1, 10], [3, 3, 6], [4, 4, 5], [5, 4, 5], [6, 6, 3]]);
});

test('crew table: only FINAL game-weeks award; a Daily week adds up its days; no entry scores 0', () => {
  const ms = [{ userId: 1, handle: 'a' }, { userId: 2, handle: 'b' }, { userId: 3, handle: 'c' }];
  const d = (u, day, score, final = true) => ({ userId: u, game: 'daily', sport: 'all', period: day, bucket: day, score, final });
  const p = (u, wk, score, final = true) => ({ userId: u, game: 'pickem', sport: 'nfl', period: `2026-w${wk}`, bucket: wk === 6 ? '2026-10-06' : '2026-10-13', score, final });
  const results = [
    // Week of Oct 6: Daily - a 1500 over two days beats b 1200; c did not play.
    d(1, '2026-10-06', 700), d(1, '2026-10-07', 800), d(2, '2026-10-06', 1200),
    // Pick'em week 6: b 9, c 9 (tied 1st), a 4.
    p(1, 6, 4), p(2, 6, 9), p(3, 6, 9),
    // Week of Oct 13 (not over on Oct 15): provisional only.
    d(3, '2026-10-13', 5000, true), p(1, 7, 12, false),
  ];
  const now = new Date('2026-10-15T16:00:00Z');
  const t = crew.crewTable({ members: ms, results, now });
  const byId = Object.fromEntries(t.rows.map((r) => [r.userId, r]));
  assert.equal(byId[1].total, 10 + 6, 'a: Daily 1st (10) + Pick\'em 3rd (6)');
  assert.equal(byId[2].total, 8 + 10, 'b: Daily 2nd (8) + Pick\'em tied 1st (10)');
  assert.equal(byId[3].total, 10, 'c: no Daily entry (0) + Pick\'em tied 1st (10); this week not yet');
  assert.deepEqual(t.rows.map((r) => r.userId), [2, 1, 3]);
  assert.deepEqual(byId[2].wins, { pickem: 1 });
  assert.equal(crew.winsLine({ daily: 3, pickem: 1 }, (g) => (g === 'daily' ? 'Daily' : "Pick'em")), "Won Daily 3 wks · Pick'em 1 wk");

  const wk = crew.crewThisWeek({ members: ms, results, now });
  assert.equal(wk.week, '2026-10-13');
  assert.deepEqual(wk.leaders.map((l) => [l.game, l.userIds]), [['daily', [3]], ['pickem', [1]]]);
  assert.equal(wk.points.get(3), 10);

  assert.equal(crew.isCrewLeague(['daily', 'pickem']), true);
  assert.equal(crew.isCrewLeague(['daily']), false);
  assert.match(crew.CREW_EXPLAINER, /10, 8, 6, 5, 4, 3/);
});

// ---------------------------------------------------------------------------
// events: derived once, written once
// ---------------------------------------------------------------------------

test('events: a finished day names its winner; a lead change is "took 1st"; nothing provisional', () => {
  const ms = [{ userId: 1 }, { userId: 2 }];
  const res = (u, day, score, final = true) => ({ userId: u, game: 'daily', sport: 'all', period: day, bucket: day, score, final });
  const evs = events.deriveEvents({
    league: { span: 'season', scoring: 'total', format: 'table', games: ['daily'] }, members: ms, unit: 'day',
    now: new Date('2026-10-15T16:00:00Z'),
    results: [res(1, '2026-10-12', 100), res(2, '2026-10-12', 200), res(1, '2026-10-13', 400), res(2, '2026-10-13', 50),
      res(1, '2026-10-15', 9999, false)],
  });
  const key = (e) => `${e.kind}:${e.userId}:${e.periodKey}`;
  assert.deepEqual(evs.map(key).sort(), ['period_winner:1:2026-10-13', 'period_winner:2:2026-10-12', 'took_first:1:2026-10-13']);
  assert.equal(evs.find((e) => e.kind === 'took_first').payload.from, 2);
  assert.equal(home.eventLine({ kind: 'took_first', userId: 1, payload: { from: 2 } }, (u) => (u === 1 ? 'You' : '@sarahk')), 'You took 1st from @sarahk');
  assert.equal(home.eventLine({ kind: 'period_winner', userId: 2, payload: { score: 2388.5 }, periodLabel: 'Wed, Oct 14' }, () => '@coachb'), '@coachb won Wed, Oct 14 · 2,388.5');
});

const NS = `lhtest-${process.pid}-${Date.now()}`;
const userIds = [];
const leagueIds = [];
const FUTURE = { nfl: { season: 2026, week: 99, at: '2099-01-01T00:00:00.000Z' }, day: { date: '2099-01-01', at: '2099-01-01T05:00:00.000Z' } };
async function mkUser(tag) {
  const [u] = await sql`INSERT INTO users (email, handle) VALUES (${`${NS}-${tag}@example.invalid`}, ${`lh${process.pid % 100000}${tag}`.slice(0, 20)}) RETURNING id`;
  userIds.push(u.id);
  return u.id;
}
const S = { games: ['daily'], span: 'season', scoring: 'total', format: 'table', maxMembers: 12, lateJoins: true };

let owner; let co; let m1; let m2; let lg;
before(async () => {
  owner = await mkUser('o'); co = await mkUser('c'); m1 = await mkUser('m1'); m2 = await mkUser('m2');
  const r = await core.createLeague(owner, `Test home ${NS.slice(-6)}`, S, { anchors: FUTURE, survivor: false });
  assert.equal(r.ok, true, r.reason);
  lg = { id: r.leagueId, code: r.joinCode };
  leagueIds.push(lg.id);
  for (const u of [co, m1, m2]) assert.equal((await invite.joinByInvite(u, lg.code)).ok, true);
});

after(async () => {
  if (leagueIds.length) await sql`DELETE FROM player_leagues WHERE id = ANY(${leagueIds})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM player_leagues WHERE id = ANY(${leagueIds}))
         + (SELECT count(*) FROM league_members WHERE league_id = ANY(${leagueIds}))
         + (SELECT count(*) FROM league_events WHERE league_id = ANY(${leagueIds}))
         + (SELECT count(*) FROM league_removals WHERE league_id = ANY(${leagueIds})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('EVENTS ARE WRITTEN ONCE: a join line per member, and a re-run writes nothing', async () => {
  const joins = await sql`SELECT user_id FROM league_events WHERE league_id = ${lg.id} AND kind = 'join' ORDER BY user_id`;
  assert.deepEqual(joins.map((r) => r.user_id).sort((a, b) => a - b), [owner, co, m1, m2].sort((a, b) => a - b), 'owner (create) + three joins');
  // A repeat join is "already", and writes no second line.
  assert.equal((await invite.joinByInvite(m1, lg.code)).already, true);
  await events.writeJoinEvent(lg.id, m1);
  const evs = [
    { kind: 'period_winner', userId: m1, periodKey: '2026-10-13', payload: { score: 10, bucket: '2026-10-13' }, endsOn: '2026-10-14' },
    { kind: 'took_first', userId: m1, periodKey: '2026-10-13', payload: { from: owner, bucket: '2026-10-13' }, endsOn: '2026-10-14' },
  ];
  assert.equal(await events.insertEvents(lg.id, evs), 2);
  assert.equal(await events.insertEvents(lg.id, evs), 0, 'the hourly tick re-deriving the season writes nothing new');
  const [{ n }] = await sql`SELECT count(*)::int n FROM league_events WHERE league_id = ${lg.id}`;
  assert.equal(n, 6);
  const latest = await events.latestEvents(lg.id, { limit: 3 });
  assert.equal(latest.length, 3);
  assert.equal(latest[0].kind === 'period_winner' || latest[0].kind === 'took_first' || latest[0].kind === 'join', true);
  // The writers sit in the existing paths.
  assert.match(src('lib/leagues/invite.js'), /writeJoinEvent\(lg\.id, uid\)/);
  assert.match(src('lib/leagues/core.js'), /INSERT INTO league_events \(league_id, kind, user_id, period_key\) SELECT id, 'join'/);
  assert.match(src('lib/leagues/guillotine.js'), /VALUES \(\$\{league\.id\}, 'chopped'/);
  assert.match(src('app/api/cron/leagues-tick/route.js'), /settleAllLeagueEvents\(\{ now \}\)/);
});

// ---------------------------------------------------------------------------
// the Members tab: who may do what
// ---------------------------------------------------------------------------

test('permissions, PURE: owner promotes and removes; a co-admin removes plain members only; nobody acts on the owner', () => {
  const can = (action, actor, target, self = false) => members.canAct(action, { actor, target, self });
  assert.equal(can('promote', 'owner', 'member'), true);
  assert.equal(can('demote', 'owner', 'co_admin'), true);
  assert.equal(can('promote', 'co_admin', 'member'), false, 'only the owner makes co-admins');
  assert.equal(can('remove', 'owner', 'co_admin'), true);
  assert.equal(can('remove', 'co_admin', 'member'), true);
  assert.equal(can('remove', 'co_admin', 'co_admin'), false);
  assert.equal(can('remove', 'member', 'member'), false);
  assert.equal(can('remove', 'owner', 'owner', true), false, 'not yourself');
  assert.equal(can('remove', 'co_admin', 'owner'), false);
  assert.equal(can('leave', 'owner'), false);
  assert.equal(can('leave', 'member'), true);
  assert.equal(can('remove', null, 'member'), false, 'a non-member can do nothing');
  assert.deepEqual(members.menuFor({ actor: 'owner', target: 'member' }).map((m) => m.action), ['promote', 'remove']);
  assert.deepEqual(members.menuFor({ actor: 'member', target: 'member' }), [], 'a member sees no menu');
});

test('permissions, ON DEV: the writes re-check the rows - and a removed member cannot walk back in', async () => {
  assert.equal((await members.setMemberRole(co, lg.id, m1, 'co_admin')).ok, false, 'a member cannot promote');
  assert.equal((await members.setMemberRole(owner, lg.id, co, 'co_admin')).ok, true);
  assert.equal((await members.setMemberRole(owner, lg.id, owner, 'co_admin')).ok, false, 'the owner has no role row to change');
  assert.equal((await members.removeMember(m1, lg.id, m2)).ok, false, 'a member cannot remove');
  assert.equal((await members.removeMember(co, lg.id, owner)).ok, false, 'nobody removes the owner');
  assert.equal((await members.leaveLeague(owner, lg.id)).code, 'owner_cannot_leave');

  assert.equal((await members.removeMember(co, lg.id, m2)).ok, true, 'a co-admin removes a plain member');
  assert.equal((await sql`SELECT 1 FROM league_members WHERE league_id = ${lg.id} AND user_id = ${m2}`).length, 0);
  const back = await invite.joinByInvite(m2, lg.code);
  assert.equal(back.ok, false);
  assert.equal(back.reason, REFUSALS.removed, 'the code does not undo a removal');

  assert.equal((await members.setMemberRole(owner, lg.id, co, 'member')).ok, true, 'the owner takes co-admin back');
  assert.equal((await members.removeMember(co, lg.id, m1)).ok, false, 'no longer a co-admin: refused');

  const prefs = await members.setNotifyPrefs(m1, lg.id, { joins: true, chat: false });
  assert.deepEqual(prefs.prefs, { chat: false, results: true, joins: true }, 'stored; untouched toggles keep their default');
  assert.equal((await members.setNotifyPrefs(m2, lg.id, { chat: true })).ok, false, 'a removed member has no toggles');

  assert.equal((await members.leaveLeague(m1, lg.id)).ok, true);
  assert.equal((await invite.joinByInvite(m1, lg.code)).ok, true, 'leaving is not a removal: the code still works');
});

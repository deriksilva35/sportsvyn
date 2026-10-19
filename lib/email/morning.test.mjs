// lib/email/morning.test.mjs - the morning email (ruling thu-1, built sun-2): the
// audience rule, once per user per ET day, hard bounces never mailed, the kill
// switch, and the template.
//
// Fixture: SENTINEL users (mtest-...@example.invalid), one sentinel Daily board
// (edition 1998-01-xx), webhook bounce rows to a sentinel address. after()
// deletes every one and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const aud = await import('./morningAudience.js');
const ms = await import('./morningSend.js');
const { buildMorningEmail, morningSubject, MORNING_FOOTER } = await import('../emails/morning.js');
const { sql } = await import('../db.js');

const NS = `mtest-${process.pid}-${Date.now()}`;
const U = {};
let boardId;

async function mkUser(tag, { daysOld = 100, pref = null, optedOut = false, house = false } = {}) {
  const [u] = await sql`
    INSERT INTO users (email, created_at, morning_email, email_opted_out_at, is_house)
    VALUES (${`${NS}-${tag}@example.invalid`}, now() - make_interval(days => ${daysOld}), ${pref},
            ${optedOut ? new Date().toISOString() : null}, ${house})
    RETURNING id`;
  U[tag] = u.id;
  return u.id;
}
const played = (uid, daysAgo) => sql`
  INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, completed_at, started_at)
  VALUES (${boardId}, ${uid}, '[]'::jsonb, 1000, 50, 1, 60, now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`;

before(async () => {
  const [b] = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES (${`1998-01-${String(10 + (process.pid % 18)).padStart(2, '0')}`}, 1998, ${NS}, '[]'::jsonb, 100, '[]'::jsonb, '[]'::jsonb,
            '1998-01-01T00:00:00Z', '1998-01-02T00:00:00Z')
    RETURNING id`;
  boardId = b.id;
  await played(await mkUser('active'), 5);
  await played(await mkUser('dormant'), 40);
  await mkUser('new', { daysOld: 3 });
  await mkUser('optedin', { pref: true });
  await played(await mkUser('optedout', { pref: false }), 2);
  await played(await mkUser('unsub', { optedOut: true }), 2);
  await played(await mkUser('bounced'), 2);
  await played(await mkUser('house', { house: true }), 2);
  await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
            VALUES ('resend-webhook', 'bounced', now(), now(), false, ${JSON.stringify({ to: `${NS}-bounced@example.invalid`, outcome: 'bounced' })}::jsonb)`;
});

after(async () => {
  const ids = Object.values(U);
  await sql`DELETE FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ANY(${ids})`;
  await sql`DELETE FROM sync_runs WHERE source = 'resend-webhook' AND summary->>'to' LIKE ${`${NS}-%`}`;
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
  await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM daily_boards WHERE id = ${boardId})
         + (SELECT count(*) FROM sync_runs WHERE source = 'morning-email' AND (summary->>'userId')::int = ANY(${ids})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('THE RULE (thu-1), PURE: 30-day players, new accounts, /you opt-ins; dormant get nothing', () => {
  const e = aud.morningEligible;
  assert.equal(e({ playedDaysAgo: 5 }), true, '(a) played in 30 days');
  assert.equal(e({ playedDaysAgo: 31, ageDays: 400 }), false, 'dormant: nothing');
  assert.equal(e({ ageDays: 3 }), true, '(b) a new account');
  assert.equal(e({ ageDays: 14 }), false, '14 days is no longer new');
  assert.equal(e({ pref: true, playedDaysAgo: null, ageDays: 400 }), true, '(c) turned ON at /you');
  assert.equal(e({ pref: false, playedDaysAgo: 1 }), false, 'turned OFF wins over the rule');
  for (const k of ['optedOut', 'house', 'owner', 'bounced']) assert.equal(e({ pref: true, playedDaysAgo: 1, [k]: true }), false, k);
  assert.equal(e({ playedDaysAgo: 1, hasAddress: false }), false);
});

test('THE AUDIENCE ON DEV: exactly active / new / opted-in of the fixture, with their reasons', async () => {
  const rows = (await aud.morningAudience(sql, { owners: [] })).filter((r) => Object.values(U).includes(Number(r.id)));
  const got = Object.fromEntries(rows.map((r) => [Object.keys(U).find((k) => U[k] === Number(r.id)), r.why]));
  assert.deepEqual(got, { active: 'active', new: 'new', optedin: 'opted_in' },
    'not dormant, not opted out, not unsubscribed, not hard-bounced, not house');
});

test('THE RUN: off by default; once per user per ET day; a bounce is never mailed', async () => {
  const sent = [];
  const deps = {
    send: async (m) => { sent.push(m); return { data: { id: `fake-${sent.length}` } }; },
    unsubscribeUrlFor: async (id) => `https://sportsvyn.com/api/email/unsubscribe?u=${id}`,
    clickUrlFor: ({ to }) => to, unsubscribeHeaders: () => ({}),
  };
  const only = Object.values(U);
  delete process.env.MORNING_EMAIL;
  assert.deepEqual(await ms.runMorning({ ...deps, onlyUserIds: only }), { day: ms.etDay(), decision: 'skipped-off' }, 'the kill switch defaults OFF');
  assert.equal(sent.length, 0);

  const first = await ms.runMorning({ ...deps, force: true, onlyUserIds: only });
  assert.equal(first.sent, 3);
  assert.deepEqual(sent.map((m) => m.to).sort(), [`${NS}-active@example.invalid`, `${NS}-new@example.invalid`, `${NS}-optedin@example.invalid`].sort());
  assert.ok(!sent.some((m) => m.to.includes('-bounced')), 'hard bounce never mailed');
  const second = await ms.runMorning({ ...deps, force: true, onlyUserIds: only });
  assert.equal(second.sent, 0, 'a second firing the same ET day mails nobody');
  assert.equal(second.skipped, 3);
  const rows = await sql`SELECT summary FROM sync_runs WHERE source = 'morning-email' AND kind = 'send' AND (summary->>'userId')::int = ANY(${only})`;
  assert.equal(rows.length, 3, 'one ledger row per reader per day');
  assert.ok(rows.every((r) => r.summary.outcome === 'sent' && r.summary.day === ms.etDay()));
  assert.ok(sent.every((m) => /Unsubscribe/.test(m.html) && /Play today's Daily/.test(m.html)));
});

test('THE CRON: kill switch first, 15:00Z, watched; the switch reads only MORNING_EMAIL=on', () => {
  assert.equal(ms.morningEnabled({}), false);
  assert.equal(ms.morningEnabled({ MORNING_EMAIL: 'off' }), false);
  assert.equal(ms.morningEnabled({ MORNING_EMAIL: 'on' }), true);
  const route = src('app/api/cron/morning-email/route.js');
  assert.ok(route.indexOf('if (!morningEnabled())') < route.indexOf('runMorning('), 'off means no run at all');
  assert.match(route, /const SOURCE = 'morning-email';/);
  assert.equal(ms.SOURCE, 'morning-email');
  const crons = JSON.parse(src('vercel.json')).crons;
  assert.ok(crons.some((c) => c.path === '/api/cron/morning-email' && c.schedule === '0 15 * * *'));
  assert.match(src('lib/ops/cronWatchdog.js'), /job: 'morning-email', path: '\/api\/cron\/morning-email', source: 'morning-email', schedule: '0 15 \* \* \*'/);
  assert.match(src('scripts/morning-email.mjs'), /if \(!OWNER_ADDRESSES\.includes\(to\)\)/, 'a test goes only to an owner address');
});

const mods = await import('./morningModules.js');

test('COUNTS = /scores (mon-3): every day the email and the scoreboard both show, the same number of games', async () => {
  const { scoresV2 } = await import('../gridiron/scoresV2.js');
  const now = new Date();
  const [dayData, v] = await Promise.all([ms.loadDay(ms.etDay(now), { now }), scoresV2({ now })]);
  const total = (date) => {
    const i = dayData.week?.days.findIndex((d) => d.date === date) ?? -1;
    return i < 0 ? null : dayData.week.rows.reduce((s, r) => s + r.cells[i], 0);
  };
  let compared = 0;
  for (const d of v.days) {
    const mine = total(d.date);
    if (mine == null) continue;
    const c = d.counts ?? { live: 0, final: 0, scheduled: 0 };
    assert.equal(mine, c.live + c.final + c.scheduled, `${d.date}: email ${mine} vs /scores ${c.live + c.final + c.scheduled}`);
    compared += 1;
  }
  assert.ok(compared >= 1 || !dayData.week, 'at least one day compared');
});

test('IF NEEDED (mon-3): the next game is certain; a later one is starred when a club could clinch before it', () => {
  const s = (id, day, status, winner = null) => ({ id, kickoffAt: `2026-10-${day}T00:00:00Z`, status, winner });
  // The 2026 ALCS on PROD: CLE 2, TB 3, a postponed row, then games 6 and 7.
  const series = [s(1, 13, 'final', 'CLE'), s(2, 14, 'final', 'TB'), s(3, 15, 'final', 'CLE'), s(4, 17, 'postponed'),
    s(5, 18, 'final', 'TB'), s(6, 18, 'final', 'TB'), s(7, 20, 'scheduled'), s(8, 21, 'scheduled')];
  assert.equal(mods.ifNeeded(series[6], series, { stage: 'championship', homeConf: 'American' }), null, 'Game 6 is certain');
  assert.deepEqual(mods.ifNeeded(series[7], series, { stage: 'championship', homeConf: 'American' }), { gameNumber: 7, label: 'ALCS Game 7, only if needed' });
  assert.equal(mods.countsAsGame({ status: 'not_needed' }), false, "a decided series' leftover is not a game");
  assert.equal(mods.countsAsGame({ status: 'postponed' }), true, '/scores still lists a postponed game');
  const w = mods.weekGrid({ days: ['2026-10-19', '2026-10-20'], today: '2026-10-20', counts: [{ league: 'mlb', day: '2026-10-19', n: 1 }, { league: 'mlb', day: '2026-10-20', n: 1 }],
    maybes: [{ league: 'mlb', day: '2026-10-20', label: 'ALCS Game 7, only if needed' }] });
  assert.deepEqual(w.rows[0].starred, [false, true]);
  assert.deepEqual(w.notes, ['* ALCS Game 7, only if needed']);
  const html = buildMorningEmail({ day: '2026-10-20', wordmarkUrl: 'w', links: { daily: 'd', unsubscribe: 'u' }, m: { week: w } }).html;
  assert.ok(html.includes('1*') && html.includes('* ALCS Game 7, only if needed'));
});

test('1 HEADLINE: opening night, a playoff round, MNF, else the counts; none on an empty day', () => {
  const g = (league, extra = {}) => ({ league, away: 'A', home: 'B', kickoffAt: '2026-10-20T23:00:00Z', dow: 'Tue', ...extra });
  assert.equal(mods.headlineFor({ games: [] }), null);
  assert.equal(mods.headlineFor({ games: [g('nba'), g('nba'), g('cfb')], openers: ['nba'] }), 'NBA opening night: 2 games');
  assert.equal(mods.headlineFor({ games: [g('mlb', { stage: 'championship', homeConf: 'American', away: 'Guardians', home: 'Rays' })] }), 'ALCS: Guardians at Rays');
  assert.equal(mods.headlineFor({ games: [g('mlb', { stage: 'championship', homeConf: 'American' }), g('mlb', { stage: 'championship', homeConf: 'National' })] }), 'ALCS and NLCS: 2 games today');
  assert.equal(mods.headlineFor({ games: [g('ucl', { stage: 'league' }), g('ucl', { stage: 'league' })] }), '2 games today: 2 UCL', "UCL's league phase is not a playoff");
  assert.equal(mods.headlineFor({ games: [g('nfl', { dow: 'Mon', away: 'Bears', home: 'Lions' })] }), 'Monday Night Football: Bears at Lions');
  assert.equal(mods.headlineFor({ games: [g('cfb'), g('cfb'), g('nba')] }), '3 games today: 2 CFB · 1 NBA');
});

test('2 YESTERDAY\'S DAILY: the answer, how many played, the top 3; hidden when nobody played', () => {
  const board = { seasonYear: 2013, ceiling: 2146, best: [{ name: 'Andrew Luck', slot: 'QB' }, { name: 'Matt Forte', slot: 'RB' }] };
  assert.equal(mods.yesterdayDaily({ board, played: 0 }), null);
  assert.equal(mods.yesterdayDaily({ board: null, played: 9 }), null);
  const y = mods.yesterdayDaily({ board, played: 41, top: [{ name: '@a', score: 2000 }, { name: '@b', score: 1900 }, { name: '@c', score: 1800 }, { name: '@d', score: 1 }] });
  assert.equal(y.answer, '2013 season. The perfect lineup scored 2,146: Andrew Luck QB, Matt Forte RB.');
  assert.equal(y.top.length, 3);
});

test('4 THIS WEEK: counts by sport Mon-Sun, today marked, empty sports dropped; hidden on an empty week', () => {
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  assert.equal(mods.weekGrid({ days, counts: [], today: days[1] }), null);
  const w = mods.weekGrid({ days, today: days[1], counts: [{ league: 'nba', day: days[1], n: 2 }, { league: 'nfl', day: days[6], n: 12 }, { league: 'nfl', day: days[0], n: 1 }] });
  assert.deepEqual(w.days.map((d) => d.dow), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(w.days.filter((d) => d.today).map((d) => d.dow), ['Tue']);
  assert.deepEqual(w.rows.map((r) => [r.league, r.cells.join(',')]), [['NFL', '1,0,0,0,0,0,12'], ['NBA', '0,2,0,0,0,0,0']]);
});

test('5 GAME OF THE DAY: playoff > rivalry > closest line > earliest', () => {
  const g = (o) => ({ league: 'nfl', away: 'A', home: 'B', kickoffAt: '2026-10-20T17:00:00Z', ...o });
  const close = g({ spread: 1.5, home: 'Close' });
  const rival = g({ homeDiv: 'NFC North', awayDiv: 'NFC North', spread: 9, home: 'Rival' });
  const cfbRival = g({ league: 'cfb', homeConf: 'SEC', awayConf: 'SEC', spread: 20, home: 'CfbRival' });
  const po = g({ league: 'mlb', stage: 'championship', spread: 30, home: 'Playoff' });
  assert.equal(mods.pickGameOfDay([close, rival, po]).home, 'Playoff');
  assert.equal(mods.pickGameOfDay([close, rival]).why, 'rivalry');
  assert.equal(mods.pickGameOfDay([close, cfbRival]).home, 'CfbRival', 'same conference is a CFB rivalry');
  assert.equal(mods.pickGameOfDay([g({ spread: 7 }), close]).home, 'Close');
  assert.equal(mods.pickGameOfDay([g({ league: 'ucl', stage: 'league', home: 'UCL' }), close]).home, 'Close', 'a league-phase game is not a playoff');
  assert.equal(mods.pickGameOfDay([]), null);
});

test('6 FREE TO PLAY: three open games, one per game, soonest lock first; hidden when none', () => {
  assert.equal(mods.freeToPlay([]), null);
  const c = (label, h) => ({ label, path: '/x', locksAt: `2026-10-20T${String(h).padStart(2, '0')}:00:00Z` });
  assert.deepEqual(mods.freeToPlay([c('Weekly', 23), c('EPL', 15), c('EPL', 16), c('October', 21), c('Run', 22)]).map((x) => x.label), ['EPL', 'October', 'Run']);
});

test('7 YOUR MOVE: players only, and only with something to say', () => {
  assert.equal(mods.yourMove({ player: false, yesterday: { score: 1 } }), null);
  assert.equal(mods.yourMove({ player: true }), null);
  assert.deepEqual(mods.yourMove({ player: true, locks: [{ label: 'Weekly' }] }), { yesterday: null, locks: [{ label: 'Weekly' }] });
});

test('8 SPOTLIGHT: one a day in rotation; "Get the app" only without an iOS device', () => {
  const four = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((d) => mods.spotlightFor(d).key);
  assert.deepEqual([...new Set(four)].sort(), ['leagues', 'live-activity', 'mock-drafts', 'widgets'], 'four days, four features');
  assert.equal(mods.spotlightFor('2026-10-23').key, mods.spotlightFor('2026-10-19').key, 'and around again');
  assert.equal(mods.spotlightFor('2026-10-20', { hasIosDevice: true }).appLink, false);
  assert.equal(mods.spotlightFor('2026-10-20', { hasIosDevice: false }).appLink, true);
});

test('0 HERO (mon-1 addendum): only on an opener day, the button to the board, the confidence line only once the board exists', () => {
  const g = (league, h, extra = {}) => ({ league, away: `A${h}`, home: `B${h}`, kickoffAt: `2026-10-20T${String(h).padStart(2, '0')}:00:00Z`, ...extra });
  const games = [g('nba', 23), g('nba', 19), g('mlb', 22, { stage: 'championship' })];
  const tipTime = () => '7:00 PM ET / 4:00 PM PT';
  assert.equal(mods.heroFor({ openers: [], games, tipTime }), null, 'the default is no hero');
  assert.equal(mods.heroFor({ openers: ['wnba'], games, tipTime }), null, 'a league not in the opener list: no hero');
  assert.equal(mods.heroFor({ openers: ['nba'], games: [g('mlb', 22)], tipTime }), null, 'no games of that league: no hero');
  const noBoard = mods.heroFor({ openers: ['nba'], games, tipTime });
  assert.equal(noBoard.eyebrow, 'NBA IS BACK');
  assert.equal(noBoard.path, '/pickem/nba', "the button goes to tonight's NBA board (the page opens the current one)");
  assert.deepEqual(noBoard.games.map((x) => x.away), ['A19', 'A23'], 'tonight\'s games in tip order');
  assert.equal(noBoard.confidenceLine, null, 'board not built yet: the confidence line hides');
  assert.equal(noBoard.prep.path, '/mock/nba');
  assert.equal(mods.heroFor({ openers: ['nba'], games, tipTime, boards: { nba: { confidence: true } } }).confidenceLine, 'New: rank your picks by confidence');
  assert.equal(mods.heroFor({ openers: ['nba'], games, tipTime, boards: { nba: { confidence: false } } }).confidenceLine, null);
  assert.equal(mods.heroSubject(noBoard), 'NBA opening night: 2 games tonight - make your picks');
  assert.equal(noBoard.spotlight.title, 'The Sportsvyn app', 'opener day spotlight: the app');
  assert.ok(mods.SEASON_OPENERS.every((c) => c.league && c.path && c.eyebrow), 'the config list: add NFL, CFB, MLB, EPL later');
  // The template leads with it, above the headline, and the subject is the hero's.
  const links = { daily: 'https://s/d', scores: 'https://s/s', unsubscribe: 'https://s/u', app: 'https://a' };
  const mail = buildMorningEmail({ day: '2026-10-20', wordmarkUrl: 'w', links, m: {
    hero: { ...noBoard, href: 'https://s/pickem/nba', prepHref: 'https://s/mock/nba', subject: mods.heroSubject(noBoard) },
    headline: 'NBA opening night: 2 games',
  } });
  assert.equal(mail.subject, 'NBA opening night: 2 games tonight - make your picks');
  assert.ok(mail.html.indexOf('NBA IS BACK') < mail.html.lastIndexOf('NBA opening night: 2 games<'), 'hero above the headline line');
  assert.ok(mail.html.includes('href="https://s/pickem/nba"') && mail.html.includes('Draft prep: run an NBA mock'));
  assert.ok(!mail.html.includes('rank your picks by confidence'), 'hidden cleanly without the board');
  assert.ok(!buildMorningEmail({ day: '2026-10-21', wordmarkUrl: 'w', links }).html.includes('NBA IS BACK'), 'any other day: no hero');
  // On an opener day the game of the day is the opener league's (morningSend filters the pool).
  assert.match(src('lib/email/morningSend.js'), /\(!hero \|\| g\.league === hero\.league\)/);
});

test('THE TEMPLATE: every module hides when empty, in the spec order; hyphens only; no coins; a way out', () => {
  const links = { daily: 'https://s/d', scores: 'https://s/s', game: 'https://s/g', unsubscribe: 'https://s/u', app: 'https://apps.apple.com/x' };
  const bare = buildMorningEmail({ day: '2026-10-20', wordmarkUrl: 'https://s/w.png', links });
  assert.equal(bare.subject, "Today's Daily is live - Tue, Oct 20");
  for (const k of ["YESTERDAY'S DAILY", 'THIS WEEK IN SPORTS', 'GAME OF THE DAY', 'FREE TO PLAY', 'YOUR MOVE', 'SPOTLIGHT']) assert.ok(!bare.html.includes(k), `${k} hidden when empty`);
  assert.ok(bare.html.includes("Play today's Daily"), 'the Daily button is always there');
  const full = buildMorningEmail({
    day: '2026-10-20', wordmarkUrl: 'https://s/w.png', links,
    m: {
      headline: 'NBA opening night: 2 games',
      yesterdayDaily: { answer: '2013 season. The perfect lineup scored 2,146: X QB.', played: 41, top: [{ name: '@sarahk', score: 2388.5 }] },
      week: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dow) => ({ dow, today: dow === 'Tue' })), rows: [{ league: 'NBA', cells: [0, 2, 11, 2, 12, 8, 7] }] },
      game: { away: 'Knicks', home: 'Celtics', league: 'NBA', time: '7:30 PM ET', why: 'rivalry' },
      free: [{ label: 'The Weekly', time: 'Tue 8:15 PM ET', href: 'https://s/w' }],
      move: { yesterday: { score: 1500, rank: 3, of: 41 }, locks: [{ label: "Pick'em NFL", time: '8:15 PM ET', href: 'https://s/p' }] },
      spotlight: { title: 'Leagues', line: 'Start a league.', href: 'https://s/l', appLink: true },
    },
  });
  assert.equal(full.subject, "You were 3rd of 41 yesterday - today's Daily is live");
  const order = ['NBA opening night', "YESTERDAY'S DAILY", 'THE DAILY - TUE', 'THIS WEEK IN SPORTS', 'GAME OF THE DAY', 'FREE TO PLAY THIS WEEK', 'YOUR MOVE', 'SPOTLIGHT - LEAGUES', 'Unsubscribe from all email'];
  const at = order.map((k) => full.html.indexOf(k));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the spec order');
  assert.ok(full.html.includes('Get the app') && full.text.includes('Get the app: https://apps.apple.com/x'));
  const noApp = buildMorningEmail({ day: '2026-10-20', wordmarkUrl: 'w', links, m: { spotlight: { title: 'Widgets', line: 'x', href: null, appLink: false } } });
  assert.ok(!noApp.html.includes('Get the app'), 'an iOS device: no app link');
  assert.equal(morningSubject({ day: '2026-10-20', headline: 'NBA opening night: 2 games' }), 'NBA opening night: 2 games - and a new Daily');
  for (const m of [bare, full]) {
    assert.ok(!/[–—]/.test(m.html + m.text + m.subject), 'hyphens only');
    assert.ok(!/coin/i.test(m.html + m.text), 'no coins anywhere');
    assert.ok(m.html.includes('https://s/u') && m.text.includes('https://s/u'), 'the unsubscribe link');
    assert.ok(m.text.includes(MORNING_FOOTER));
  }
  const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['lib/emails/morning.js', 'lib/email/morningModules.js', 'lib/email/morningSend.js']) assert.ok(!/coin/i.test(code(f)), `${f}: no coins in the code`);
  assert.match(src('app/privacy/page.js'), /<strong>Our morning email\.<\/strong>/, 'one line in the privacy policy');
});

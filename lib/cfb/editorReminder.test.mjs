import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReminder, resultLine, runReminder, editorListExists, REMINDER_TO } from './editorReminder.js';

// A fake sql: records every statement; answers by what the statement says.
function fakeSql({ seen = false, rows = [] } = {}) {
  const log = [];
  const sql = async (strings) => {
    const q = strings.join('?');
    log.push(q);
    if (q.includes('FROM sync_runs')) return seen ? [{ id: 1 }] : [];
    if (q.includes('WITH prev')) return rows;
    return [];
  };
  sql.log = log;
  return sql;
}
const g = (is_home, h, a, opp) => ({ is_home, home_score: h, away_score: a, opp });
const ROWS = [
  { ap_rank: 1, name: 'Georgia', wins: 6, losses: 0, sv_prev: 2, game: g(false, 17, 20, 'ALA') },
  { ap_rank: 2, name: 'Miami', wins: 5, losses: 0, sv_prev: 3, game: null },
  { ap_rank: null, name: 'Florida', wins: 4, losses: 2, sv_prev: 9, game: g(false, 38, 19, 'SC') },
];
const send = () => { const calls = []; const f = async (m) => { calls.push(m); }; f.calls = calls; return f; };

test('resultLine reads from the team\'s own side', () => {
  assert.equal(resultLine(g(false, 17, 20, 'ALA')), 'W 20-17 at ALA');
  assert.equal(resultLine(g(true, 24, 27, 'OU')), 'L 24-27 vs OU');
  assert.equal(resultLine(null), 'bye');
});

test('the email carries the table, the fell-out block, and the exact subject', () => {
  const m = renderReminder({ season: 2026, week: 8, rows: ROWS });
  assert.equal(m.subject, 'CFB 25 due - week 8');
  assert.match(m.body, /content\/power\/cfb-2026-w8\.md is not/);
  assert.match(m.body, /1\s+Georgia\s+6-0\s+W 20-17 at ALA\s+2/);
  assert.match(m.body, /Miami\s+5-0\s+bye\s+3/);
  assert.match(m.body, /out of the AP this week:\n-\s+Florida\s+4-2\s+L 19-38 at SC\s+9/);
  const none = renderReminder({ season: 2026, week: 8, rows: ROWS.slice(0, 2) });
  assert.doesNotMatch(none.body, /out of the AP/);
});

test('week 7 has its list, a far week does not (the publisher\'s own meaning of "exists")', () => {
  assert.equal(editorListExists(2026, 7), true);
  assert.equal(editorListExists(2026, 99), false);
});

test('SKIPS when the file exists - no query for rows, no marker, no mail', async () => {
  const sql = fakeSql(); const s = send();
  const out = await runReminder({ sql, send: s, season: 2026, week: 7 });
  assert.equal(out.decision, 'file-exists');
  assert.equal(sql.log.length, 0);
  assert.equal(s.calls.length, 0);
});

test('SKIPS when this week was already sent - once per week', async () => {
  const sql = fakeSql({ seen: true }); const s = send();
  const out = await runReminder({ sql, send: s, season: 2026, week: 99 });
  assert.equal(out.decision, 'already-sent');
  assert.equal(s.calls.length, 0);
});

test('SENDS once: marker written BEFORE the mail, to Derik, subject names the week', async () => {
  const sql = fakeSql({ rows: ROWS }); const s = send();
  const order = [];
  const sql2 = async (strings, ...v) => { const r = await sql(strings, ...v); if (strings.join('?').includes('INSERT INTO sync_runs')) order.push('marker'); return r; };
  const out = await runReminder({ sql: sql2, send: async (m) => { order.push('mail'); await s(m); }, season: 2026, week: 99 });
  assert.equal(out.decision, 'sent');
  assert.deepEqual(order, ['marker', 'mail']);
  assert.equal(s.calls[0].to, REMINDER_TO);
  assert.equal(s.calls[0].subject, 'CFB 25 due - week 99');
});

test('A DRY RUN prints and writes nothing: no marker, no mail, even with no marker present', async () => {
  const sql = fakeSql({ rows: ROWS }); const s = send();
  const out = await runReminder({ sql, send: s, season: 2026, week: 99, dryRun: true });
  assert.equal(out.decision, 'dry-run');
  assert.equal(out.subject, 'CFB 25 due - week 99');
  assert.ok(!sql.log.some((q) => q.includes('INSERT')));
  assert.equal(s.calls.length, 0);
});

test('no AP week in the database says nothing', async () => {
  const out = await runReminder({ sql: fakeSql(), send: send(), readAp: async () => ({ season: null, week: null }) });
  assert.equal(out.decision, 'no-ap-week');
});

test('the cron route is wired: Monday 13:00Z and the 15:30Z retry, auth-gated, injected mailer', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(vercel.crons.map((c) => [c.path, c.schedule]));
  assert.equal(by['/api/cron/cfb-25-reminder'], '0 13 * * 1');
  assert.equal(by['/api/cron/cfb-25-reminder-late'], '30 15 * * 1');
  const late = readFileSync(new URL('../../app/api/cron/cfb-25-reminder-late/route.js', import.meta.url), 'utf8');
  assert.match(late, /cronAuthorized\(request\)/);
  assert.match(late, /runReminderCron\(\)/);
  const route = readFileSync(new URL('../../app/api/cron/cfb-25-reminder/route.js', import.meta.url), 'utf8');
  assert.match(route, /cronAuthorized\(request\)/);
  assert.match(route, /runReminderCron\(\)/);
  assert.match(readFileSync(new URL('./reminderCron.js', import.meta.url), 'utf8'), /runReminder\(/);
  const lib = readFileSync(new URL('./editorReminder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lib, /from '\.\.\/resend/, 'the library never imports the mailer');
});

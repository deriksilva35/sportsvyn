// lib/email/suppression.test.mjs - hard-bounced addresses are never mailed again (fri-3).
//
// Fixture: sync_runs rows with source 'resend-webhook' addressed to
// bouncetest-<pid>-...@example.invalid; after() deletes them and asserts it did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sup = await import('./suppression.js');
const { sql } = await import('../db.js');

const NS = `bouncetest-${process.pid}-${Date.now()}`;
const addr = (tag) => `${NS}-${tag}@example.invalid`;

after(async () => {
  await sql`DELETE FROM sync_runs WHERE source = 'resend-webhook' AND summary->>'to' ILIKE ${`${NS}-%`}`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM sync_runs WHERE source = 'resend-webhook' AND summary->>'to' ILIKE ${`${NS}-%`}`;
  assert.equal(n, 0, 'teardown left nothing behind');
});

test('PURE: a bounce suppresses unless Resend called it Transient; other outcomes never do', () => {
  assert.equal(sup.isHardBounceRow({ kind: 'bounced', summary: {} }), true, 'pre-fri-3 rows carry no type: hard');
  assert.equal(sup.isHardBounceRow({ kind: 'bounced', summary: { bounceType: 'Permanent' } }), true);
  assert.equal(sup.isHardBounceRow({ kind: 'bounced', summary: { bounceType: 'Transient' } }), false);
  for (const kind of ['delivered', 'delayed', 'complained']) assert.equal(sup.isHardBounceRow({ kind, summary: {} }), false, kind);
  assert.equal(sup.norm('  Bob@iCloud.COM '), 'bob@icloud.com');
});

test('ON DEV: a hard bounce suppresses its address (any case); a soft bounce and a delivery do not', async () => {
  const row = (to, kind, extra = {}) => sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES ('resend-webhook', ${kind}, now(), now(), ${kind !== 'bounced'},
            ${JSON.stringify({ to, outcome: kind, messageId: `m-${kind}`, ...extra })}::jsonb)`;
  await row(addr('Hard'), 'bounced');
  await row(addr('typed'), 'bounced', { bounceType: 'Permanent' });
  await row(addr('soft'), 'bounced', { bounceType: 'Transient' });
  await row(addr('ok'), 'delivered');
  assert.equal(await sup.isHardBounced(sql, addr('hard').toUpperCase()), true, 'case-insensitive');
  assert.equal(await sup.isHardBounced(sql, addr('typed')), true);
  assert.equal(await sup.isHardBounced(sql, addr('soft')), false);
  assert.equal(await sup.isHardBounced(sql, addr('ok')), false);
  assert.equal(await sup.isHardBounced(sql, ''), false);
  const all = await sup.hardBouncedAddresses(sql);
  assert.ok(all.includes(addr('hard').toLowerCase()) && all.includes(addr('typed')));
  assert.ok(!all.includes(addr('soft')) && !all.includes(addr('ok')));
});

test('every send path checks first: welcome, broadcast roster, newsletter confirmation', () => {
  const welcome = strip(src('lib/auth/welcomeEmail.js'));
  const check = welcome.indexOf('isHardBounced(sql, to)');
  assert.ok(check > 0, 'the welcome mail asks');
  assert.ok(check < welcome.indexOf('rowId = await recordStart(userId)'), 'before the send row opens');
  assert.match(welcome, /outcome: 'bounced-suppressed'/);
  const roster = strip(src('scripts/broadcast.mjs'));
  assert.match(roster, /const bounced = await hardBouncedAddresses\(sql\);/);
  assert.match(roster, /AND NOT \(lower\(trim\(COALESCE\(contact_email, email\)\)\) = ANY\(\$\{bounced\}\)\)/, 'a WHERE clause, not a filter after');
  const signup = strip(src('app/api/email/signup/route.js'));
  assert.ok(signup.indexOf('isHardBounced(sql, to)') < signup.indexOf('resend.emails.send'));
  assert.match(strip(src('app/api/webhooks/resend/route.js')), /bounceType: evt\?\.data\?\.bounce\?\.type \?\? null/);
});

// EVERY CALL SITE, BY WALKING - the morning email inherits this when it is built.
const EXEMPT = {
  'auth.js': 'the sign-in code: the person is at the keyboard asking for it',
  'lib/pollers/alerts.js': "the owner's own operational alerts",
  'lib/cfb/reminderCron.js': "the editor reminder to the owner's address",
};
function walk(dir, out = []) {
  for (const f of readdirSync(path.join(REPO, dir))) {
    if (['node_modules', '.next', 'test-tmp', '.git'].includes(f)) continue;
    const rel = path.join(dir, f);
    if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel, out);
    else if (/\.(m?js)$/.test(f) && !/\.test\.mjs$/.test(f)) out.push(rel);
  }
  return out;
}

test('THE GUARD: every resend.emails.send() file imports the suppression check or is exempt by name', () => {
  const files = [...walk('app'), ...walk('lib'), ...walk('scripts'), 'auth.js'];
  const senders = files.filter((f) => /\bemails\.send\(/.test(strip(src(f))));
  assert.ok(senders.length >= 6, `the walker sees the senders (${senders.join(', ')})`);
  const open = senders.filter((f) => !EXEMPT[f] && !/email\/suppression/.test(src(f)));
  assert.deepEqual(open, [], 'a new sender must check lib/email/suppression.js first, or be exempt with a reason');
  for (const f of Object.keys(EXEMPT)) assert.ok(senders.includes(f), `${f}: stale exemption`);
});

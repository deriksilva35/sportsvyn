// scripts/morning-email.mjs - the morning email by hand (sun-2): count, preview, test send.
//
//   node scripts/morning-email.mjs --count                               DEV audience, read-only
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/morning-email.mjs --count --prod
//   ... --preview /tmp/x.html [--as <userId>]                            render, send nothing
//   ... --test derik@sportsvyn.com [--as <userId>] --prod                ONE mail to an owner address
//
// A TEST GOES ONLY TO AN OWNER ADDRESS (lib/email/owners.js), rendered as the
// account given by --as (default: the first audience member), and is ledgered as
// kind 'test' - it never counts as that reader's send for the day. The real run
// is the cron, behind MORNING_EMAIL=on.
//
// Credentials from the environment only. --prod is required exactly when
// DATABASE_URL is PROD_DATABASE_URL (the same guard as link-draft-league.mjs).

import { writeFileSync } from 'node:fs';
import { sql } from '../lib/db.js';
import { morningAudience } from '../lib/email/morningAudience.js';
import { OWNER_ADDRESSES } from '../lib/email/owners.js';
import { loadDay, loadReader, composeFor, etDay, resendSend, SOURCE } from '../lib/email/morningSend.js';
import { unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders } from '../lib/auth/welcomeEmail.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const has = (k) => process.argv.includes(k);
const PROD = has('--prod');
const isProd = process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
if (PROD !== Boolean(isProd)) {
  console.error(PROD ? 'refusing: --prod given but DATABASE_URL is not PROD_DATABASE_URL' : 'refusing: DATABASE_URL is PROD - pass --prod to mean it');
  process.exit(2);
}
const base = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';
console.log(`TARGET ${PROD ? 'PROD' : 'DEV'} ${new URL(process.env.DATABASE_URL).host} · ET day ${etDay()}`);

const audience = await morningAudience(sql, { owners: OWNER_ADDRESSES });
const why = audience.reduce((m, a) => (m[a.why] = (m[a.why] ?? 0) + 1, m), {});
console.log(`AUDIENCE ${audience.length} · ${JSON.stringify(why)}`);
if (has('--count')) process.exit(0);

const asId = arg('--as') ? Number(arg('--as')) : audience[0]?.id;
if (!asId) { console.error('no account to render as (--as <userId>)'); process.exit(2); }
// --day YYYY-MM-DD renders that morning as the 15:00Z run would see it (mon-1: "render it AS Tuesday").
const DAY = arg('--day') ?? etDay();
const NOW = arg('--day') ? new Date(`${DAY}T15:00:00Z`) : new Date();
const dayData = await loadDay(DAY, { now: NOW });
const reader = await loadReader(dayData, asId);
const unsub = await unsubscribeUrlFor(asId);
const campaign = `morning-test-${DAY}`;
const mail = composeFor({ dayData, reader, unsubscribeUrl: unsub, player: true, link: (p) => clickUrlFor({ campaign, userId: asId, to: `${base}${p}` }) });
console.log(`AS user ${asId} · subject: ${mail.subject}`);
console.log(`modules: ${[dayData.hero && `HERO ${dayData.hero.league} (${dayData.hero.games.length} games${dayData.hero.confidenceLine ? ', confidence board' : ', board not built yet'})`, dayData.headline && `headline "${dayData.headline}"`, dayData.yesterdayDaily && `yesterday's Daily (${dayData.yesterdayDaily.played} played)`, 'daily', dayData.week && `week (${dayData.week.rows.length} sports)`, dayData.game && `game of the day (${dayData.game.why ?? 'earliest'})`, dayData.free && `free to play ${dayData.free.length}`, (reader.yesterday || reader.locks.length) && 'your move', `spotlight${reader.hasIosDevice ? '' : ' + app link'}`].filter(Boolean).join(' · ')}`);

if (arg('--preview')) { writeFileSync(arg('--preview'), mail.html); console.log(`preview written: ${arg('--preview')}`); process.exit(0); }

const toList = String(arg('--test') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (!toList.length) { console.error('usage: --count | --preview <file> | --test <owner address>[,<owner address>]  [--as <userId>] [--day YYYY-MM-DD] [--prod]'); process.exit(2); }
for (const to of toList) if (!OWNER_ADDRESSES.includes(to)) { console.error(`refusing: ${to} is not an owner address (lib/email/owners.js)`); process.exit(2); }
let failed = 0;
for (const to of toList) {
  const [{ id: rowId }] = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    VALUES (${SOURCE}, 'test', now(), true, ${JSON.stringify({ to, asUserId: asId, day: DAY, outcome: 'sending' })}::jsonb) RETURNING id`;
  const res = await resendSend({ to, subject: `[TEST] ${mail.subject}`, html: mail.html, text: mail.text, headers: unsubscribeHeaders(unsub) });
  await sql`UPDATE sync_runs SET finished_at = now(), ok = ${!res?.error},
              summary = ${JSON.stringify({ to, asUserId: asId, day: DAY, outcome: res?.error ? 'failed' : 'sent', id: res?.data?.id ?? null })}::jsonb
            WHERE id = ${rowId}`;
  if (res?.error) { failed += 1; console.error(`SEND FAILED to ${to}: ${res.error.message ?? res.error}`); continue; }
  console.log(`SENT test to ${to} at ${new Date().toISOString()} · Resend ${res?.data?.id}`);
}
if (failed) process.exit(1);

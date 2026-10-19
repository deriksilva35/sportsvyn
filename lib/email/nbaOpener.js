// lib/email/nbaOpener.js - THE NBA OPENER BROADCAST, Tue 20 Oct 2026 (mon-5, Derik's ruling).
//
// ONE DAY, ONE EXCEPTION to the 15 Oct rule (docs/decisions.md): opening night's
// morning email also goes to every OTHER account, once. From Wed 21 Oct the
// morning email is the active-player audience again; this module refuses any
// day but OPENER_DAY.
//
//   Group A = the morning audience (lib/email/morningAudience.js), mailed by the
//             15:00Z morning cron as normal.
//   Group B = every other account with an address, EXCEPT: unsubscribed
//             (email_opted_out_at), a hard bounce, a complaint, house and owner
//             accounts, Morning email turned OFF at /you, and anyone in A.
//
// NO DOUBLES. B is written to THE SAME LEDGER as A (sync_runs source
// 'morning-email', kind 'send', summary { userId, day }), why 'nba-opener'; the
// roster query excludes every user with a row for the day, so A then B never
// mails a person twice and a rerun mails nobody.
//
// THE PACE. The cron (/api/cron/nba-opener) fires every minute from 15:05Z; each
// firing sends AT MOST ONE BATCH of 50, and only when: the kill switch
// BROADCAST_NBA_OPENER=on; the day is OPENER_DAY and it is 15:05Z or later; A's
// run has finished with nothing still 'sending'; the last B send is a minute old;
// and the stop rule has not tripped.
//
// THE STOP RULE, checked before every batch from the Resend webhook's rows
// (source 'resend-webhook'): more than 1 complaint on the day's morning sends
// (A and B), or hard bounces above 5% of B's sends. Tripping it writes a
// 'nba-opener-stop' row; every later firing reads it and sends nothing.

import { sql } from '../db.js';
import { morningAudience } from './morningAudience.js';
import { OWNER_ADDRESSES } from './owners.js';
import { hardBouncedAddresses, isHardBounced } from './suppression.js';
import { loadDay, composeFor, SOURCE } from './morningSend.js';
import { ACCOUNT_FOOTER } from '../emails/morning.js';

export const OPENER_DAY = '2026-10-20';
export const WHY = 'nba-opener';
export const STOP_KIND = 'nba-opener-stop';
export const BATCH = 50;
export const START_UTC = '15:05';
export const MAX_COMPLAINTS = 1;
export const MAX_BOUNCE_RATE = 0.05;

export const openerEnabled = (env = process.env) => String(env?.BROADCAST_NBA_OPENER ?? '').trim().toLowerCase() === 'on';
const base = () => process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';

/** PURE: why the rest of B stops, or null. */
export function stopReason({ complaints = 0, hardBounces = 0, sent = 0 } = {}) {
  if (complaints > MAX_COMPLAINTS) return `complaints ${complaints} > ${MAX_COMPLAINTS}`;
  if (sent > 0 && hardBounces / sent > MAX_BOUNCE_RATE) return `hard bounces ${hardBounces}/${sent} = ${(100 * hardBounces / sent).toFixed(1)}% > ${100 * MAX_BOUNCE_RATE}%`;
  return null;
}

/** Every address with a complaint on record, normalised. */
export async function complainedAddresses(db = sql) {
  const rows = await db`
    SELECT DISTINCT lower(trim(summary->>'to')) AS a FROM sync_runs
     WHERE source = 'resend-webhook' AND kind = 'complained' AND summary->>'to' IS NOT NULL`;
  return rows.map((r) => r.a).filter(Boolean);
}

/**
 * GROUP B: [{ id, email }], everyone not excluded, not in A, and not already in
 * the day's ledger. A WHERE clause, never a filter afterwards: an excluded
 * address is never loaded.
 */
export async function groupB(db = sql, { day = OPENER_DAY, owners = OWNER_ADDRESSES, limit = null } = {}) {
  const a = (await morningAudience(db, { owners })).map((r) => Number(r.id));
  const bounced = await hardBouncedAddresses(db);
  const complained = await complainedAddresses(db);
  const rows = await db`
    SELECT u.id, COALESCE(u.contact_email, u.email) AS email
      FROM users u
     WHERE COALESCE(u.contact_email, u.email) IS NOT NULL
       AND u.email_opted_out_at IS NULL
       AND NOT COALESCE(u.is_house, false)
       AND NOT (u.email = ANY(${owners}))
       AND NOT (COALESCE(u.contact_email, '') = ANY(${owners}))
       AND NOT (lower(trim(COALESCE(u.contact_email, u.email))) = ANY(${bounced}))
       AND NOT (lower(trim(COALESCE(u.contact_email, u.email))) = ANY(${complained}))
       AND (to_jsonb(u)->>'morning_email')::boolean IS NOT FALSE
       AND NOT (u.id = ANY(${a}))
       AND NOT EXISTS (SELECT 1 FROM sync_runs s WHERE s.source = ${SOURCE} AND s.kind = 'send'
                         AND (s.summary->>'userId')::int = u.id AND s.summary->>'day' = ${day})
     ORDER BY u.id`;
  return limit ? rows.slice(0, limit) : rows;
}

/** The webhook's view of the day so far: B sent, B hard bounces, complaints on A + B. */
export async function dayHealth(db = sql, { day = OPENER_DAY } = {}) {
  const [r] = await db`
    WITH sends AS (
      SELECT summary->>'id' AS mid, summary->>'why' = ${WHY} AS b FROM sync_runs
       WHERE source = ${SOURCE} AND kind = 'send' AND summary->>'day' = ${day} AND summary->>'outcome' = 'sent'),
    ev AS (
      SELECT DISTINCT ON (summary->>'messageId', kind) summary->>'messageId' AS mid, kind, summary->>'bounceType' AS bt
        FROM sync_runs WHERE source = 'resend-webhook' AND kind IN ('bounced', 'complained')
         AND summary->>'messageId' IN (SELECT mid FROM sends WHERE mid IS NOT NULL))
    SELECT (SELECT count(*)::int FROM sends WHERE b) AS sent,
           (SELECT count(*)::int FROM ev JOIN sends s USING (mid) WHERE s.b AND ev.kind = 'bounced'
               AND lower(COALESCE(ev.bt, 'permanent')) <> 'transient') AS hard_bounces,
           (SELECT count(*)::int FROM ev WHERE kind = 'complained') AS complaints`;
  return { sent: r.sent, hardBounces: r.hard_bounces, complaints: r.complaints };
}

/** Has A (the 15:00Z morning run) finished, with no send still in flight? */
export async function groupAFinished(db = sql, { day = OPENER_DAY } = {}) {
  const [r] = await db`
    SELECT EXISTS (SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND kind = 'run' AND finished_at IS NOT NULL
                    -- the run's summary names its day; a run that threw has none, so its clock counts too
                    AND (summary->>'day' = ${day} OR started_at >= ${`${day}T14:00:00Z`}::timestamptz)) AS ran,
           EXISTS (SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND kind = 'send' AND summary->>'day' = ${day}
                    AND summary->>'outcome' = 'sending' AND COALESCE(summary->>'why', '') <> ${WHY}) AS inflight`;
  return r.ran && !r.inflight;
}

/** B's mail for one account: the day's email without YOUR MOVE or a personal block, and the account footer. */
export async function composeB({ dayData, userId, link, unsubscribeUrl }) {
  const [{ ios }] = await sql`SELECT EXISTS (SELECT 1 FROM device_tokens WHERE user_id = ${Number(userId)} AND platform = 'ios' AND revoked_at IS NULL) AS ios`;
  return composeFor({
    dayData, reader: { yesterday: null, locks: [], hasIosDevice: !!ios }, player: false,
    link, unsubscribeUrl, footer: ACCOUNT_FOOTER, postal: process.env.EMAIL_POSTAL_ADDRESS || null,
  });
}

/**
 * ONE FIRING -> { day, decision, ... }. decision: 'skipped-off' | 'wrong-day' |
 * 'too-early' | 'waiting-for-a' | 'stopped' | 'too-soon' | 'done' | 'sent-batch'.
 * `force` (tests) skips the switch, the day, the clock, the wait for A and the
 * minute spacing; never the stop rule or the ledger.
 */
export async function runOpenerBatch({ now = new Date(), send, unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders, force = false, day = OPENER_DAY, batch = BATCH, onlyUserIds = null } = {}) {
  if (!force && !openerEnabled()) return { day, decision: 'skipped-off' };
  const nowIso = new Date(now).toISOString();
  if (!force && nowIso.slice(0, 10) !== day) return { day, decision: 'wrong-day' };
  if (!force && nowIso.slice(11, 16) < START_UTC) return { day, decision: 'too-early' };
  if (!force && !process.env.EMAIL_POSTAL_ADDRESS) throw new Error('EMAIL_POSTAL_ADDRESS is required for the broadcast (CAN-SPAM)');

  const [stopped] = await sql`SELECT summary FROM sync_runs WHERE source = ${SOURCE} AND kind = ${STOP_KIND} AND summary->>'day' = ${day} LIMIT 1`;
  if (stopped) return { day, decision: 'stopped', reason: stopped.summary.reason };
  if (!force && !(await groupAFinished(sql, { day }))) return { day, decision: 'waiting-for-a' };

  const health = await dayHealth(sql, { day });
  const reason = stopReason(health);
  if (reason) {
    await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
              VALUES (${SOURCE}, ${STOP_KIND}, now(), now(), false, ${JSON.stringify({ day, reason, ...health })}::jsonb)`;
    return { day, decision: 'stopped', reason, ...health, justStopped: true };
  }
  if (!force) {
    const [last] = await sql`SELECT max(started_at) AS t FROM sync_runs WHERE source = ${SOURCE} AND kind = 'send'
                               AND summary->>'day' = ${day} AND summary->>'why' = ${WHY}`;
    if (last?.t && new Date(now) - new Date(last.t) < 60_000) return { day, decision: 'too-soon' };
  }

  const roster = (await groupB(sql, { day })).filter((r) => !onlyUserIds || onlyUserIds.includes(Number(r.id)));
  if (!roster.length) return { day, decision: 'done', ...health };
  const take = roster.slice(0, batch);
  const dayData = await loadDay(day, { now: force ? new Date() : new Date(`${day}T15:00:00Z`) });
  const campaign = `morning-${day}`;
  const out = { day, decision: 'sent-batch', sent: 0, failed: 0, suppressed: 0, remaining: roster.length - take.length };
  for (const r of take) {
    if (await isHardBounced(sql, r.email)) { out.suppressed += 1; continue; }
    // THE LEDGER ROW FIRST, guarded by the same (userId, day) key A uses: a row
    // that appeared since the roster was read means somebody else mailed them.
    const ins = await sql`
      INSERT INTO sync_runs (source, kind, started_at, ok, summary)
      SELECT ${SOURCE}, 'send', now(), true, ${JSON.stringify({ userId: Number(r.id), day, why: WHY, outcome: 'sending' })}::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND kind = 'send'
                           AND (summary->>'userId')::int = ${Number(r.id)} AND summary->>'day' = ${day})
      RETURNING id`;
    if (!ins.length) continue;
    const rowId = ins[0].id;
    try {
      const unsub = await unsubscribeUrlFor(r.id);
      const mail = await composeB({ dayData, userId: r.id, unsubscribeUrl: unsub,
        link: (p) => clickUrlFor({ campaign, userId: r.id, to: `${base()}${p}` }) });
      const res = await send({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, headers: unsubscribeHeaders(unsub) });
      if (res?.error) throw new Error(String(res.error?.message ?? res.error));
      await sql`UPDATE sync_runs SET finished_at = now(), ok = true,
                  summary = ${JSON.stringify({ userId: Number(r.id), day, why: WHY, outcome: 'sent', id: res?.data?.id ?? null })}::jsonb
                WHERE id = ${rowId}`;
      out.sent += 1;
    } catch (e) {
      await sql`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${String(e?.message ?? e).slice(0, 300)},
                  summary = ${JSON.stringify({ userId: Number(r.id), day, why: WHY, outcome: 'failed' })}::jsonb
                WHERE id = ${rowId}`;
      out.failed += 1;
    }
  }
  return out;
}

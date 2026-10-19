// lib/email/morningSend.js - THE MORNING EMAIL'S RUN (ruling thu-1, built sun-2).
//
// THE KILL SWITCH. MORNING_EMAIL=on in the environment, or nothing goes out:
// the cron records "skipped-off" and returns. It stays OFF until Derik's GO.
//
// ONCE PER USER PER DAY. The ledger is sync_runs (source 'morning-email', kind
// 'send', summary { userId, day }), written BEFORE the send and finished after
// - the welcome mail's pattern - so a retry, a second cron firing or a killed
// run never mails anyone twice on one ET day. A row still at 'sending' blocks
// a replay (visible, countable) rather than risking a duplicate.
//
// EVERY ADDRESS ASKS SUPPRESSION FIRST (lib/email/suppression.js, fri-3): the
// audience query already excludes hard bounces, and each send re-checks.
//
// WHAT THE MAIL SAYS is lib/emails/morning.js (pure); this file loads it:
//   today's Daily · the reader's yesterday · the game of the day · locks today.

import { sql } from '../db.js';
import { morningAudience } from './morningAudience.js';
import { OWNER_ADDRESSES } from './owners.js';
import { isHardBounced } from './suppression.js';
import { buildMorningEmail } from '../emails/morning.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { timeLabel } from '../time/display.js';
import { etDate } from '../leagues/weeks.js';

export const SOURCE = 'morning-email';
export const morningEnabled = (env = process.env) => String(env?.MORNING_EMAIL ?? '').trim().toLowerCase() === 'on';
const base = () => process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';

/** The ET date of an instant - the sports day (lib/leagues/weeks.js). */
export const etDay = (now = new Date()) => etDate(now);
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10); };

export const GAME_PATH = Object.freeze({
  pickem: (s) => `/pickem/${s}`, weekly: () => '/weekly', draft: () => '/draft', draft_game: () => '/draft/game',
  october: () => '/october', run: () => '/run', epl_weekly_5: () => '/epl-weekly-5',
});
const GAME_NAME = Object.freeze({
  pickem: (s) => `Pick'em ${String(s).toUpperCase()}`, weekly: () => 'The Weekly', draft: () => 'The Draft', draft_game: () => 'Primetime Draft',
  october: () => 'October', run: () => 'The Run', epl_weekly_5: () => 'EPL Weekly 5',
});

/** What every reader's mail shares today: the slate's marquee game, today's locks. */
export async function loadDay(day) {
  const start = await easternLocalToUtc(`${day} 00:00:00`);
  const end = await easternLocalToUtc(`${addDays(day, 1)} 00:00:00`);
  // THE GAME OF THE DAY: a postseason MLB game first (October), then NFL, a
  // ranked-looking CFB game, NBA, EPL - the earliest of the best kind, still to play.
  const [g] = await sql`
    SELECT m.slug, m.kickoff_at, l.slug AS league, h.name AS home, a.name AS away
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.kickoff_at >= ${start}::timestamptz AND m.kickoff_at < ${end}::timestamptz
       AND m.status = 'scheduled' AND l.slug IN ('mlb', 'nfl', 'cfb', 'nba', 'epl')
     ORDER BY CASE WHEN l.slug = 'mlb' AND m.stage IS NOT NULL THEN 0 WHEN l.slug = 'nfl' THEN 1
                   WHEN l.slug = 'cfb' THEN 2 WHEN l.slug = 'nba' THEN 3 WHEN l.slug = 'epl' THEN 4 ELSE 9 END,
              m.kickoff_at
     LIMIT 1`;
  const locks = await sql`
    SELECT c.id, c.game_type, c.sport, c.locks_at FROM contests c
     WHERE NOT c.settled AND c.locks_at > now() AND c.locks_at < ${end}::timestamptz
       AND c.game_type IN ('pickem', 'weekly', 'draft', 'draft_game', 'october', 'run', 'epl_weekly_5')
     ORDER BY c.locks_at`;
  const [board] = await sql`SELECT id FROM daily_boards WHERE edition_date = ${day} LIMIT 1`;
  const [yBoard] = await sql`SELECT id FROM daily_boards WHERE edition_date = ${addDays(day, -1)} LIMIT 1`;
  return {
    day, dailyBoardId: board?.id ?? null, yesterdayBoardId: yBoard?.id ?? null,
    game: g ? {
      away: g.away, home: g.home, league: String(g.league).toUpperCase(),
      time: timeLabel(g.kickoff_at, { tz: null }), path: g.league === 'epl' ? `/epl/match/${g.slug}` : `/${g.league}/game/${g.slug}`,
    } : null,
    locks,
  };
}

/** One reader's part: their Daily yesterday (score, place of N) and which of today's locks they are in. */
export async function loadReader(dayData, userId) {
  let yesterday = null;
  if (dayData.yesterdayBoardId) {
    const [r] = await sql`
      SELECT r.score,
             (SELECT count(*)::int FROM daily_board_runs x WHERE x.board_id = r.board_id AND x.completed_at IS NOT NULL
                 AND x.score IS NOT NULL AND NOT x.late_claim AND x.score > r.score) + 1 AS rank,
             (SELECT count(*)::int FROM daily_board_runs x WHERE x.board_id = r.board_id AND x.completed_at IS NOT NULL
                 AND x.score IS NOT NULL AND NOT x.late_claim) AS of
        FROM daily_board_runs r
       WHERE r.board_id = ${dayData.yesterdayBoardId} AND r.user_id = ${Number(userId)}
         AND r.completed_at IS NOT NULL AND r.score IS NOT NULL AND NOT r.late_claim
       LIMIT 1`;
    if (r) yesterday = { score: Number(r.score), rank: r.rank, of: r.of };
  }
  const ids = dayData.locks.map((c) => c.id);
  const mine = ids.length ? new Set((await sql`SELECT contest_id FROM contest_entries WHERE user_id = ${Number(userId)} AND contest_id = ANY(${ids})`).map((r) => r.contest_id)) : new Set();
  // One line per game (a sport's several boards collapse to the earliest lock).
  const seen = new Set();
  const locks = [];
  for (const c of dayData.locks) {
    const key = `${c.game_type}:${c.sport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locks.push({ label: GAME_NAME[c.game_type](c.sport), time: timeLabel(c.locks_at, { tz: null }), entered: mine.has(c.id), path: GAME_PATH[c.game_type](c.sport) });
  }
  return { yesterday, locks };
}

/** The finished mail for one reader. `link(path)` makes each link absolute (and click-tracked in a real send). */
export function composeFor({ dayData, reader, link, unsubscribeUrl }) {
  return buildMorningEmail({
    day: dayData.day,
    wordmarkUrl: `${base()}/email/arcade/wordmark-light.png`,
    links: { daily: link('/daily'), scores: link('/scores'), game: dayData.game ? link(dayData.game.path) : null, unsubscribe: unsubscribeUrl },
    yesterday: reader.yesterday,
    game: dayData.game,
    locks: reader.locks.map((l) => ({ ...l, href: link(l.path) })),
  });
}

/** Has this reader already been mailed (or is a send in flight) on this ET day? */
export async function alreadyMorning(userId, day) {
  const [r] = await sql`
    SELECT 1 AS x FROM sync_runs
     WHERE source = ${SOURCE} AND kind = 'send' AND (summary->>'userId')::int = ${Number(userId)} AND summary->>'day' = ${day}
     LIMIT 1`;
  return !!r;
}

/**
 * THE RUN. -> { day, decision, audience, sent, skipped, failed, suppressed }.
 * `send` is injected (Resend in production, a recorder in tests). Off unless
 * `force` (the test path) or MORNING_EMAIL=on.
 */
export async function runMorning({ now = new Date(), send, unsubscribeUrlFor, clickUrlFor, unsubscribeHeaders, force = false, onlyUserIds = null } = {}) {
  const day = etDay(now);
  if (!force && !morningEnabled()) return { day, decision: 'skipped-off' };
  const audience = (await morningAudience(sql, { owners: OWNER_ADDRESSES }))
    .filter((a) => !onlyUserIds || onlyUserIds.includes(Number(a.id)));
  const dayData = await loadDay(day);
  const out = { day, decision: 'ran', audience: audience.length, sent: 0, skipped: 0, failed: 0, suppressed: 0 };
  const campaign = `morning-${day}`;
  for (const a of audience) {
    if (await alreadyMorning(a.id, day)) { out.skipped += 1; continue; }
    if (await isHardBounced(sql, a.email)) { out.suppressed += 1; continue; }
    const [{ id: rowId }] = await sql`
      INSERT INTO sync_runs (source, kind, started_at, ok, summary)
      VALUES (${SOURCE}, 'send', now(), true, ${JSON.stringify({ userId: Number(a.id), day, why: a.why, outcome: 'sending' })}::jsonb)
      RETURNING id`;
    try {
      const reader = await loadReader(dayData, a.id);
      const unsub = await unsubscribeUrlFor(a.id);
      const mail = composeFor({ dayData, reader, unsubscribeUrl: unsub, link: (p) => clickUrlFor({ campaign, userId: a.id, to: `${base()}${p}` }) });
      const res = await send({ to: a.email, subject: mail.subject, html: mail.html, text: mail.text, headers: unsubscribeHeaders(unsub) });
      if (res?.error) throw new Error(String(res.error?.message ?? res.error));
      await sql`UPDATE sync_runs SET finished_at = now(), ok = true,
                  summary = ${JSON.stringify({ userId: Number(a.id), day, why: a.why, outcome: 'sent', id: res?.data?.id ?? null })}::jsonb
                WHERE id = ${rowId}`;
      out.sent += 1;
    } catch (e) {
      await sql`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${String(e?.message ?? e).slice(0, 300)},
                  summary = ${JSON.stringify({ userId: Number(a.id), day, why: a.why, outcome: 'failed' })}::jsonb
                WHERE id = ${rowId}`;
      out.failed += 1;
    }
  }
  return out;
}

/**
 * THE REAL SEND (Resend), from hello@sportsvyn.com with the house reply-to and
 * the RFC 8058 one-click headers. Injected into runMorning so tests never mail.
 */
export async function resendSend({ to, subject, html, text, headers }) {
  const { resend, EMAIL_FROM, EMAIL_REPLY_TO } = await import('../resend.js');
  return resend.emails.send({ from: EMAIL_FROM, to, replyTo: EMAIL_REPLY_TO, subject, html, text, headers });
}

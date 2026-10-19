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
// WHAT THE MAIL SAYS is lib/emails/morning.js (pure), its rules
// lib/email/morningModules.js (pure); this file loads them from the database:
// the nine modules of the thu-1 spec (mon-1), each hidden when empty.

import { sql } from '../db.js';
import { morningAudience } from './morningAudience.js';
import { OWNER_ADDRESSES } from './owners.js';
import { isHardBounced } from './suppression.js';
import { buildMorningEmail } from '../emails/morning.js';
import { headlineFor, yesterdayDaily, weekGrid, pickGameOfDay, freeToPlay, yourMove, spotlightFor, LEAGUE_LABEL } from './morningModules.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { timeLabel } from '../time/display.js';
import { etDate } from '../leagues/weeks.js';
import { finishedGuestCount } from '../daily/guestRuns.js';

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

/** What every reader's mail shares today (modules 1, 2, 4, 5, 6). */
export async function loadDay(day, { now = new Date() } = {}) {
  const yday = addDays(day, -1);
  const start = await easternLocalToUtc(`${day} 00:00:00`);
  const end = await easternLocalToUtc(`${addDays(day, 1)} 00:00:00`);
  // THE WEEK is Monday to Sunday (ET) around today.
  const [y, mo, d] = day.split('-').map(Number);
  const back = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  const monday = addDays(day, -back);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekStart = await easternLocalToUtc(`${monday} 00:00:00`);
  const weekEnd = await easternLocalToUtc(`${addDays(monday, 7)} 00:00:00`);

  // TODAY'S GAMES (modules 1 and 5), with what the pick order needs.
  const games = await sql`
    SELECT m.slug, m.kickoff_at, m.stage, m.season_year, l.slug AS league,
           h.name AS home, a.name AS away,
           h.current_division AS home_div, a.current_division AS away_div,
           h.current_conference AS home_conf, a.current_conference AS away_conf,
           (SELECT min(abs(o.selection_value::numeric)) FROM odds_markets o
             WHERE o.match_id = m.id AND o.is_current AND o.market_type = 'spread'
               AND o.selection_value ~ '^[-+]?[0-9.]+$') AS spread
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.kickoff_at >= ${start}::timestamptz AND m.kickoff_at < ${end}::timestamptz
       AND m.status <> 'postponed' AND m.status <> 'cancelled'
       AND l.slug IN ('nfl', 'cfb', 'mlb', 'nba', 'epl', 'ucl')
     ORDER BY m.kickoff_at`;
  const dow = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const shaped = games.map((g) => ({
    league: g.league, stage: g.stage, away: g.away, home: g.home, kickoffAt: g.kickoff_at, dow,
    homeDiv: g.home_div, awayDiv: g.away_div, homeConf: g.home_conf, awayConf: g.away_conf,
    spread: g.spread == null ? null : Number(g.spread), slug: g.slug,
  }));
  // OPENING NIGHT: a league with games today and no regular-season game earlier this season.
  const openers = [];
  for (const l of [...new Set(games.filter((g) => !g.stage).map((g) => g.league))]) {
    const season = games.find((g) => g.league === l).season_year;
    const [{ n }] = await sql`
      SELECT count(*)::int n FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${l} AND m.season_year = ${season} AND m.stage IS NULL AND m.kickoff_at < ${start}::timestamptz`;
    if (n === 0) openers.push(l);
  }
  const headline = headlineFor({ games: shaped, openers });
  const picked = pickGameOfDay(shaped.filter((g) => new Date(g.kickoffAt) > new Date(now)));
  const game = picked ? {
    ...picked, league: LEAGUE_LABEL[picked.league] ?? picked.league.toUpperCase(),
    time: timeLabel(picked.kickoffAt, { tz: null }),
    path: picked.league === 'epl' || picked.league === 'ucl' ? `/${picked.league}/match/${picked.slug}` : `/${picked.league}/game/${picked.slug}`,
  } : null;

  // 2 YESTERDAY'S DAILY: the answer (the board's perfect lineup), how many
  // finished it (signed in + guests), and the top 3 signed-in players.
  const [board] = await sql`SELECT id, season_year, ceiling, best_roster FROM daily_boards WHERE edition_date = ${yday} LIMIT 1`;
  let yesterdayDailyMod = null;
  if (board) {
    // HOUSE ACCOUNTS ARE NOT PLAYERS: they are out of the count and the top 3.
    const [{ n: signedIn }] = await sql`SELECT count(*)::int n FROM daily_board_runs r JOIN users u ON u.id = r.user_id
                                         WHERE r.board_id = ${board.id} AND r.completed_at IS NOT NULL AND r.score IS NOT NULL
                                           AND NOT r.late_claim AND NOT COALESCE(u.is_house, false)`;
    const guests = await finishedGuestCount(sql, board.id).catch(() => 0);
    const top = await sql`
      SELECT u.handle, r.score FROM daily_board_runs r JOIN users u ON u.id = r.user_id
       WHERE r.board_id = ${board.id} AND r.completed_at IS NOT NULL AND r.score IS NOT NULL AND NOT r.late_claim
         AND NOT COALESCE(u.is_house, false)
       ORDER BY r.score DESC, r.completed_at LIMIT 3`;
    yesterdayDailyMod = yesterdayDaily({
      board: { seasonYear: board.season_year, ceiling: board.ceiling, best: (board.best_roster ?? []).map((p) => ({ name: p.name, slot: p.slot })) },
      played: signedIn + guests,
      top: top.map((t) => ({ name: t.handle ? `@${t.handle}` : 'A player', score: Number(t.score) })),
    });
  }

  // 4 THIS WEEK: game counts by sport and ET day.
  // Bucketed by ET date in JS (lib/leagues/weeks.js etDate), never by SQL zone math.
  const weekRows = await sql`
    SELECT l.slug AS league, m.kickoff_at FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE m.kickoff_at >= ${weekStart}::timestamptz AND m.kickoff_at < ${weekEnd}::timestamptz
       AND l.slug IN ('nfl', 'cfb', 'mlb', 'nba', 'epl', 'ucl') AND m.status <> 'postponed'`;
  const tally = new Map();
  for (const r of weekRows) {
    const k = `${r.league}|${etDate(new Date(r.kickoff_at))}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const counts = [...tally].map(([k, n]) => { const [league, d] = k.split('|'); return { league, day: d, n }; });
  const week = weekGrid({ days, counts, today: day });

  // 6 FREE TO PLAY: open now (opened, not locked, not settled).
  const open = await sql`
    SELECT c.game_type, c.sport, c.locks_at FROM contests c
     WHERE NOT c.settled AND c.opens_at <= now() AND c.locks_at > now()
       AND c.game_type IN ('pickem', 'weekly', 'draft', 'draft_game', 'october', 'run', 'epl_weekly_5')
     ORDER BY c.locks_at LIMIT 40`;
  const free = freeToPlay(open.map((c) => ({
    label: GAME_NAME[c.game_type](c.sport), path: GAME_PATH[c.game_type](c.sport), locksAt: c.locks_at,
    time: timeLabel(c.locks_at, { weekday: true, tz: null }),
  })));

  // YOUR MOVE needs today's locks (the reader's entries are looked up per reader).
  const locks = await sql`
    SELECT c.id, c.game_type, c.sport, c.locks_at FROM contests c
     WHERE NOT c.settled AND c.locks_at > now() AND c.locks_at < ${end}::timestamptz
       AND c.game_type IN ('pickem', 'weekly', 'draft', 'draft_game', 'october', 'run', 'epl_weekly_5')
     ORDER BY c.locks_at`;
  return { day, yesterdayBoardId: board?.id ?? null, headline, yesterdayDaily: yesterdayDailyMod, week, game, free, locks };
}

/** One reader's part: their Daily yesterday, their entries locking today, an iOS device or not. */
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
  // YOUR open entries locking today, one line per game.
  const seen = new Set();
  const locks = [];
  for (const c of dayData.locks) {
    if (!mine.has(c.id)) continue;
    const key = `${c.game_type}:${c.sport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locks.push({ label: GAME_NAME[c.game_type](c.sport), time: timeLabel(c.locks_at, { tz: null }), path: GAME_PATH[c.game_type](c.sport) });
  }
  const [{ ios }] = await sql`SELECT EXISTS (SELECT 1 FROM device_tokens WHERE user_id = ${Number(userId)} AND platform = 'ios' AND revoked_at IS NULL) AS ios`;
  return { yesterday, locks, hasIosDevice: !!ios };
}

/**
 * The finished mail for one reader. `link(path)` makes each link absolute (and
 * click-tracked in a real send). `player`: YOUR MOVE is for players only.
 */
export function composeFor({ dayData, reader, link, unsubscribeUrl, player = true }) {
  const spot = spotlightFor(dayData.day, { hasIosDevice: reader.hasIosDevice });
  return buildMorningEmail({
    day: dayData.day,
    wordmarkUrl: `${base()}/email/arcade/wordmark-light.png`,
    links: {
      daily: link('/daily'), scores: link('/scores'), game: dayData.game ? link(dayData.game.path) : null,
      unsubscribe: unsubscribeUrl, app: process.env.APP_STORE_URL || APP_STORE_FALLBACK,
    },
    m: {
      headline: dayData.headline,
      yesterdayDaily: dayData.yesterdayDaily,
      week: dayData.week,
      game: dayData.game,
      free: dayData.free ? dayData.free.map((f) => ({ ...f, href: link(f.path) })) : null,
      move: yourMove({ player, yesterday: reader.yesterday, locks: reader.locks.map((l) => ({ ...l, href: link(l.path) })) }),
      spotlight: { ...spot, href: spot.path ? link(spot.path) : null },
    },
  });
}

/** The App Store listing (the 15 Oct broadcast's); APP_STORE_URL overrides it. */
export const APP_STORE_FALLBACK = 'https://apps.apple.com/us/app/draftvyn/id6792846231';

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
  const dayData = await loadDay(day, { now });
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
      const mail = composeFor({ dayData, reader, unsubscribeUrl: unsub, player: a.why !== 'new' || reader.yesterday != null,
        link: (p) => clickUrlFor({ campaign, userId: a.id, to: `${base()}${p}` }) });
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

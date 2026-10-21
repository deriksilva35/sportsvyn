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
import { headlineFor, yesterdayDaily, weekGrid, pickGameOfDay, primetimeName, freeToPlay, yourMove, spotlightFor, heroFor, heroSubject, ifNeeded, LEAGUE_LABEL } from './morningModules.js';
import { emailTile } from '../draftGame/nightlyCopy.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { timeLabel, zoneOpt } from '../time/display.js';
import { etDate } from '../leagues/weeks.js';
import { finishedGuestCount } from '../daily/guestRuns.js';

export const SOURCE = 'morning-email';
export const morningEnabled = (env = process.env) => String(env?.MORNING_EMAIL ?? '').trim().toLowerCase() === 'on';
const base = () => process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';

/**
 * PACIFIC FIRST, EVERYWHERE (mon-3): "Tue 4:00 PM PT / 7:00 PM ET". One email
 * goes to every reader, so both clocks are printed, the Pacific one first.
 */
export const ptEt = (iso, { weekday = false } = {}) => `${timeLabel(iso, { weekday, tz: 'America/Los_Angeles', zone: false })} PT / ${timeLabel(iso, { tz: null })}`;

/** The ET date of an instant - the sports day (lib/leagues/weeks.js). */
export const etDay = (now = new Date()) => etDate(now);
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10); };

/** The empty tile each game shows (lib/email/imageData.js TILE_KINDS). */
export const TILE_KEY = Object.freeze({
  pickem: (s) => `pickem-${s}`, weekly: () => 'weekly', draft: () => 'draft', draft_game: () => 'draft-game',
  october: () => 'october', run: () => 'run', epl_weekly_5: () => 'epl-weekly-5',
});

export const GAME_PATH = Object.freeze({
  pickem: (s) => `/pickem/${s}`, weekly: () => '/weekly', draft: () => '/draft', draft_game: () => '/draft/game',
  october: () => '/october', run: () => '/run', epl_weekly_5: () => '/epl-weekly-5',
});
const GAME_NAME = Object.freeze({
  pickem: (s) => `Pick'em ${String(s).toUpperCase()}`, weekly: () => 'The Weekly', draft: () => 'The Draft', draft_game: () => 'Primetime Draft',
  october: () => 'October', run: () => 'The Run', epl_weekly_5: () => 'EPL Weekly 5',
});

/**
 * One free-to-play tile from an open contest. A NIGHTLY NBA Draft (meta.nightly)
 * is its own tile - "NBA Draft tonight · 11 games · locks 4:00 PM PT", the room
 * shape under it, straight to /draft/game/<id>; every other row is the generic one.
 * The nightly row carries sortAt (its lock) and no locksAt, so the tile prints
 * the room shape where the lock time would go (the label already says it).
 */
export function freeRow(c) {
  if (c.game_type === 'draft_game' && c.meta?.nightly === true && c.id != null) {
    const t = emailTile(c.meta, c.locks_at);
    return { label: t.label, path: `/draft/game/${c.id}`, locksAt: null, sortAt: c.locks_at, time: t.room ?? 'Free to play', tile: TILE_KEY.draft_game() };
  }
  return {
    label: GAME_NAME[c.game_type](c.sport), path: GAME_PATH[c.game_type](c.sport), locksAt: c.locks_at,
    time: ptEt(c.locks_at, { weekday: true }), tile: TILE_KEY[c.game_type](c.sport),
  };
}

/** What every reader's mail shares today (modules 1, 2, 4, 5, 6). */
export async function loadDay(day, { now = new Date() } = {}) {
  // THE CLOCK IS AN ARGUMENT, never SQL now(): the test can render a morning
  // ahead of time (mon-1: "render it AS Tuesday") and see that day's boards.
  const at = new Date(now).toISOString();
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
           h.name AS home, a.name AS away, h.abbreviation AS home_abbr, a.abbreviation AS away_abbr, h.id AS home_id, a.id AS away_id,
           h.current_division AS home_div, a.current_division AS away_div,
           h.current_conference AS home_conf, a.current_conference AS away_conf,
           (SELECT min(abs(o.selection_value::numeric)) FROM odds_markets o
             WHERE o.match_id = m.id AND o.is_current AND o.market_type = 'spread'
               AND o.selection_value ~ '^[-+]?[0-9.]+$') AS spread
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.kickoff_at >= ${start}::timestamptz AND m.kickoff_at < ${end}::timestamptz
       -- THE /scores RULE (mon-3): every game but a decided series' leftover.
       AND m.status <> 'not_needed'
       AND l.slug IN ('nfl', 'cfb', 'mlb', 'nba', 'epl', 'ucl')
     ORDER BY m.kickoff_at`;
  const dow = new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const etParts = (iso) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { ...zoneOpt(null), weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const shaped = games.map((g) => ({
    primetime: Boolean(primetimeName(g.league, etParts(g.kickoff_at).weekday, Number(etParts(g.kickoff_at).hour))),
    abbrHome: g.home_abbr, abbrAway: g.away_abbr, homeId: g.home_id, awayId: g.away_id,
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
  // 0 THE HERO (mon-1 addendum): a season opener in SEASON_OPENERS, with
  // tonight's board when it is built (the confidence line needs it).
  const boards = {};
  for (const l of openers) {
    const [b] = await sql`
      SELECT meta->>'scoring' AS scoring FROM contests
       WHERE game_type = 'pickem' AND sport = ${l} AND locks_at >= ${start}::timestamptz AND locks_at < ${end}::timestamptz
       ORDER BY locks_at LIMIT 1`;
    if (b) boards[l] = { confidence: b.scoring === 'confidence' };
  }
  const tipTime = (g) => ptEt(g.kickoffAt);
  const hero = heroFor({ openers, games: shaped, boards, tipTime });
  // THE LEAD ORDER (mon-3): primetime > opener > playoff > rivalry > closest line, + Also tonight.
  const pool = shaped.filter((g) => new Date(g.kickoffAt) > new Date(now));
  const picked = pickGameOfDay(pool, { openers });
  const asGame = (p) => (p ? {
    ...p, leagueSlug: p.league, league: LEAGUE_LABEL[p.league] ?? p.league.toUpperCase(),
    time: ptEt(p.kickoffAt),
    path: p.league === 'epl' || p.league === 'ucl' ? `/${p.league}/match/${p.slug}` : `/${p.league}/game/${p.slug}`,
  } : null);
  const game = picked ? { ...asGame(picked), also: asGame(picked.also) } : null;

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
    // GAMES AND XP AT RENDER (tue-3): best_roster keeps neither, so they come from the
    // board's own source rows (nfl_player_season_totals), matched on season + name +
    // team + position. No single match -> no games, no /wk.
    const roster = board.best_roster ?? [];
    const src = roster.length ? await sql`
      SELECT raw_name, team_key, position, games, xp FROM nfl_player_season_totals
       WHERE season_year = ${board.season_year} AND raw_name = ANY(${roster.map((p) => p.name)})` : [];
    const srcFor = (p) => { const m = src.filter((r) => r.raw_name === p.name && r.team_key === p.teamKey && r.position === p.position); return m.length === 1 ? m[0] : null; };
    yesterdayDailyMod = yesterdayDaily({
      board: { seasonYear: board.season_year, ceiling: board.ceiling, best: roster.map((p) => { const r = srcFor(p); return { name: p.name, slot: p.slot, position: p.position, meta: p.meta, points: p.points, games: r?.games ?? null, xp: r?.xp ?? null }; }) },
      played: signedIn + guests,
      top: top.map((t) => ({ name: t.handle ? `@${t.handle}` : 'A player', score: Number(t.score) })),
    });
  }

  // 4 THIS WEEK: game counts by sport and ET day.
  // Bucketed by ET date in JS (lib/leagues/weeks.js etDate), never by SQL zone math.
  const weekRows = await sql`
    SELECT m.id, l.slug AS league, m.kickoff_at, m.status, m.stage, m.season_year,
           m.home_team_id, m.away_team_id, h.current_conference AS home_conf
      FROM matches m JOIN leagues l ON l.id = m.league_id JOIN teams h ON h.id = m.home_team_id
     WHERE m.kickoff_at >= ${weekStart}::timestamptz AND m.kickoff_at < ${weekEnd}::timestamptz
       AND l.slug IN ('nfl', 'cfb', 'mlb', 'nba', 'epl', 'ucl')
       AND m.status <> 'not_needed'`;
  const tally = new Map();
  for (const r of weekRows) {
    const k = `${r.league}|${etDate(new Date(r.kickoff_at))}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const counts = [...tally].map(([k, n]) => { const [league, d] = k.split('|'); return { league, day: d, n }; });
  // "ONLY IF NEEDED" (mon-3): an MLB postseason game this week that may not be played.
  const maybes = [];
  const post = weekRows.filter((r) => r.league === 'mlb' && r.stage && r.status === 'scheduled');
  if (post.length) {
    const seriesRows = await sql`
      SELECT m.id, m.kickoff_at, m.status, m.stage, m.season_year, m.home_team_id, m.away_team_id, m.home_score, m.away_score
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'mlb' AND m.stage = ANY(${[...new Set(post.map((r) => r.stage))]})
         AND m.season_year = ANY(${[...new Set(post.map((r) => r.season_year))]})`;
    const pair = (r) => `${r.stage}|${r.season_year}|${Math.min(r.home_team_id, r.away_team_id)}-${Math.max(r.home_team_id, r.away_team_id)}`;
    const winner = (r) => (r.status !== 'final' || r.home_score == null || r.away_score == null || Number(r.home_score) === Number(r.away_score) ? null
      : Number(r.home_score) > Number(r.away_score) ? r.home_team_id : r.away_team_id);
    for (const g of post) {
      const series = seriesRows.filter((r) => pair(r) === pair(g)).map((r) => ({ id: r.id, kickoffAt: r.kickoff_at, status: r.status, winner: winner(r) }));
      const flag = ifNeeded({ id: g.id, status: g.status }, series, { stage: g.stage, homeConf: g.home_conf });
      if (flag) maybes.push({ league: 'mlb', day: etDate(new Date(g.kickoff_at)), label: flag.label });
    }
  }
  const week = weekGrid({ days, counts, today: day, maybes });

  // 6 FREE TO PLAY: open now (opened, not locked, not settled).
  const open = await sql`
    SELECT c.id, c.game_type, c.sport, c.locks_at, c.meta FROM contests c
     WHERE NOT c.settled AND c.opens_at <= ${at}::timestamptz AND c.locks_at > ${at}::timestamptz
       AND c.game_type IN ('pickem', 'weekly', 'draft', 'draft_game', 'october', 'run', 'epl_weekly_5')
     ORDER BY c.locks_at LIMIT 40`;
  const free = freeToPlay(open.map(freeRow), { daily: { label: 'The Daily', path: '/daily', locksAt: null, time: 'New board every day', tile: 'daily' } });

  // YOUR MOVE needs today's locks (the reader's entries are looked up per reader).
  const locks = await sql`
    SELECT c.id, c.game_type, c.sport, c.locks_at FROM contests c
     WHERE NOT c.settled AND c.locks_at > ${at}::timestamptz AND c.locks_at < ${end}::timestamptz
       AND c.game_type IN ('pickem', 'weekly', 'draft', 'draft_game', 'october', 'run', 'epl_weekly_5')
     ORDER BY c.locks_at`;
  return { day, yesterdayBoardId: board?.id ?? null, hero, headline, yesterdayDaily: yesterdayDailyMod, week, game, free, locks };
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
    locks.push({ label: GAME_NAME[c.game_type](c.sport), time: ptEt(c.locks_at), path: GAME_PATH[c.game_type](c.sport) });
  }
  const [{ ios }] = await sql`SELECT EXISTS (SELECT 1 FROM device_tokens WHERE user_id = ${Number(userId)} AND platform = 'ios' AND revoked_at IS NULL) AS ios`;
  return { yesterday, locks, hasIosDevice: !!ios };
}

/**
 * The finished mail for one reader. `link(path)` makes each link absolute (and
 * click-tracked in a real send). `player`: YOUR MOVE is for players only.
 */
export function composeFor({ dayData, reader, link, unsubscribeUrl, player = true, footer, postal = null }) {
  const hero = dayData.hero;
  // An opener's own spotlight (the app, for tonight's Live Activities) replaces the rotation.
  const spot = hero?.spotlight ? { ...hero.spotlight, appLink: !reader.hasIosDevice } : spotlightFor(dayData.day, { hasIosDevice: reader.hasIosDevice });
  return buildMorningEmail({
    day: dayData.day, ...(footer ? { footer } : {}), postal,
    wordmarkUrl: `${base()}/email/arcade/wordmark-light.png`,
    links: {
      daily: link('/daily'), scores: link('/scores'), game: dayData.game ? link(dayData.game.path) : null,
      unsubscribe: unsubscribeUrl, app: process.env.APP_STORE_URL || APP_STORE_FALLBACK,
    },
    m: {
      // THE PICTURES (mon-3): public PNG routes - a date, a match slug, a game key; never a reader.
      hero: hero ? { ...hero, href: link(hero.path), prepHref: link(hero.prep.path), subject: heroSubject(hero),
        img: `${base()}/og/email/hero/${dayData.day}.png`, alt: `${hero.eyebrow}: ${hero.games.map((g) => `${g.away} at ${g.home}, ${g.time}`).join('; ')}` } : null,
      // NO REPEATED HEADLINE under a hero (mon-3): the hero already says it.
      headline: hero ? null : dayData.headline,
      yesterdayDaily: dayData.yesterdayDaily,
      week: dayData.week,
      game: dayData.game ? {
        ...dayData.game, href: link(dayData.game.path), img: `${base()}/og/email/chip/${dayData.game.slug}.png`,
        alt: `${dayData.game.away} at ${dayData.game.home}, ${dayData.game.time}`,
        also: dayData.game.also ? { ...dayData.game.also, href: link(dayData.game.also.path), img: `${base()}/og/email/chip/${dayData.game.also.slug}.png`,
          alt: `${dayData.game.also.away} at ${dayData.game.also.home}, ${dayData.game.also.time}` } : null,
      } : null,
      free: dayData.free ? dayData.free.map((f) => ({ ...f, href: link(f.path), img: `${base()}/og/email/tile/${f.tile}.png`, alt: `${f.label}: ${f.time}` })) : null,
      move: yourMove({ player, yesterday: reader.yesterday, locks: reader.locks.map((l) => ({ ...l, href: link(l.path) })) }),
      // THE LOCK-SCREEN PREVIEW (mon-3): the app spotlights show today's game of the day as a Live Activity would.
      spotlight: { ...spot, href: spot.path ? link(spot.path) : null,
        preview: LOCK_SCREEN_KEYS.has(spot.key) && dayData.game ? { line: `${dayData.game.away} at ${dayData.game.home}`, sub: `${dayData.game.time} - live on your lock screen` } : null },
    },
  });
}

const LOCK_SCREEN_KEYS = new Set(['app', 'live-activity', 'widgets']);

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
export async function resendSend({ to, subject, html, text, headers, attachments }) {
  const { resend, EMAIL_FROM, EMAIL_REPLY_TO } = await import('../resend.js');
  return resend.emails.send({ from: EMAIL_FROM, to, replyTo: EMAIL_REPLY_TO, subject, html, text, headers, ...(attachments?.length ? { attachments } : {}) });
}

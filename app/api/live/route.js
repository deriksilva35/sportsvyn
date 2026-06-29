/**
 * /api/live — PUBLIC live-scores JSON for the external glasses-HUD client.
 *
 * The app's live view reaches this data via a SERVER ACTION (loadMatch →
 * readMatch), which a static site can't call. This exposes the same DB-only
 * data over plain HTTP: no API-Sports calls, no writes, no auth — it rides the
 * poll-live cron's per-minute matches + watch-score writes, the same cheap
 * profile as /api/match/[slug]/status. force-dynamic so every ~60s poll sees
 * fresh DB state.
 *
 * Composition:
 *   · readTodaysCard()  — the canonical today's-WC-matches reader (teams,
 *                         score, status, kickoff label).
 *   · live-tick query   — latest two ticks per LIVE match from
 *                         match_watch_score_history (the same source readMatch's
 *                         live header uses): live clock + live composite + trend.
 *   · top-5 team query   — current published team-power edition, LIMIT 5. A lean
 *                         replica instead of readRankings (which pulls all 48
 *                         teams + 50 players + blurbs — too heavy for a 60s poll).
 *
 * CORS: the Meta glasses WebView polls this from a sandboxed / cross-origin
 * context, so every response sends Access-Control-Allow-Origin '*' (public,
 * read-only scores) plus an OPTIONS preflight handler.
 *
 * Graceful: any failure returns a 200 with empty arrays + an `error` flag, so a
 * flaky poll degrades rather than crashing the HUD.
 */

import { sql } from '@/lib/db';
import { readTodaysCard } from '@/app/app/data';
import { getPlayerTopN } from '@/lib/rankings';
import { deriveHeadlines } from '@/components/match/KeyMoments';

export const dynamic = 'force-dynamic';

// Public read-only scores polled by the Meta glasses WebView (a sandboxed /
// cross-origin context), so allow any origin. Applied to every response.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
};

// Preflight (the WebView may send an OPTIONS before the GET).
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

function trendOf(latest, prev) {
  if (!latest || latest.composite == null) return null;
  if (!prev || prev.composite == null) return 'flat';
  if (latest.composite > prev.composite) return 'up';
  if (latest.composite < prev.composite) return 'down';
  return 'flat';
}

function clockLabel(tick) {
  if (!tick || tick.minute == null) return null;
  return tick.minute_extra ? `${tick.minute}+${tick.minute_extra}'` : `${tick.minute}'`;
}

export async function GET() {
  const updatedAt = new Date().toISOString();
  try {
    const card = await readTodaysCard();
    const fixtures = card.fixtures ?? [];

    // LIVE watch-score ticks for in-progress matches only (latest + previous
    // per match, for the live composite, clock, and trend). One query, scoped
    // to the handful of live ids — nothing when no match is live.
    const liveIds = fixtures.filter((f) => f.isLive).map((f) => f.id);
    const liveByMatch = new Map();
    if (liveIds.length > 0) {
      const ticks = await sql`
        SELECT match_id, minute, minute_extra, status_short,
               composite_score::float AS composite, recorded_at, id
          FROM match_watch_score_history
         WHERE match_id = ANY(${liveIds}::int[])
         ORDER BY match_id, recorded_at DESC, id DESC
      `;
      for (const t of ticks) {
        const cur = liveByMatch.get(t.match_id);
        if (!cur) liveByMatch.set(t.match_id, { latest: t, prev: null });
        else if (!cur.prev) cur.prev = t;
      }
    }

    // EVENTS FEED for live matches — the SAME timeline the web match page shows.
    // The query mirrors getKeyMoments() (app/match/[slug]/page.js) field-for-
    // field (it's local to the page, not exported), and the per-row headline is
    // the web's EXACT deriveHeadlines() vocabulary — so glasses and web can
    // never disagree. is_current=true drops VAR-reversed events. Live-only:
    // nothing runs when no match is live (DB-only, rides poll-live writes).
    const eventRowsByMatch = new Map();
    if (liveIds.length > 0) {
      const rows = await sql`
        SELECT match_id, id, minute, minute_extra, event_type, detail, team_side,
               player_name, assist_name, gloss
          FROM match_events
         WHERE match_id = ANY(${liveIds}::int[]) AND is_current = true
         ORDER BY match_id, minute DESC, minute_extra DESC NULLS LAST, id DESC
      `;
      for (const r of rows) {
        if (!eventRowsByMatch.has(r.match_id)) eventRowsByMatch.set(r.match_id, []);
        const bucket = eventRowsByMatch.get(r.match_id);
        if (bucket.length < 50) bucket.push(r); // mirror getKeyMoments LIMIT 50
      }
    }

    // Raw kickoff timestamps for scheduled matches (readTodaysCard only exposes
    // a PT label; the client formats to taste, so we return ISO 8601 UTC).
    const schedIds = fixtures.filter((f) => !f.isLive && !f.isFinal).map((f) => f.id);
    const kickoffById = new Map();
    if (schedIds.length > 0) {
      const ks = await sql`SELECT id, kickoff_at FROM matches WHERE id = ANY(${schedIds}::int[])`;
      for (const k of ks) kickoffById.set(k.id, k.kickoff_at);
    }

    const matches = fixtures.map((f) => {
      const status = f.isLive ? 'live' : f.isFinal ? 'ft' : 'scheduled';
      const out = {
        id: f.id,
        slug: f.slug,
        home: { name: f.home.name, abbr: f.home.abbreviation, flag: f.home.flag_svg_path },
        away: { name: f.away.name, abbr: f.away.abbreviation, flag: f.away.flag_svg_path },
        homeScore: f.home_score,
        awayScore: f.away_score,
        status,
      };
      if (status === 'live') {
        const live = liveByMatch.get(f.id);
        const latest = live?.latest ?? null;
        out.minute = clockLabel(latest);
        out.statusShort = latest?.status_short ?? null;
        out.watchScore = latest?.composite != null ? Math.round(latest.composite * 10) / 10 : null;
        out.watchTrend = trendOf(live?.latest, live?.prev);
        // Full newest-first events feed, headlines via the web's deriveHeadlines
        // (same vocabulary as the match page). [] pre-first-event (omit feed).
        const evs = eventRowsByMatch.get(f.id) ?? [];
        const headlines = deriveHeadlines(evs, {
          homeName: f.home.abbreviation ?? f.home.name,
          awayName: f.away.abbreviation ?? f.away.name,
        });
        out.events = evs.map((e) => {
          const h = headlines.get(e.id) ?? { kind: 'sub', headline: '' };
          return {
            minute: e.minute_extra ? `${e.minute}+${e.minute_extra}'` : `${e.minute}'`,
            kind: h.kind,                 // goal|yellow|red|sub|var|missed
            headline: h.headline,         // locked web vocabulary
            scorer: h.scorer ?? null,     // for the volt highlight on goal rows
            gloss: (typeof e.gloss === 'string' && e.gloss.length > 0) ? e.gloss : null,
            side: e.team_side,
          };
        });
      } else if (status === 'scheduled') {
        const ko = kickoffById.get(f.id);
        out.kickoff = ko != null ? new Date(ko).toISOString() : null; // ISO 8601 UTC
      }
      return out;
    });

    // Team-power top 5 — current published edition, lean (LIMIT 5).
    const top5 = await sql`
      SELECT e.rank,
             t.name AS team, t.abbreviation AS abbr,
             t.flag_svg_path AS flag,
             e.score::float AS score, e.movement_label AS delta
        FROM ranking_entries e
        JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
        JOIN ranking_lists   rl ON rl.id = ed.ranking_list_id
        JOIN leagues         lg ON lg.id = rl.league_id
        JOIN teams            t ON t.id = e.team_id
       WHERE rl.slug = 'team-power'
         AND lg.slug = ${WC_LEAGUE_SLUG}
         AND ed.is_current = true
         AND ed.status = 'published'
         AND e.entity_type = 'team'
       ORDER BY e.rank ASC
       LIMIT 5
    `;
    const rankingsTop5 = top5.map((r) => ({
      rank: r.rank, team: r.team, abbr: r.abbr, flag: r.flag, score: r.score, delta: r.delta,
    }));

    // Player-power top 5 — same published-edition → ranking_entries shape as the
    // team query above (negligible added cost). Powers the Rankings Team↔Player toggle.
    const players = await getPlayerTopN({ listSlug: 'player-power', leagueSlug: WC_LEAGUE_SLUG, limit: 5 });
    const playerRankingsTop5 = players.map((r) => ({
      rank: r.rank, player: r.player_name, abbr: r.team_abbr,
      flag: r.team_flag_svg_path, score: r.score, delta: r.movement_label,
    }));

    return Response.json({ updatedAt, dateline: card.dateline, matches, rankingsTop5, playerRankingsTop5 }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('/api/live failed:', err);
    return Response.json({ updatedAt, matches: [], rankingsTop5: [], playerRankingsTop5: [], error: 'unavailable' }, { status: 200, headers: CORS_HEADERS });
  }
}

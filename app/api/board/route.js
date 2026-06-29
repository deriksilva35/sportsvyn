/**
 * /api/board — PUBLIC slow-changing board data for the glasses-HUD client.
 *
 * Sibling to /api/live, but for the surfaces that change per-ROUND (bracket) or
 * per-MATCH (stats) rather than per-tick — so the HUD polls this far less often
 * (every ~5 min) and keeps the 60s /api/live path lean.
 *
 * Mirrors the MAIN-SITE readers exactly (no reinvented queries):
 *   · bracket ← getKnockoutBracket()  — the same reader /world-cup-2026/bracket
 *               uses. Resolved teams where known; honest TBD slot labels where
 *               the round isn't decided yet. NEVER an invented matchup.
 *   · stats   ← getScorers()          — the same scorer rollup the Stats hub uses.
 *
 * DB-only, no API-Sports calls, no writes, no auth. force-dynamic + CORS '*'
 * (the glasses WebView polls cross-origin). Graceful: any failure returns 200
 * with null payloads + an `error` flag so the HUD falls back to its sample.
 */

import { sql } from '@/lib/db';
import { getKnockoutBracket } from '@/lib/bracket';
import { getScorers } from '@/lib/stats';

export const dynamic = 'force-dynamic';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const updatedAt = new Date().toISOString();
  try {
    const bmap = await getKnockoutBracket(WC_LEAGUE_SLUG);

    // FULL lean bracket — every KO match with the fields the HUD's client-side
    // feeder resolution needs (slot_*.match + feeds_match chain the tree). The
    // client resolves undecided slots one level up (real feeder pairs) and
    // labels beyond — see resolveSlot() in app.js. No matchups invented here.
    const matches = [...bmap.values()].map((m) => ({
      match_number:   m.match_number,
      stage:          m.stage,
      status:         m.status,
      home_score:     m.home_score,
      away_score:     m.away_score,
      home_penalties: m.home_penalties,
      away_penalties: m.away_penalties,
      home: m.home.resolved
        ? { resolved: true, name: m.home.name, flag: m.home.flag_svg_path }
        : { resolved: false, label: m.home.label },
      away: m.away.resolved
        ? { resolved: true, name: m.away.name, flag: m.away.flag_svg_path }
        : { resolved: false, label: m.away.label },
      slot_home: m.slot_home ? { type: m.slot_home.type, label: m.slot_home.label, match: m.slot_home.match ?? null } : null,
      slot_away: m.slot_away ? { type: m.slot_away.type, label: m.slot_away.label, match: m.slot_away.match ?? null } : null,
      feeds_match: m.feeds_match ?? null,
    }));

    // Team-power ranks (name → rank) so the Team-road mode can default to the
    // highest-ranked team still alive and cycle alive teams by rank.
    const trk = await sql`
      SELECT e.rank, t.name
        FROM ranking_entries e
        JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
        JOIN ranking_lists   rl ON rl.id = ed.ranking_list_id
        JOIN leagues         lg ON lg.id = rl.league_id
        JOIN teams            t ON t.id = e.team_id
       WHERE rl.slug = 'team-power' AND lg.slug = ${WC_LEAGUE_SLUG}
         AND ed.is_current = true AND ed.status = 'published' AND e.entity_type = 'team'
       ORDER BY e.rank ASC
    `;
    const teamRanks = trk.map((r) => ({ name: r.name, rank: r.rank }));

    const bracket = { matches, teamRanks };

    // Golden Boot: top-3 scorers, same rollup the Stats hub renders.
    const scorers = await getScorers(WC_LEAGUE_SLUG, 3);
    const toEntry = (s) => ({ name: s.player_name, team: s.team_abbr || s.team_name, goals: s.goals });
    const goldenBoot = scorers.length
      ? { leader: toEntry(scorers[0]), chasers: scorers.slice(1, 3).map(toEntry) }
      : null;
    const stats = { goldenBoot };

    return Response.json({ updatedAt, bracket, stats }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('/api/board failed:', err);
    return Response.json(
      { updatedAt, bracket: null, stats: null, error: 'unavailable' },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}

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

const STAGE_SHORT = {
  round_of_32: 'R32',
  round_of_16: 'R16',
  quarter:     'QF',
  semi:        'SF',
  third_place: '3rd',
  final:       'Final',
};

// A KO side is either a resolved team (use its name) or an unresolved slot
// (use the bracket's own slot label, e.g. 'W97' / 'TBD') — never invented.
const sideLabel = (s) => (s && s.resolved ? s.name : (s && s.label) || 'TBD');

export async function GET() {
  const updatedAt = new Date().toISOString();
  try {
    const bmap = await getKnockoutBracket(WC_LEAGUE_SLUG);
    const ko = [...bmap.values()];

    // Convergence: the two semifinals (where the bracket converges toward the
    // final). Resolved names or honest slot labels.
    const convergence = ko
      .filter((m) => m.stage === 'semi')
      .sort((a, b) => a.match_number - b.match_number)
      .map((m) => ({
        where: m.venue ? `Semifinal · ${m.venue}` : 'Semifinal',
        a: sideLabel(m.home),
        b: sideLabel(m.away),
      }));

    // Road so far: the most recent CONCLUDED knockout results (both teams
    // resolved + a final score), newest round first.
    const road = ko
      .filter((m) => m.status === 'final' && m.home?.resolved && m.away?.resolved)
      .sort((a, b) => b.match_number - a.match_number)
      .slice(0, 4)
      .map((m) => ({
        rd: STAGE_SHORT[m.stage] || m.stage,
        opp: `${m.home.name} ${m.home_score ?? 0}–${m.away_score ?? 0} ${m.away.name}`,
      }));

    const bracket = { convergence, road };

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

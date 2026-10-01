// scripts/nba-replay-record.mjs - record finished NBA games for the replay
// harness (lib/nba/replay.js). READ-ONLY against BDL; writes JSON fixtures.
//
// WHY RECORD. Preseason is not in BDL, and /nba/v1/box_scores/live keeps no
// history, so the live path cannot be rehearsed against a live feed before
// 20 Oct. A played game's final row, its every play (with wallclock) and its
// box score are enough to rebuild what the live feed would have said at any
// second - lib/nba/replay.js does that.
//
//   set -a && . ./.env.local && set +a
//   node scripts/nba-replay-record.mjs                  # the three default games
//   node scripts/nba-replay-record.mjs 18447720 ...     # any finished game ids
//
// Defaults (2025-26, picked 1 Oct 2026 from 2-8 Mar 2026):
//   18447720  GSW @ HOU 115-113, OT        - the overtime game
//   18447706  SAS @ PHI 131-91             - the blowout
//   18447717  DAL @ ORL 114-115            - the late-close game

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = ['18447720', '18447706', '18447717'];
const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const KEY = process.env.BDL_API_KEY;
if (!KEY) { console.error('BDL_API_KEY missing'); process.exit(1); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'nba', 'fixtures');
mkdirSync(OUT, { recursive: true });

const get = async (p) => {
  const r = await fetch(`https://api.balldontlie.io${p}`, { headers: { Authorization: KEY } });
  if (!r.ok) throw new Error(`BDL ${r.status} on ${p}`);
  return r.json();
};
const team = (t) => (t ? { id: t.id, abbreviation: t.abbreviation, full_name: t.full_name } : null);

for (const id of ids.length ? ids : DEFAULTS) {
  const game = (await get(`/nba/v1/games/${id}`)).data;
  if (game?.status_state !== 'final') { console.error(`skip ${id}: not final (${game?.status_state})`); continue; }
  const plays = (await get(`/nba/v1/plays?game_id=${id}`)).data ?? [];
  const stats = (await get(`/nba/v1/stats?game_ids[]=${id}&per_page=100`)).data ?? [];
  const fixture = {
    recordedAt: new Date().toISOString(),
    game: { ...game, home_team: team(game.home_team), visitor_team: team(game.visitor_team) },
    plays: plays.map((p) => ({
      order: p.order, type: p.type, text: p.text, period: p.period, clock: p.clock,
      home_score: p.home_score, away_score: p.away_score, scoring_play: p.scoring_play,
      wallclock: p.wallclock, team: p.team ? { abbreviation: p.team.abbreviation } : null,
    })),
    stats: stats.map((s) => ({
      min: s.min, pts: s.pts, fgm: s.fgm, fga: s.fga, fg3m: s.fg3m, fg3a: s.fg3a, ftm: s.ftm, fta: s.fta,
      oreb: s.oreb, dreb: s.dreb, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk, turnover: s.turnover,
      pf: s.pf, plus_minus: s.plus_minus,
      player: { id: s.player?.id, first_name: s.player?.first_name, last_name: s.player?.last_name, position: s.player?.position },
      team: { id: s.team?.id, abbreviation: s.team?.abbreviation },
    })),
  };
  const f = path.join(OUT, `replay-${id}.json`);
  writeFileSync(f, `${JSON.stringify(fixture)}\n`);
  console.log(`${id} ${game.visitor_team.abbreviation}@${game.home_team.abbreviation} ${game.visitor_team_score}-${game.home_team_score} p${game.period} | plays ${plays.length} | stats ${stats.length} -> ${path.relative(process.cwd(), f)}`);
}

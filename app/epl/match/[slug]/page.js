/**
 * /epl/match/[slug] - the Premier League match center.
 * Contract: sportsvyn-epl-matchcenter-mock-v0_1.
 *
 * A ROUTE OF ITS OWN, the pattern /nfl/game/[slug] already set: the WC-era
 * /match/[slug] carries tournament furniture (Watch Score, analyst preview,
 * odds rail) that a league fixture either does not have or is gated out of,
 * and rendering a Premier League match inside it was exactly the "instruments
 * that do not apply" problem that page's own header documents. /match/[slug]
 * 308s EPL slugs here, so every link already shared keeps working.
 *
 * ASSEMBLY, NOT INGESTION: every reader below already ran for Relay 2. This
 * page adds no provider call and no new table.
 *
 * NO MODEL COPY, BY CONSTRUCTION: nothing here reads articles, gloss or the
 * analyst pass, so the gated-content law needs no branch - there is nothing
 * to promise. Pinned.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { soccerLiveChip } from '@/lib/soccer/liveChip';
import { compareRows, fullStatRows, timelineRows, halfTimeScore, pitchRows } from '@/lib/soccer/matchCenter';
import MatchCenter from '@/components/soccer/MatchCenter';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

async function getMatch(slug) {
  const r = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score, m.week,
           m.venue, m.metadata->'live_state' AS live_state,
           l.name AS league_name,
           h.name AS home_name, h.abbreviation AS home_abbr,
           a.name AS away_name, a.abbreviation AS away_abbr
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} AND l.slug = 'epl' LIMIT 1`;
  return r[0] ?? null;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const m = await getMatch(slug);
  if (!m) return { title: 'Match not found - Sportsvyn' };
  const fixture = `${m.away_name} at ${m.home_name}`;
  return {
    title: m.status === 'final'
      ? `${fixture} - Final - Premier League - Sportsvyn`
      : `${fixture} - Premier League - Sportsvyn`,
    description: `Score, timeline, lineups and team stats: ${fixture}, Premier League matchweek ${m.week ?? ''}.`.trim(),
  };
}

export default async function EplMatchPage({ params }) {
  const { slug } = await params;
  const m = await getMatch(slug);
  if (!m) notFound();

  const [stats, events, lineups] = await Promise.all([
    sql`SELECT team_side, stats FROM match_statistics WHERE match_id = ${m.id} AND is_current`,
    sql`SELECT id, minute, minute_extra, event_type, detail, team_side, player_name, assist_name, is_current
          FROM match_events WHERE match_id = ${m.id} AND is_current ORDER BY minute ASC, id ASC`,
    sql`SELECT team_side, formation, players FROM match_lineups WHERE match_id = ${m.id} AND is_current`,
  ]);

  const byside = (rows, key) => ({
    home: rows.find((r) => r.team_side === 'home')?.[key] ?? null,
    away: rows.find((r) => r.team_side === 'away')?.[key] ?? null,
  });
  const s = byside(stats, 'stats');
  const live = m.status === 'live';
  const final = m.status === 'final';
  const ht = halfTimeScore(events);

  const lnHome = lineups.find((r) => r.team_side === 'home');
  const lnAway = lineups.find((r) => r.team_side === 'away');

  return (
    <>
      <GlobalHeaderServer activeNav="soccer" />
      <main className="gi" data-surface="ink">
        <div className="gi-wrap" style={{ maxWidth: 620 }}>
          <div className="gi-kicker">
            <Link className="lnk" href="/epl/standings">&#8249; {m.league_name}</Link>
            <span className="rule" />
            <span className="cnt">{m.week != null ? `Matchweek ${m.week}` : ''}</span>
          </div>

          <MatchCenter
            header={{
              live,
              final,
              // The minute counts UP from the poller's snapshot - never a
              // client tick, the same law the gridiron chip carries.
              chip: live ? soccerLiveChip(m.live_state) : null,
              kickoffLabel: m.kickoff_at ? `${ET.format(new Date(m.kickoff_at))} ET` : '',
              homeAbbr: m.home_abbr ?? (m.home_name ?? '').slice(0, 3).toUpperCase(),
              awayAbbr: m.away_abbr ?? (m.away_name ?? '').slice(0, 3).toUpperCase(),
              homeName: m.home_name, awayName: m.away_name,
              homeScore: m.home_score, awayScore: m.away_score,
              venue: m.venue,
            }}
            compare={compareRows(s.home, s.away)}
            fullStats={fullStatRows(s.home, s.away)}
            timeline={timelineRows(events, {
              reachedHalfTime: live || final,
              homeScoreAtHalf: ht.home, awayScoreAtHalf: ht.away,
              homeAbbr: m.home_abbr ?? '', awayAbbr: m.away_abbr ?? '',
            })}
            lineups={{
              home: lnHome ? pitchRows(lnHome.formation, lnHome.players) : null,
              away: lnAway ? pitchRows(lnAway.formation, lnAway.players) : null,
            }}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

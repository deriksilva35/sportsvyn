/**
 * /match/[slug] — minimal live/recap surface.
 *
 * Plain markup, deliberately under-designed. Reads one row from `matches`
 * + joined team rows, optionally calls API-Sports for lineups (only when
 * the match isn't 'scheduled' — pre-match lineups don't exist yet), and
 * mounts <LivePoller> when status='live'.
 *
 * noindex during the dev-data phase. Same posture as /team/[slug].
 */

import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { apiSports } from '@/lib/apiSports';
import LivePoller from '@/components/match/LivePoller';

export const metadata = {
  robots: { index: false, follow: false },
};

async function getMatchBySlug(slug) {
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code,
      m.home_team_id, m.away_team_id, m.home_score, m.away_score,
      m.venue, m.external_ids,
      h.name              AS home_name,
      h.slug              AS home_slug,
      h.abbreviation      AS home_abbreviation,
      a.name              AS away_name,
      a.slug              AS away_slug,
      a.abbreviation      AS away_abbreviation
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.slug = ${slug}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function fmtKickoff(d) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(new Date(d));
}

const CONTAINER_STYLE = { maxWidth: 900, margin: '0 auto', padding: '48px 24px' };
const KICKER_STYLE = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: 12,
};
const NAME_STYLE = {
  fontFamily: 'var(--font-display)',
  fontStyle: 'italic',
  fontWeight: 900,
  fontSize: 32,
  letterSpacing: '-0.02em',
  color: 'var(--paper-warm)',
  textTransform: 'uppercase',
};
const SCORE_STYLE = {
  ...NAME_STYLE,
  fontSize: 40,
  color: 'var(--volt)',
};
const META_STYLE = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--muted)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  marginTop: 8,
};
const SECTION_HEAD_STYLE = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--volt)',
  borderBottom: '1px solid var(--rule-dark)',
  paddingBottom: 8,
  marginTop: 40,
  marginBottom: 16,
  fontWeight: 700,
};

function Lineups({ lineups }) {
  if (!lineups?.length) return null;
  return (
    <div>
      <div style={SECTION_HEAD_STYLE}>§ Lineups</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
        {lineups.map((side) => (
          <div key={side.team.id}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontWeight: 900,
                fontSize: 18,
                color: 'var(--paper-warm)',
                textTransform: 'uppercase',
                letterSpacing: '-0.01em',
                marginBottom: 4,
              }}
            >
              {side.team.name}
            </div>
            <div style={{ ...META_STYLE, marginTop: 0, marginBottom: 12 }}>
              Formation {side.formation ?? '—'}
              {side.coach?.name && <> · Coach {side.coach.name}</>}
            </div>
            <ol style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(side.startXI ?? []).map((p) => (
                <li
                  key={p.player.id}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--paper-warm)',
                  }}
                >
                  <span style={{ color: 'var(--muted)', display: 'inline-block', width: 24 }}>
                    {p.player.number ?? '–'}
                  </span>
                  {p.player.name}
                  <span style={{ color: 'var(--muted-dim)', marginLeft: 6 }}>
                    {p.player.pos ?? ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function MatchPage({ params }) {
  const { slug } = await params;
  const match = await getMatchBySlug(slug);
  if (!match) notFound();

  const fixtureApiId = match.external_ids?.api_sports
    ? Number(match.external_ids.api_sports)
    : null;

  let lineups = [];
  if (fixtureApiId && match.status !== 'scheduled') {
    try {
      lineups = await apiSports.lineups(fixtureApiId);
    } catch (err) {
      console.error('lineups fetch failed:', err);
      lineups = [];
    }
  }

  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  const isScheduled = match.status === 'scheduled';

  return (
    <main style={CONTAINER_STYLE}>
      <div style={KICKER_STYLE}>
        {match.stage ?? 'Friendly'} · {match.venue ?? 'Venue TBD'}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 24,
          alignItems: 'center',
          padding: '24px 0',
          borderBottom: '1px solid var(--rule-dark)',
        }}
      >
        <div style={NAME_STYLE}>{match.home_name}</div>

        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {isLive ? (
            <LivePoller
              fixtureId={fixtureApiId}
              initialState={{
                status: match.status,
                home_score: match.home_score,
                away_score: match.away_score,
                minute: null,
              }}
            />
          ) : isFinal ? (
            <div style={SCORE_STYLE}>
              {match.home_score ?? 0} — {match.away_score ?? 0}
            </div>
          ) : (
            <div style={{ ...META_STYLE, marginTop: 0 }}>vs</div>
          )}
          <div style={META_STYLE}>
            {isFinal ? 'Full Time' : isLive ? 'Live' : fmtKickoff(match.kickoff_at)}
          </div>
        </div>

        <div style={{ ...NAME_STYLE, textAlign: 'right' }}>{match.away_name}</div>
      </div>

      {isScheduled && (
        <div style={{ ...META_STYLE, marginTop: 24 }}>
          Lineups not yet announced — published roughly an hour before kickoff.
        </div>
      )}

      <Lineups lineups={lineups} />
    </main>
  );
}

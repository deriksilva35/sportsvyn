/**
 * components/weekly/WeeklyGrade.js - the Weekly's settled grade card
 * (relay 2b item 2), per docs/design/games-remock-v2.html's #s-weekly .g
 * screen: volt grade card, sticky YOU/BEST SIX heads, the shared pairing
 * rows (lib/games/gradePairing.js), the dashed math line, the jade perf
 * box, the templated story, the glyph row, the board leaderboard with your
 * row in volt-dim, Share, and a forward-looking ghost line.
 *
 * NO ENTRY: perf box and leaderboard only - no rows to pair, no story to
 * tell about a lineup that was never submitted.
 */

import ShareGrade from '@/components/games/ShareGrade';
import { pairRows, gradeGlyphRow, gradeStory } from '@/lib/games/gradePairing';
import { poolCountLabel } from '@/lib/weekly/view';
import { SEASON_TABLE_MIN_FIELD } from '@/lib/games/lobby';
import StandaloneDate from '@/components/StandaloneDate';

const dispName = (p) => (p.name ?? 'empty');

export default function WeeklyGrade({ v, board, settledAtLabel, leaderboard, next, userId, statLines = new Map() }) {
  // TEAM AND LINE, where a bare em dash used to sit (relay 2b-fix item 1).
  // `team` rides the board snapshot itself (activePool() selects
  // teams.abbreviation into it); the stat line is read at render from the
  // week's own stat rows. Either may be absent - a board built without
  // team, a player with no line this formatter covers - and the row falls
  // back through team-only to the em dash rather than printing a stray
  // separator.
  const meta = (p) => [p?.team, statLines.get(p?.id)].filter(Boolean).join(' · ') || '—';
  const rows = v.you ? pairRows(v.you.picks, v.perfectPicks) : [];
  const glyph = rows.length ? gradeGlyphRow(rows) : '';
  const story = rows.length ? gradeStory(rows) : null;
  const gap = v.you ? Math.round((v.perfect - v.you.score) * 10) / 10 : null;
  const droppedPick = v.you?.picks.find((p) => p.dropped) ?? null;
  const matchedCount = rows.filter((r) => r.verdict === 'hit').length;

  const myRow = leaderboard.top.find((r) => r.userId === userId) ?? leaderboard.self ?? null;

  return (
    <>
      <header className="gg-hdr">
        <span className="gg-ed">The Weekly &middot; Week {v.week}</span>
        <span className="gg-clock">settled {settledAtLabel}</span>
      </header>

      {v.you && (
        <div className="gg-grade">
          <div className="gg-grade-top">
            <b>Week {v.week}</b>
            <span>{v.you.score} pts &middot; {v.you.pct}% of {v.perfect}</span>
          </div>
          <div className="gg-colhead"><div className="gg-cy">You</div><div className="gg-cb">Best six</div></div>
          {rows.map((r, i) => (
            <div className={`gg-sbr gg-${r.verdict}${r.you.dropped ? ' gg-dropped' : ''}`} key={r.you.id ?? `${r.label}-${i}`}>
              <div className="gg-top2">
                <span className="gg-pos">{r.label}</span>
                <span className="gg-vd">{r.verdict === 'hit' ? 'Matched' : r.verdict === 'ahead' ? 'You were ahead' : 'Missed'}</span>
                <span className="gg-dif">{r.verdict === 'hit' ? '✓' : r.diff}</span>
              </div>
              <div className="gg-two">
                <div className="gg-bx gg-you">
                  <div className="gg-nm">{dispName(r.you)}</div>
                  <div className="gg-mt">{meta(r.you)}</div>
                  <div className="gg-pt">{r.you.points ?? '-'}</div>
                </div>
                {r.verdict === 'hit' ? (
                  <div className="gg-bx gg-same"><div className="gg-tick">&#x2713;</div><div className="gg-sm">same pick</div></div>
                ) : (
                  <div className="gg-bx gg-best">
                    <div className="gg-nm">{dispName(r.best ?? {})}</div>
                    <div className="gg-mt">{meta(r.best)}</div>
                    <div className="gg-pt">{r.best?.points ?? '-'}</div>
                  </div>
                )}
              </div>
              {r.note && <div className="gg-note">{r.note}</div>}
            </div>
          ))}
        </div>
      )}

      {v.you && (
        <div className="gg-mathline">
          {matchedCount} of 6 matched &middot; <b>{gap} points left on the board</b>
          {droppedPick && <> &middot; your best five counted, {droppedPick.name} dropped as worst.</>}
        </div>
      )}

      <div className="gg-perf">
        <b>The best six this pool allowed</b>
        <p>
          {v.perfectPicks.map((p) => p.name).join(' · ')}
          <br />
          {v.perfect} points. {poolCountLabel(board.length)} players eligible, {v.perfectPicks.length} of them on this line.
        </p>
      </div>

      {story && (
        <div className="gg-story"><b>About your week</b><p>{story}</p></div>
      )}

      <div className="gg-lb">
        <div className="gg-lb-h"><span>Week {v.week}</span><span>{leaderboard.played} played</span></div>
        {leaderboard.top.map((r) => (
          <div className={`gg-lr${myRow && r.userId === myRow.userId ? ' gg-lr--you' : ''}`} key={r.userId}>
            <span className="gg-lr-rk">{r.rank}</span>
            <span className="gg-lr-who">{myRow && r.userId === myRow.userId ? 'you' : r.name}</span>
            <span className="gg-lr-sc">{r.score}</span>
          </div>
        ))}
        {leaderboard.self && (
          <div className="gg-lr gg-lr--you">
            <span className="gg-lr-rk">{leaderboard.self.rank}</span>
            <span className="gg-lr-who">you</span>
            <span className="gg-lr-sc">{leaderboard.self.score}</span>
          </div>
        )}
      </div>


      {v.you && leaderboard.played < SEASON_TABLE_MIN_FIELD && (
        <div className="gg-mathline">
          {leaderboard.played === 1 ? 'One entrant' : `${leaderboard.played} entrants`} this week, so
          it does not count toward the season table. Your score stands.
        </div>
      )}

      {v.you && (
        <ShareGrade
          glyph={glyph}
          caption={`The Weekly Week ${v.week} · ${v.you.score} pts · ${v.you.pct}%${myRow?.rank && leaderboard.played > 1 ? ` · ${myRow.rank}${ordinalSuffix(myRow.rank)} of ${leaderboard.played}` : ''}`}
          url="sportsvyn.com/weekly"
        />
      )}

      {next && (
        <div className="gg-mathline">
          Week {next.week} opens <StandaloneDate iso={next.opens_at} />
        </div>
      )}
    </>
  );
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

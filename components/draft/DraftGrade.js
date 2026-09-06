/**
 * components/draft/DraftGrade.js - the Draft's settled grade card
 * (relay 2b item 3), per docs/design/games-remock-v2.html's #s-draft .g
 * screen: the room block (your seat's rank among the 12), the field grade
 * card compared round-for-round against the field's best draft
 * (lib/games/gradePairing.js's draftGradeRows - round-indexed, not
 * pairRows()'s matched-then-paired shape, since a draft round is a shared
 * axis both rosters already have), the math line, the jade perf box, a
 * story naming the earliest divergent round, an 8-wide glyph row, the field
 * leaderboard with seat beside every name, the BY SEAT table, Share, and a
 * forward-looking ghost line.
 */

import ShareGrade from '@/components/games/ShareGrade';
import { draftGradeRows, firstDivergentRound, gradeGlyphRow } from '@/lib/games/gradePairing';
import { ordinal } from '@/lib/standings/view';
import { displayName } from '@/lib/daily/handles';
import StandaloneDate from '@/components/StandaloneDate';

export default function DraftGrade({
  v, seat, room, fieldBest, settledAtLabel, leaderboard, seatTable, next, userId,
}) {
  const yourRounds = v.roster;
  const bestRounds = fieldBest?.roster ?? [];
  const rows = v.you ? draftGradeRows(yourRounds, bestRounds) : [];
  const glyph = rows.length ? gradeGlyphRow(rows) : '';
  const diverge = firstDivergentRound(rows);
  const matchedCount = rows.filter((r) => r.verdict === 'hit').length;
  const fieldBestName = fieldBest ? displayName({ id: fieldBest.userId, handle: fieldBest.handle }) : 'unknown';
  const yourDropped = yourRounds.filter((r) => r.dropped);
  const bestDropped = bestRounds.filter((r) => r.dropped);
  const gap = v.you && fieldBest ? Math.round((v.perfect - v.you.score) * 10) / 10 : null;

  const myRow = leaderboard.top.find((r) => r.userId === userId) ?? leaderboard.self ?? null;

  const seatRank = seatTable.findIndex((s) => s.seat === seat) + 1 || null;
  const mostPopular = seatTable.reduce((a, b) => (b.drafters > (a?.drafters ?? -1) ? b : a), null);

  return (
    <>
      <header className="gg-hdr">
        <span className="gg-ed">The Draft &middot; Week {v.week} &middot; seat {seat}</span>
        <span className="gg-clock">settled {settledAtLabel}</span>
      </header>

      {room && (
        <div className="gg-mid">
          <div className="gg-kick">Your room &middot; seat {seat}</div>
          <div className="gg-big">{ordinal(room.rank)}</div>
          <div className="gg-lab">
            of {room.of} in the room
            {room.rank !== 1 && (() => {
              const top = room.seats[0];
              return top ? ` · the bot in seat ${top.seat} took ${top.score}` : '';
            })()}
          </div>
        </div>
      )}

      {v.you && fieldBest && (
        <div className="gg-grade">
          <div className="gg-grade-top">
            <b>The field</b>
            <span>{v.you.score} pts &middot; {v.you.pct}% of {v.perfect}</span>
          </div>
          <div className="gg-colhead">
            <div className="gg-cy">You &middot; seat {seat}</div>
            <div className="gg-cb">Field best &middot; {fieldBestName} &middot; seat {v.ceilingSeat}</div>
          </div>
          {rows.map((r, i) => (
            <div className={`gg-sbr gg-${r.you.dropped ? 'push' : r.verdict}`} key={r.you.id ?? i}>
              <div className="gg-top2">
                <span className="gg-pos">{r.label}</span>
                <span className="gg-vd">
                  {r.you.dropped ? 'Dropped' : r.verdict === 'hit' ? 'Matched' : r.verdict === 'ahead' ? 'You were ahead' : 'Missed'}
                </span>
                <span className="gg-dif">{r.you.dropped ? 'best six count' : r.verdict === 'hit' ? '✓' : r.diff}</span>
              </div>
              <div className="gg-two">
                <div className={`gg-bx gg-you${r.you.dropped ? ' gg-dropped' : ''}`}>
                  <div className="gg-nm">{r.you.name}</div>
                  <div className="gg-mt">pick {r.you.round != null ? r.you.round : '—'}</div>
                  <div className="gg-pt">{r.you.points ?? '-'}</div>
                </div>
                {r.verdict === 'hit' && !r.you.dropped ? (
                  <div className="gg-bx gg-same"><div className="gg-tick">&#x2713;</div><div className="gg-sm">same pick</div></div>
                ) : (
                  <div className={`gg-bx gg-best${r.best?.dropped ? ' gg-dropped' : ''}`}>
                    <div className="gg-nm">{r.best?.name ?? '—'}</div>
                    <div className="gg-mt">{r.best?.dropped ? 'also dropped' : '—'}</div>
                    <div className="gg-pt">{r.best?.points ?? '-'}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {v.you && fieldBest && (
        <div className="gg-mathline">
          {matchedCount} of 8 shared with the field&rsquo;s best draft &middot; <b>{gap} points behind</b>
          {(yourDropped.length || bestDropped.length) && (
            <> &middot; both rosters drop {Math.max(yourDropped.length, bestDropped.length)}
              {yourDropped.length ? `, ${yourDropped.map((r) => r.name).join(', ')} for you` : ''}.
            </>
          )}
        </div>
      )}

      {fieldBest && (
        <div className="gg-perf">
          <b>The best draft in the field</b>
          <p>
            {fieldBestName} &middot; seat {v.ceilingSeat} &middot; {v.perfect} from the six that count
            <br />
            {bestRounds.map((r) => r.name).join(' · ')}.
          </p>
        </div>
      )}

      {diverge && (
        <div className="gg-story">
          <b>About your draft</b>
          <p>
            {matchedCount} of your eight are on the field&rsquo;s best draft.
            The gap is {diverge.label}: {diverge.best?.name ?? 'the field'} was taken there instead of {diverge.you.name}.
            {room && room.rank === 1
              ? ' You also finished first in your own room.'
              : room ? ` In your own room you finished ${ordinal(room.rank)}.` : ''}
          </p>
        </div>
      )}

      <div className="gg-lb">
        <div className="gg-lb-h"><span>Week {v.week} &middot; the field</span><span>{leaderboard.played} drafted</span></div>
        {leaderboard.top.map((r) => (
          <div className={`gg-lr${myRow && r.userId === myRow.userId ? ' gg-lr--you' : ''}`} key={r.userId}>
            <span className="gg-lr-rk">{r.rank}</span>
            <span className="gg-lr-who">
              {myRow && r.userId === myRow.userId ? 'you' : r.name}
              {r.seat != null && <> &middot; seat {r.seat}</>}
            </span>
            <span className="gg-lr-sc">{r.score}</span>
          </div>
        ))}
        {leaderboard.self && (
          <div className="gg-lr gg-lr--you">
            <span className="gg-lr-rk">{leaderboard.self.rank}</span>
            <span className="gg-lr-who">you{leaderboard.self.seat != null && <> &middot; seat {leaderboard.self.seat}</>}</span>
            <span className="gg-lr-sc">{leaderboard.self.score}</span>
          </div>
        )}
      </div>

      <div className="gg-lb">
        <div className="gg-lb-h"><span>By seat &middot; Week {v.week}</span><span>avg pts &middot; drafters</span></div>
        {seatTable.map((s) => (
          <div className={`gg-lr${s.seat === seat ? ' gg-lr--you' : ''}`} key={s.seat}>
            <span className="gg-lr-rk">{s.avgPts != null ? seatTable.indexOf(s) + 1 : '-'}</span>
            <span className="gg-lr-who">
              {s.drafters ? `seat ${s.seat}` : <span style={{ color: 'var(--muted)' }}>seat {s.seat} · nobody drafted it</span>}
            </span>
            <span className="gg-lr-sc">{s.avgPts != null ? `${s.avgPts} · ${s.drafters}` : '-'}</span>
          </div>
        ))}
      </div>

      {mostPopular?.drafters > 0 && (
        <div className="gg-mathline">
          Seat {mostPopular.seat} was the most popular and the {ordinal(seatTable.findIndex((s) => s.seat === mostPopular.seat) + 1)} best.
          One week says nothing - the season board keeps the seat.
        </div>
      )}

      {v.you && (
        <ShareGrade
          glyph={glyph}
          caption={`The Draft Week ${v.week} · seat ${seat} · ${v.you.score} pts${myRow?.rank ? ` · ${ordinal(myRow.rank)} of ${leaderboard.played}` : ''}${room ? ` · ${ordinal(room.rank)} in room` : ''}`}
          url="sportsvyn.com/draft"
        />
      )}

      {next && (
        <div className="gg-mathline">
          Week {next.week} rooms open <StandaloneDate iso={next.opens_at} />
        </div>
      )}
    </>
  );
}

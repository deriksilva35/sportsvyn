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
import { seatRangeLabel } from '@/lib/games/leaderboard';
import { SEASON_TABLE_MIN_FIELD } from '@/lib/games/lobby';
import { displayName } from '@/lib/daily/handles';
import StandaloneDate from '@/components/StandaloneDate';

export default function DraftGrade({
  v, seat, room, fieldBest, settledAtIso, leaderboard, seatTable, next, userId,
  statLines = new Map(),
}) {
  // TEAM, THE ROUND IT WAS TAKEN IN, AND THE LINE (relay 2b-fix item 1).
  // The field-best box printed a bare em dash on every row; your own side
  // printed the round with no team. Ordered most-identifying first, since
  // .gg-mt ellipsises at 8px on a narrow screen.
  const meta = (p, extra = null) => [
    p?.team,
    extra ?? (p?.round != null ? `pick ${p.round}` : null),
    statLines.get(p?.id),
  ].filter(Boolean).join(' · ') || '—';
  const yourRounds = v.roster;
  const bestRounds = fieldBest?.roster ?? [];
  const rows = v.you ? draftGradeRows(yourRounds, bestRounds) : [];
  const diverge = firstDivergentRound(rows);
  const matchedCount = rows.filter((r) => r.verdict === 'hit').length;
  const fieldBestName = fieldBest ? displayName({ id: fieldBest.userId, handle: fieldBest.handle }) : 'unknown';
  const yourDropped = yourRounds.filter((r) => r.dropped);
  const bestDropped = bestRounds.filter((r) => r.dropped);
  const gap = v.you && fieldBest ? Math.round((v.perfect - v.you.score) * 10) / 10 : null;

  const myRow = leaderboard.top.find((r) => r.userId === userId) ?? leaderboard.self ?? null;

  const mostPopular = seatTable.reduce((a, b) => (b.drafters > (a?.drafters ?? -1) ? b : a), null);

  // ONE ENTRANT IS NOT A FIELD (relay 2b-fix item 7). With a single drafter
  // that drafter IS the ceiling, so "100% of {your own score}" is a
  // tautology wearing a percentage, and the you-versus-field-best rows
  // would compare a roster to itself and report eight Matched. The ROOM
  // block above is untouched: eleven bots is a real comparison and it is
  // the one this reader actually has.
  const soleDrafter = leaderboard.played === 1 && v.you != null;

  // THE GLYPH STRIP IS FIELD-RELATIVE HERE, so it goes with the percentage
  // and the rank (relay 2b-fix-2 item 2). Every glyph encodes a verdict from
  // draftGradeRows(yours, fieldBest) - and with one entrant the field best IS
  // you, so the strip would read eight green squares meaning "you matched
  // yourself eight times". Same gate as item 7's percentage and the rank
  // clause in the caption.
  //
  // NOT gated on the Weekly or Pick'em, deliberately: the Weekly's glyph
  // compares you to the theoretical perfect lineup and Pick'em's encodes
  // right/wrong per game - both are real with a field of one, and only
  // their RANK is field-relative (already dropped in the caption).
  const glyph = rows.length && !soleDrafter ? gradeGlyphRow(rows) : '';

  // DRAFTED SEATS ONLY, THEN ONE LINE FOR THE REST (relay 2b-fix item 6).
  const drafted = seatTable.filter((s) => s.drafters > 0);
  const undrafted = seatTable.filter((s) => s.drafters === 0).map((s) => s.seat);

  return (
    <>
      <header className="gg-hdr">
        {/* THE SEAT CLAUSE IS ALL OR NOTHING (relay 2b-fix item 1) - a null
            seat (an entry whose draftId never resolved to a room) used to
            render the bare word "seat" with nothing after it. Either the
            number is there and the word earns its place, or the whole
            clause goes. */}
        <span className="gg-ed">
          The Draft &middot; Week {v.week}{seat != null ? ` · seat ${seat}` : ''}
        </span>
        <span className="gg-clock">settled <StandaloneDate iso={settledAtIso} /></span>
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

      {v.you && soleDrafter && (
        <div className="gg-grade">
          <div className="gg-grade-top">
            <b>The field</b>
            <span>{v.you.score} pts</span>
          </div>
          <div className="gg-sbr">
            <div className="gg-lab">You were the only drafter this week.</div>
          </div>
        </div>
      )}

      {v.you && fieldBest && !soleDrafter && (
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
                  <div className="gg-mt">{meta(r.you)}</div>
                  <div className="gg-pt">{r.you.points ?? '-'}</div>
                </div>
                {r.verdict === 'hit' && !r.you.dropped ? (
                  <div className="gg-bx gg-same"><div className="gg-tick">&#x2713;</div><div className="gg-sm">same pick</div></div>
                ) : (
                  <div className={`gg-bx gg-best${r.best?.dropped ? ' gg-dropped' : ''}`}>
                    <div className="gg-nm">{r.best?.name ?? '—'}</div>
                    <div className="gg-mt">{meta(r.best, r.best?.dropped ? 'also dropped' : null)}</div>
                    <div className="gg-pt">{r.best?.points ?? '-'}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {v.you && fieldBest && !soleDrafter && (
        <div className="gg-mathline">
          {matchedCount} of 8 shared with the field&rsquo;s best draft &middot; <b>{gap} points behind</b>
          {(yourDropped.length || bestDropped.length) && (
            <> &middot; both rosters drop {Math.max(yourDropped.length, bestDropped.length)}
              {yourDropped.length ? `, ${yourDropped.map((r) => r.name).join(', ')} for you` : ''}.
            </>
          )}
        </div>
      )}

      {fieldBest && !soleDrafter && (
        <div className="gg-perf">
          <b>The best draft in the field</b>
          <p>
            {fieldBestName} &middot; seat {v.ceilingSeat} &middot; {v.perfect} from the six that count
            <br />
            {bestRounds.map((r) => r.name).join(' · ')}.
          </p>
        </div>
      )}

      {diverge && !soleDrafter && (
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
        {drafted.map((s, i) => (
          <div className={`gg-lr${s.seat === seat ? ' gg-lr--you' : ''}`} key={s.seat}>
            <span className="gg-lr-rk">{i + 1}</span>
            <span className="gg-lr-who">seat {s.seat}</span>
            <span className="gg-lr-sc">{s.avgPts} &middot; {s.drafters}</span>
          </div>
        ))}
        {undrafted.length > 0 && (
          <div className="gg-lr gg-lr--wrap">
            <span className="gg-lr-rk">-</span>
            <span className="gg-lr-who" style={{ color: 'var(--muted)' }}>
              {undrafted.length === 1 ? 'Seat' : 'Seats'} {seatRangeLabel(undrafted)} had no {undrafted.length === 1 ? 'drafter' : 'drafters'} this week
            </span>
            <span className="gg-lr-sc" style={{ color: 'var(--muted-dim)' }}>-</span>
          </div>
        )}
      </div>

      {mostPopular?.drafters > 0 && (
        <div className="gg-mathline">
          Seat {mostPopular.seat} was the most popular and the {ordinal(seatTable.findIndex((s) => s.seat === mostPopular.seat) + 1)} best.
          One week says nothing - the season board keeps the seat.
        </div>
      )}


      {v.you && leaderboard.played < SEASON_TABLE_MIN_FIELD && (
        <div className="gg-mathline">
          {leaderboard.played === 1 ? 'One entrant' : `${leaderboard.played} entrants`} this week, so
          it does not count toward the season table. Your score stands.
        </div>
      )}

      {v.you && (
        <ShareGrade
          glyph={glyph}
          caption={`The Draft Week ${v.week} · seat ${seat} · ${v.you.score} pts${myRow?.rank && !soleDrafter ? ` · ${ordinal(myRow.rank)} of ${leaderboard.played}` : ''}${room ? ` · ${ordinal(room.rank)} in room` : ''}`}
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

// components/draft/DraftLiveCard.js - the locked Draft's eight rows, v2.
//
// EXTRACTED FROM app/draft/page.js so the markup can be rendered and read
// without a session - the same reason WeeklyGrade and DraftGrade are
// components rather than branches of a page. THE SHAPE DECISIONS ALL LIVE IN
// lib/draft/liveCard.js; this only draws them, and it scores nothing
// (slotState.test.mjs's guard names this file).
//
// v2, IN THE PICK'EM GRAMMAR (docs/design/mocks/draft-v2.html, screen 2):
// a header whose hero is the live best six, pips for the eight, the three-step
// strip, then the rows - the counting six marked, the two that drop dimmed.
// Each row's small line is slotState's: the opponent and which side of it,
// shortOf's period and the clock while the game is on, the final score after.
// All of that was already flowing; what was missing was a screen that spent
// its width on it.
//
// A null `card` is the pre-live state: the picks are in, nothing has kicked
// off, and no number is invented for any of them.

import StandaloneTime from '@/components/StandaloneTime';

const STEPS = ['Draft', 'Scored live', 'Settled'];

/** "BUF vs DET" / "DET at BUF" - the matchup in this player's own orientation. */
function matchupOf(team, st) {
  if (!team) return null;
  if (!st?.opp) return team;
  return `${team} ${st.home ? 'vs' : 'at'} ${st.opp}`;
}

/**
 * One row's small line, from slotState and nothing else.
 *
 * FOUR SHAPES, ONE PER STATE THE GAME CAN BE IN - the same four the Weekly's
 * slots use, because it is the same rule and the same reader.
 */
function lineFor(r) {
  const st = r.state;
  if (!st) return r.pos ?? null;
  if (st.kind === 'final') {
    return `${r.team ?? ''}${st.score != null ? ` · Final ${st.score}-${st.oppScore}` : ' · final'}`;
  }
  if (st.kind === 'live') {
    return `${matchupOf(r.team, st)} · ${st.period ?? 'Live'}${st.clock ? ` ${st.clock}` : ''}`;
  }
  if (st.kind === 'bye') return `${r.team ?? ''} · bye`;
  return matchupOf(r.team, st);
}

export default function DraftLiveCard({ card = null, roster = [], seatLine = null }) {
  const rows = card?.rows ?? roster.map((r) => ({ ...r, key: r.ffc ?? r.id, counting: true, state: null }));
  const counting = card?.counting ?? rows.length;
  const started = card?.startedCount ?? 0;
  const live = rows.filter((r) => r.state?.kind === 'live').length;

  return (
    <div className="dvg">
      {/* ---- THE HEADER: the live best six, and what it is made of -------- */}
      <header className="dvg-hd">
        <div className="dvg-hd-top">
          <span className="dvg-eb">The Draft</span>
          <span className="dvg-ed">best six of eight</span>
        </div>
        {/* NO NUMBER BEFORE THERE IS ONE, AND A CARD WITH NOTHING STARTED
            COUNTS AS NOTHING. draftLiveRows returns a card the moment a
            roster exists - total 0, startedCount 0 - so gating on the card
            alone printed a 0 hero all week before the first kickoff. The
            gate is what has PLAYED, which is the rule every other surface
            follows. Caught by the served render, not by a test I wrote. */}
        {card && started > 0 ? (
          <div className="dvg-rec">
            <div>
              <span className="dvg-eb dvg-quiet">Your best six</span>
              <div className="dvg-big n">
                {card.total}
                <small className="n"> &middot; {started} of {rows.length} started</small>
              </div>
            </div>
          </div>
        ) : null}
        {/* THE PIPS ARE THE EIGHT, in roster order: jade for a final, red for
            a game on now, volt for one still to come, outlined for the two
            that drop. */}
        <div className="dvg-pips">
          {rows.map((r) => (
            <span
              key={r.key}
              className={`dvg-pip${!r.counting ? ' drop' : r.state?.kind === 'final' ? ' done'
                : r.state?.kind === 'live' ? ' live' : ' on'}`}
              data-row-state={r.counting ? (r.state?.kind ?? 'pre') : 'dropped'}
            />
          ))}
        </div>
        <div className="dvg-sub">
          <span>{counting} of {rows.length} count &middot; worst two dropped</span>
          <span>graded Tuesday</span>
        </div>
      </header>

      {/* ---- THE STRIP: where the week is, and the rule ------------------- */}
      <div className="dvg-steps">
        <div className="dvg-strip">
          {STEPS.map((name, i) => {
            // Drafting is done by the time this card renders; settling is not.
            const cls = i + 1 === 2 ? 'on' : (i + 1 < 2 ? 'done' : '');
            return (
              <span key={name} className="dvg-stpwrap">
                <span className={`dvg-stp ${cls}`}>
                  <i>{cls === 'done' ? '✓' : i + 1}</i>
                  <b>{name}</b>
                </span>
                {i < STEPS.length - 1 ? <span className="dvg-arw" /> : null}
              </span>
            );
          })}
        </div>
        <p className="dvg-note">
          Your eight play their real games. The <b>best six count</b>, the worst
          two drop. Nothing to set - the lineup is whoever scores.
          {live > 0 ? <> {live} {live === 1 ? 'game is' : 'games are'} on now.</> : null}
        </p>
      </div>

      {/* ---- THE EIGHT ---------------------------------------------------- */}
      <div className="dvg-ros">
        {rows.map((r) => (
          <div className={`dvg-rr${r.counting ? '' : ' drop'}${r.state?.kind === 'live' ? ' live' : ''}${r.state?.kind === 'final' ? ' fin' : ''}`}
            key={r.key} data-game={r.state?.kind}>
            <span className="dvg-pb" data-pos={r.pos}>{r.pos}</span>
            <span className="dvg-who">
              {/* THE SIX THAT COUNT ARE MARKED, not merely the two that do
                  not. A reader should not have to infer membership from the
                  absence of dimming. */}
              <b>{r.name}{r.counting && r.state ? <span className="dvg-count" title="counts toward the best six"> ✓</span> : null}</b>
              <small className={r.state?.kind === 'live' ? 'dvg-l' : undefined}>
                R{r.round} &middot; {lineFor(r)}
              </small>
            </span>
            <span className="dvg-pts n">
              {!r.state ? ''
                : r.state.started ? r.state.points
                  : r.state.kickoffAt ? <StandaloneTime iso={r.state.kickoffAt} />
                    : r.state.kind === 'bye' ? 'bye' : ''}
            </span>
          </div>
        ))}
      </div>

      {/* ---- THE FOOTER: the seat, in points, which is what we hold ------
          draftBySeat averages POINTS per seat, not finishing place. "Seat 5
          averages 4th" would need a rank-per-contest window query nobody has
          written, so the line says the number we actually have. No button:
          there is nothing to press on a card about a week in flight. */}
      <div className="dvg-ft">
        <p className="dvg-pace">
          <b>The Draft · by seat</b><br />
          {seatLine ?? 'Seat averages arrive once a week has settled'}
        </p>
      </div>
    </div>
  );
}

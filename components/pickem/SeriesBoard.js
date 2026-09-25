'use client';

// components/pickem/SeriesBoard.js - the MLB round board.
//
// A SIBLING OF PickemBoard, NOT A MODE OF IT. That component's row is a game:
// two sides, a kickoff, a per-game seal and a spread. This row is a SERIES -
// two sides, a best-of, a running record and ONE lock for the whole round -
// and every one of those differences would have been a branch inside a
// component that already carries four. The sibling law: two callers is a
// coincidence, and these two are not even the same shape.
//
// SAVE ON CHANGE, optimistic, the house pattern: the tap paints immediately
// and the server's refusal repaints it back with its reason. No save bar.

import { useState, useTransition } from 'react';
import TeamMark from '@/components/team/TeamMark';
import { pairHasHeadgear } from '@/lib/teams/headgear';
import { saveSeriesPickAction } from '@/app/actions/seriesPickem';

export default function SeriesBoard({ contest, rows, signedIn = false, signinHref = '/signin' }) {
  const [picks, setPicks] = useState(() => {
    const m = {};
    for (const r of rows) {
      const p = r.teams.find((t) => t.picked);
      if (p) m[r.seriesKey] = String(p.team_id);
    }
    return m;
  });
  const [err, setErr] = useState(null);
  const [, start] = useTransition();
  const locked = contest.phase !== 'open';

  const choose = (seriesKey, teamId) => {
    if (locked || !signedIn) return;
    const before = picks[seriesKey] ?? null;
    setPicks((p) => ({ ...p, [seriesKey]: String(teamId) }));
    setErr(null);
    start(async () => {
      const r = await saveSeriesPickAction(contest.id, seriesKey, teamId);
      if (!r?.ok) {
        // THE SERVER'S ANSWER WINS. An optimistic paint that the server
        // refuses is repainted back, with the reason, rather than left
        // standing as a pick the reader believes they made.
        setPicks((p) => ({ ...p, [seriesKey]: before }));
        setErr(REASON[r?.reason] ?? 'That pick did not save.');
      }
    });
  };

  return (
    <div className="sb" data-phase={contest.phase}>
      <div className="sb-head">
        <div>
          <h2>{contest.label}</h2>
          <div className="sb-sub">
            Best of {rows[0]?.bestOf ?? '-'} · <b>{contest.pointsPerPick}</b> point{contest.pointsPerPick === 1 ? '' : 's'} a series
          </div>
        </div>
        <div className="sb-count" data-made={contest.made}>
          {contest.phase === 'settled' && contest.score != null
            ? <><b>{contest.score}</b> of {contest.maxPoints}</>
            : <><b>{contest.made}</b> of {contest.total} picked</>}
        </div>
      </div>

      {err ? <p className="sb-err" role="alert">{err}</p> : null}

      {rows.map((r) => (
        <div className={`sb-row ${r.status}`} key={r.seriesKey} data-series={r.seriesKey} data-status={r.status}>
          <div className="sb-meta">
            <span className="sb-bo">Bo{r.bestOf}</span>
            {r.status === 'live' ? <span className="sb-live">{r.record}{r.nextGame ? ` · G${r.nextGame} next` : ''}</span>
              : r.status === 'final' ? <span className="sb-rec">{r.record}</span>
                : <span className="sb-q">first pitch</span>}
            {r.graded ? <span className={`sb-grade ${r.graded === 'W' ? 'w' : 'l'}`}>{r.graded}</span> : null}
            <span className="sb-pts">+{r.points}</span>
          </div>
          <div className="sb-sides">
            {r.teams.map((t, _i, both) => {
              // BOTH OR NEITHER: one cutout beside one disc reads as a favourite.
              const headgear = both.length === 2 && pairHasHeadgear('mlb', both[0]?.abbr, both[1]?.abbr);
              const on = (picks[r.seriesKey] ?? null) === String(t.team_id);
              return (
                <button
                  key={t.team_id}
                  type="button"
                  className={`sb-side${on ? ' on' : ''}${t.winner ? ' won' : ''}`}
                  aria-pressed={on}
                  disabled={locked || !signedIn}
                  onClick={() => choose(r.seriesKey, t.team_id)}
                >
                  <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary}
                    abbr={t.abbr} size={22} title={t.name} leagueSlug="mlb" headgear={headgear} />
                  <span className="sb-seed">{t.seed ?? ''}</span>
                  <span className="sb-nm">{t.name}</span>
                  {/* WINS IN THE SERIES, not a score. A series is 2-1. */}
                  <b className="sb-w">{t.wins}</b>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {!signedIn ? (
        <a className="sb-cta" href={signinHref}>Sign in to pick</a>
      ) : contest.phase === 'locked' ? (
        <p className="sb-note">The round has started. Picks are sealed until it is decided.</p>
      ) : null}
    </div>
  );
}

const REASON = {
  signed_out: 'Sign in to pick.',
  round_locked: 'The round has started - picks are sealed.',
  settled: 'This round is already graded.',
  not_open: 'This board has not opened yet.',
  not_in_series: 'That club is not in this series.',
  not_on_board: 'That series is not on this board.',
};

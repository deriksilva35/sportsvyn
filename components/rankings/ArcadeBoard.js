// components/rankings/ArcadeBoard.js - the league rankings page under arcade
// (board A of the "Rankings under arcade" canvas, tue-13 / wed-1).
//
// ONE BOARD, BOTH LEAGUES. The NFL draws nfl-power-z, CFB draws cfb-top25 -
// whichever list lib/rankings/servedBoard.js SERVED names - through the same
// rows, the same chips and the same working panel. What differs is data: the
// working's lines and the footer's weights are the edition's own.
//
// EVERY CONTROL IS A LINK, as on the Rankings tab (components/rankings/
// Rankings.js): the league chips, ALL / TOP and the rows themselves. ?all=1
// shows the field, ?open=<team> opens one row's working. A link can only carry
// one ?open=, so EXACTLY ONE ROW IS OPEN at a time by construction - no client
// state, and an open row is a URL that can be shared.
//
// scroll={false} ON THE ROW LINKS: opening row 20 must not throw the reader
// back to the title.

import Link from 'next/link';
import TeamMark from '@/components/team/TeamMark';
import { SERVED, workingFor, powerRating, tiedRanks, rankLabel } from '@/lib/rankings/servedBoard';
import { boardTitle, editionLine } from '@/lib/rankings/editionKicker';
import './arcadeBoard.css';

const LEAGUES = Object.keys(SERVED);

/** The board's URL for a view. Only non-default params are written. */
export function boardHref(league, { all = false, open = null } = {}) {
  const q = new URLSearchParams();
  if (all) q.set('all', '1');
  if (open) q.set('open', open);
  const s = q.toString();
  return `/${league}/rankings${s ? `?${s}` : ''}`;
}

const rowKey = (r) => r.slug ?? (r.teamId == null ? null : String(r.teamId));

/** The movement cell: a number iff the team was on the previous edition. */
function Mv({ previousRank, movement }) {
  if (previousRank == null) return <span className="rka-mv new" aria-label="new this edition">new</span>;
  const m = Number(movement ?? 0);
  if (m > 0) return <span className="rka-mv up" aria-label={`up ${m}`}>+{m}</span>;
  if (m < 0) return <span className="rka-mv dn" aria-label={`down ${-m}`}>−{-m}</span>;
  return <span className="rka-mv hold" aria-label="unchanged">·</span>;
}

/** The z model's power as its 0-100 rating (wed-6); the blend's 0-10 score as stored. */
function power(league, row) {
  if (SERVED[league]?.model === 'z') return powerRating(row.inputs?.power ?? row.score) ?? '–';
  return row.score == null ? '–' : Number(row.score).toFixed(2);
}

function Working({ league, row, weights, id }) {
  const w = workingFor(league, row, weights);
  if (!w) return <div className="rka-work" id={id}><p className="rka-work-none">No working was stored for this row.</p></div>;
  return (
    <div className="rka-work" id={id} data-working={league}>
      <span className="rka-work-h">{(row.name ?? '').toUpperCase()} · THE WORKING</span>
      <dl className="rka-work-grid">
        {w.lines.map((l) => (
          <div key={l.key} className="rka-work-line" data-line={l.key}>
            <dt>{l.label}</dt>
            <dd>
              <b>{l.value ?? '–'}</b>
              {l.z != null ? <small>{l.key === 'elo' ? l.z : `${l.z} z`}</small> : null}
              {l.weight != null ? <i>{l.weight}</i> : null}
            </dd>
          </div>
        ))}
        <div className="rka-work-line rka-work-total" data-line="total">
          <dt>{w.total.label}</dt><dd><b>{w.total.value ?? '–'}</b>{w.total.z != null ? <small>{w.total.z} z</small> : null}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function ArcadeBoard({ leagueSlug, leagueLabel, board, all = false, open = null, tz = undefined }) {
  const cfg = SERVED[leagueSlug];
  const rows = board?.rows ?? [];
  const top = cfg?.top ?? rows.length;
  // A ROW OPENED BEYOND THE TOP N shows the field, so a shared ?open= link to
  // the 30th team never lands on a page where that team is not drawn.
  // THE TOP N IS BY RANK, NOT BY POSITION: ranks tie (PROD's CFB edition 2 has
  // two teams at 25), and a slice would cut a team that holds a top-25 rank.
  const inTop = (r) => r.rank != null && r.rank <= top;
  const openIdx = open == null ? -1 : rows.findIndex((r) => rowKey(r) === open);
  const showAll = all || (openIdx >= 0 && !inTop(rows[openIdx]));
  const shown = showAll ? rows : rows.filter(inTop);
  const openKey = openIdx >= 0 ? open : null;
  // TIES ARE READ OFF THE WHOLE BOARD, so "T-25" shows on the row above the
  // cut even when its partner is the row just below it (which the top-N-by-rank
  // rule draws anyway).
  const tied = tiedRanks(rows.map((r) => r.rank));

  return (
    <main className="rka" data-league={leagueSlug} data-board={board?.list ?? 'none'}>
      <header className="rka-head">
        <span className="rka-eb">SPORTSVYN POWER</span>
        <h1 className="rka-title">{boardTitle(leagueLabel, board?.forWeek)}</h1>
        {board ? <p className="rka-ed">{editionLine(board, tz)}</p> : null}
        <nav className="rka-chips" aria-label="Rankings">
          {LEAGUES.map((l) => (
            <Link key={l} href={boardHref(l)} className={`rka-chip${l === leagueSlug ? ' on' : ''}`}
              aria-current={l === leagueSlug ? 'page' : undefined}>{l.toUpperCase()}</Link>
          ))}
          {rows.some((r) => !inTop(r)) ? (
            <Link className="rka-chip rka-all" scroll={false} href={boardHref(leagueSlug, { all: !showAll })}>
              {showAll ? `TOP ${top}` : `ALL ${rows.length}`}
            </Link>
          ) : null}
        </nav>
      </header>

      {!board ? (
        <p className="rka-empty">No edition yet. It publishes after each week&rsquo;s last game.</p>
      ) : (
        <>
          <div className="rka-cols" aria-hidden="true">
            <span className="c-n">#</span><span className="c-mv">MV</span><span className="c-mk" />
            <span className="c-tm">TEAM</span><span className="c-rec">REC</span><span className="c-pw">PWR</span>
          </div>
          <ol className="rka-rows">
            {shown.map((r) => {
              const k = rowKey(r);
              const isOpen = k != null && k === openKey;
              const wid = `rka-w-${k}`;
              return (
                <li key={k ?? r.rank} className={`rka-li${isOpen ? ' open' : ''}`}>
                  <Link className="rka-row" scroll={false}
                    href={boardHref(leagueSlug, { all: showAll, open: isOpen ? null : k })}
                    aria-expanded={isOpen} aria-controls={isOpen ? wid : undefined}
                    aria-label={`${rankLabel(r.rank, tied)}. ${r.fullName ?? r.name}${isOpen ? ', hide the working' : ', show the working'}`}>
                    <span className="rka-n">{rankLabel(r.rank, tied)}</span>
                    <Mv previousRank={r.previousRank} movement={r.rankMovement} />
                    <TeamMark primary={r.colors?.primary} secondary={r.colors?.secondary}
                      abbr={r.abbreviation} size={22} title={r.fullName ?? r.name} leagueSlug={leagueSlug}
                      className="rka-mk" />
                    <span className="rka-nm">{r.name}</span>
                    <span className="rka-rec">{r.record ?? '–'}</span>
                    <span className="rka-pw">{power(leagueSlug, r)}</span>
                  </Link>
                  {isOpen ? <Working league={leagueSlug} row={r} weights={board.weights} id={wid} /> : null}
                </li>
              );
            })}
          </ol>
          {/* THE WEIGHTS, AS STORED. Printed from the edition, so the line
              under the board is the formula the board was actually built with. */}
          {board.weights.length ? (
            <p className="rka-foot">
              {board.weights.map((w) => `${w.label} ${w.pct}%`).join(' · ')}. Tap a row for its working.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}

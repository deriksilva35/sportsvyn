'use client';

// components/pickem/PickemBoard.js - the LIVING board (mock frames 1+2,
// merged per the per-game-lock ruling): un-kicked games are tappable side
// pairs, kicked games are sealed rows grading in, one page all Saturday.
//
// The client clock here is DISPLAY ONLY - it decides what looks tappable and
// what the countdown reads. The save's authority is the server's clock
// against the snapshot kickoff (lib/pickem/entry); a stale client that taps
// a just-kicked game gets 'game_locked' back and the row seals itself.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RankBadge from '@/components/gridiron/RankBadge';
import { spreadParts } from '@/lib/standings/view';
import { isPreGame } from '@/lib/gridiron/oddsFormat';
import { savePickAction } from '@/app/actions/pickem';

// Where a board game's "Game" affordance points. Keyed by the contest's own
// sport so a future NFL board cannot silently link college routes.
const GAME_ROUTE = { cfb: '/cfb/game', nfl: '/nfl/game' };

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});
const ET_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** A board game's page, or null when we have no route for its sport. */
function gameHref(contest, g) {
  const base = GAME_ROUTE[contest?.sport];
  return base && g?.slug ? `${base}/${g.slug}` : null;
}

function countdownTo(iso, now) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h ${mm}m` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

export default function PickemBoard({ view, signedIn, signinHref }) {
  const { contest, games: initialGames } = view;
  // Optimistic overlay: matchId -> side. The server payload stays the truth
  // for everything else.
  const [mine, setMine] = useState({});
  const [savedTick, setSavedTick] = useState(false);
  const [lockedMsg, setLockedMsg] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const games = useMemo(() => initialGames.map((g) => ({
    ...g,
    kicked: g.kicked || new Date(g.kickoff_at).getTime() <= now,
    my_side: mine[g.match_id] ?? g.my_side,
  })), [initialGames, mine, now]);

  const picked = games.filter((g) => g.my_side != null).length;
  const total = games.length;
  const wins = games.filter((g) => g.graded === 'W').length;
  const losses = games.filter((g) => g.graded === 'L').length;
  const pending = games.filter((g) => g.status !== 'final').length;
  const anyKicked = games.some((g) => g.kicked);
  const nextKick = games.find((g) => !g.kicked)?.kickoff_at ?? null;
  const cd = nextKick ? countdownTo(nextKick, now) : null;

  async function tap(g, side) {
    if (!signedIn || g.kicked) return;
    const was = g.my_side;
    setMine((m) => ({ ...m, [g.match_id]: side === was ? was : side }));
    setLockedMsg(null);
    const res = await savePickAction(contest.id, g.match_id, side)
      .catch(() => ({ ok: false, reason: 'network' }));
    if (!res.ok) {
      setMine((m) => ({ ...m, [g.match_id]: was ?? undefined }));
      if (res.reason === 'game_locked') {
        setLockedMsg(`${g.away} @ ${g.home} kicked - that pick is sealed`);
        setNow(Date.now());
      }
      return;
    }
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1600);
  }

  return (
    <>
      <section className="pk-hero">
        <div className="pk-eb">
          <span>Pick&rsquo;em &mdash; Board {contest.boardNumber ?? ''}</span>
          <span className="pk-mono">{contest.sport.toUpperCase()} &middot; {total} games</span>
        </div>
        <h1>{anyKicked ? 'Grading in.' : `${total === 8 ? 'Eight' : total} games. Call the winners.`}</h1>
        <div className="pk-ctx">
          Locks per game at kickoff
          {cd && <> &middot; next kick <b>{cd}</b></>}
        </div>
      </section>

      {anyKicked && (
        <section className="pk-record">
          <div className="pk-eb">Your board {nextKick == null ? '· locked' : ''}</div>
          <div className="pk-big">{wins}-{losses} <small>&middot; {pending} pending</small></div>
        </section>
      )}

      <div className="pk-progress" aria-label={`${picked} of ${total} picked`}>
        <div className="pk-bar"><i style={{ width: `${(picked / Math.max(total, 1)) * 100}%` }} /></div>
        <div className="pk-n">{picked}<small>/{total} picked</small></div>
      </div>

      {lockedMsg && <p className="pk-lockedmsg">{lockedMsg}</p>}

      {games.map((g) => {
        const kickedAtMs = new Date(g.kickoff_at).getTime() <= now;
        const eyebrowLeft = g.status === 'final' ? 'Final'
          : g.status === 'live' ? '● Live'
            : `${ET_DAY.format(new Date(g.kickoff_at))}`;
        const eyebrowRight = g.status === 'final' || g.status === 'live'
          ? (g.home_score != null ? `${g.away_score}-${g.home_score}` : '')
          : `${ET_TIME.format(new Date(g.kickoff_at))} ET`;
        return (
          <div className="pk-game" key={g.match_id}>
            {/* THE LINK LIVES IN THE HEADER, NEVER AROUND THE PICKS.
                .pk-eb and .pk-sides are SIBLINGS - the anchor is not an
                ancestor of the pick buttons, so a pick tap has no anchor to
                navigate; and nothing on .pk-game or .pk-eb carries an onClick,
                so the link's own tap has no handler to bubble into. The
                separation is structural, not a z-index or a stopPropagation
                that the next edit could undo. The 9px .pk-eb margin-bottom
                keeps the two tap targets physically apart as well. */}
            <div className={`pk-eb${g.status === 'live' ? ' live' : ''}`}>
              <span>{eyebrowLeft}</span>
              <span className="pk-ebr">
                {/* THE LINE, ONCE PER CARD AND NAMED. isPreGame at the render
                    as well as at the fetch: the spread vanishes the moment a
                    game kicks, because a pre-kickoff line beside a live score
                    is a number that stopped being true. Records do NOT vanish -
                    they are not market data and have no kickoff. */}
                {(() => {
                  if (!isPreGame(g.status)) return null;
                  const p = spreadParts({ spreadHome: g.spread_home, homeAbbr: g.home, awayAbbr: g.away });
                  if (!p) return null;
                  // The NAME truncates, the NUMBER does not - see spreadParts.
                  return (
                    <span className="pk-spread">
                      <span className="pk-spread-t">{p.fav}</span>
                      <span className="pk-spread-n">{'\u00a0'}{p.mag}</span>
                    </span>
                  );
                })()}
                <span className="pk-mono">{eyebrowRight}</span>
                {gameHref(contest, g) && (
                  <Link
                    className="pk-gamelink"
                    href={gameHref(contest, g)}
                    aria-label={`${g.away} at ${g.home} game page`}
                  >
                    Game &rarr;
                  </Link>
                )}
              </span>
            </div>
            <div className="pk-sides">
              {['away', 'home'].map((side) => {
                const name = side === 'home' ? g.home : g.away;
                const isMine = g.my_side === side;
                let cls = 'pk-side';
                if (!g.kicked && !kickedAtMs) {
                  if (isMine) cls += ' on';
                } else if (isMine) {
                  cls += g.graded === 'W' ? ' win' : g.graded === 'L' ? ' loss' : ' pick';
                } else {
                  cls += ' dim';
                }
                const sealed = g.kicked || kickedAtMs || !signedIn;
                return (
                  <button
                    key={side}
                    type="button"
                    className={cls}
                    disabled={sealed}
                    onClick={() => tap(g, side)}
                  >
                    <RankBadge rank={side === 'home' ? g.home_rank : g.away_rank} />
                    <span className="pk-nm">{name}</span>
                    {/* A CHIP MAY ONLY CLAIM KNOWLEDGE - no record, no chip,
                        never an invented dash or a 0-0 built from absence. */}
                    {(side === 'home' ? g.home_record : g.away_record) ? (
                      <span className="pk-rec">{side === 'home' ? g.home_record : g.away_record}</span>
                    ) : null}
                    {!sealed && <span className="pk-tag">{side.toUpperCase()}</span>}
                    {isMine && g.graded === 'W' && <span className="pk-res w">W</span>}
                    {isMine && g.graded === 'L' && <span className="pk-res l">L</span>}
                    {isMine && g.status === 'live' && <span className="pk-res live">LIVE</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {signedIn ? (
        <p className="pk-savebar">{savedTick ? <b>Saved</b> : 'Saved'} &middot; edit any pick until its kickoff</p>
      ) : (
        <a className="pk-signin" href={signinHref}>Sign in to make your picks &rarr;</a>
      )}
    </>
  );
}

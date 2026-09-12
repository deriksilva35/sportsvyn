// components/games/LobbyV2.js - the Games tab v2 pane (GAMES TAB v2 relay).
// A server component: no hooks, no state. app/games/page.js hands it the
// reader's answer (lib/games/lobbyV2.js); this draws. Kept out of the page
// file so it can be rendered on its own for a served proof.

import Link from 'next/link';
import StandaloneDate from '@/components/StandaloneDate';
import TeamMark from '@/components/team/TeamMark';
import { orderFor } from '@/lib/gridiron/teamOrder';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { numberWord, tonightTitle } from '@/lib/games/lobbyV2Shape';

// ---------------------------------------------------------------------------
// THE GAMES PANE, v2 (docs/design/mocks/games-tab-v0_1.html). Top to bottom:
// header, intro, the Daily and the Weekly as cards, Pick'em and the Draft as
// rows, the Draft room (Mock and Tracker live here and nowhere else on the
// page), Tonight, Read the game, then the three panes as small links so
// nothing is orphaned. Every fact comes shaped from lib/games/lobbyV2.js;
// this draws. Signed out: same page, public state, every CTA to sign-in.
// ---------------------------------------------------------------------------
const WORDMARK = '/brand/sportsvynwordmarkwhite3000x600truealpha.png';
const weekdayEt = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });

function Stat({ s }) {
  return <div><b className="n">{s.value}</b><span>{s.label}</span></div>;
}

function GameCard({ card, hero = false, sub, right, signedIn, signinHref }) {
  const href = signedIn ? card.href : signinHref(card.href);
  const done = /^(Lineup set|Lineup locked|Done|See your grade|In progress)/.test(card.cta);
  return (
    <a className={`lv-game${hero ? ' hero' : ''}`} href={href} data-card={card.key} data-state={card.state}>
      <div className="lv-ymark" aria-hidden="true">Ȳ</div>
      <div className="top"><span className="tag">{card.tag}</span><small>{sub}</small></div>
      <h2>{card.title}</h2>
      <p>{card.description}</p>
      <div className="lv-stat">{card.stats.map((s) => <Stat key={s.label} s={s} />)}</div>
      <div className="bot">
        <span className={`lv-play${done ? ' done' : ''}`}>{signedIn ? card.cta : 'Sign in to play'}</span>
        <small className="n">{right}</small>
      </div>
    </a>
  );
}

function MiniRow({ row, signedIn, signinHref }) {
  const href = signedIn ? row.href : signinHref(row.href);
  const tone = row.pill?.tone === 'volt' ? ' go' : row.pill?.tone === 'jade' ? ' done' : '';
  return (
    <a className="lv-mini" href={href} data-row={row.key}>
      <span className="lv-ico">{row.glyph}</span>
      <span>
        <strong>{row.title}</strong>
        <small>
          {row.lines.map((l, i) => (
            <span key={i}>{i > 0 && <br />}{l.text}{l.at ? <StandaloneDate iso={l.at} /> : null}</span>
          ))}
        </small>
      </span>
      {row.pill && <span className={`st${tone}`}>{row.pill.label}</span>}
    </a>
  );
}

function TeamLine({ t, trail = false, scored = false }) {
  return (
    <div className={`lv-team${trail ? ' trail' : ''}`}>
      {t.colors
        ? <TeamMark primary={t.colors.primary} secondary={t.colors.secondary} size={24} title={t.name} />
        : <span className="lv-ico" style={{ width: 24, height: 24 }} />}
      <span className="ab">{t.abbr}</span><span>{t.name}</span>
      {scored && <b className="n">{t.score ?? 0}</b>}
    </div>
  );
}

function ScoreCard({ g }) {
  const live = g.status === 'live';
  const final = g.status === 'final';
  const homeLeads = g.home.score != null && g.away.score != null && g.home.score > g.away.score;
  const awayLeads = g.home.score != null && g.away.score != null && g.away.score > g.home.score;
  const spread = g.spreadHome == null ? null
    : `Spread ${g.spreadHome <= 0 ? g.home.abbr : g.away.abbr} ${g.spreadHome <= 0 ? g.spreadHome : -g.spreadHome}`;
  return (
    <a className={`lv-score${live ? ' live' : ''}`} href={g.href} data-status={g.status}>
      <div className="lv-lbl">
        <span>{g.leagueSlug.toUpperCase()}{g.week != null ? ` · Week ${g.week}` : ''}</span>
        {live ? <span className="l">{g.liveLabel}</span> : final ? <span>Final</span> : <span><StandaloneDate iso={g.kickoffAt} /></span>}
      </div>
      {/* League order, one rule: lib/gridiron/teamOrder.js. */}
      {orderFor(g.leagueSlug).map((side) => (
        <TeamLine
          key={side} t={side === 'home' ? g.home : g.away}
          trail={(live || final) && (side === 'home' ? awayLeads : homeLeads)}
          scored={live || final}
        />
      ))}
      {/* NO WIN-PROBABILITY BAR: no probability exists for gridiron (Part A
          3f), so the bar is omitted and the spread line stays. */}
      {/* FOOT: broadcaster first (match_broadcasters, R3), then the spread;
          right side is the box score once the game is on, the pick before. */}
      <div className="lv-sfoot">
        <span>{[g.network, spread].filter(Boolean).join(' · ') || (live ? 'Live' : final ? 'Final' : 'No line yet')}</span>
        <span>{live || final ? 'Box score →' : `Your pick: ${g.myPick ?? 'none'}`}</span>
      </div>
    </a>
  );
}

export default function LobbyV2({ v, signedIn = false, isShell = false, leagues = [], viewerTz = null }) {
  const signinHref = (dest) => shellSigninHref(dest, isShell);
  const initial = (v.handle ?? '').trim().charAt(0).toUpperCase() || 'Ȳ';
  const { daily, weekly, pickem, draft, intro } = v;
  return (
    <>
      <header className="lv-ah">
        {/* eslint-disable-next-line @next/next/no-img-element -- the brand PNG, as the sign-in page ships it */}
        <img className="lv-wm" alt="Sportsvyn" src={WORDMARK} width={1568} height={336} />
        <div className="lv-me">
          {signedIn
            ? (
              <>
                {v.streak > 0 && <span className="lv-streak"><b>{v.streak}</b> day streak</span>}
                <span className="lv-av" aria-label={v.handle ? `@${v.handle}` : 'You'}>{initial}</span>
              </>
            )
            : <a className="lv-signin" href={signinHref('/games')}>Sign in</a>}
        </div>
      </header>

      <div className="lv-intro">
        <div className="lv-eb">{weekdayEt(v.now)}{v.week != null && <> &middot; Week {v.week}</>}</div>
        <h1>Every day is <i>game day.</i></h1>
        {/* GO rider 1: rows lock at their own kickoff, so the line names the
            first kickoff; with a game live it counts what is live and what
            is still to pick. */}
        <p className="lv-line">
          {intro.live > 0
            ? <>{intro.live} live now.{intro.lock ? <> {intro.lock.toPick} {intro.lock.league} game{intro.lock.toPick === 1 ? '' : 's'} still to pick.</> : null}</>
            : <>{intro.open}{intro.lock && <> First of {numberWord(intro.lock.count)} {intro.lock.league} game{intro.lock.count === 1 ? '' : 's'} kicks <StandaloneDate iso={intro.lock.at} />.</>}</>}
        </p>
      </div>

      <div className="lv-games">
        <GameCard
          card={daily} hero signedIn={signedIn} signinHref={signinHref}
          sub={<>{daily.edition}{daily.closesAt ? <> &middot; closes <StandaloneDate iso={daily.closesAt} /></> : null}</>}
          right={daily.timeLeft}
        />
        <GameCard
          card={weekly} signedIn={signedIn} signinHref={signinHref}
          sub={weekly.sub}
          right={weekly.locksAt ? <>locks <StandaloneDate iso={weekly.locksAt} /></> : null}
        />
      </div>

      <div className="lv-minis">
        <MiniRow row={pickem} signedIn={signedIn} signinHref={signinHref} />
        <MiniRow row={draft} signedIn={signedIn} signinHref={signinHref} />
      </div>

      <div className="lv-sh"><div><h2>Draft room</h2><p>Practice for the Draft. Track the one you&rsquo;re in.</p></div></div>
      <div className="lv-tools" data-section="draft-room">
        <a className="lv-tool" href="/sim"><span className="lv-ico">M</span><span><strong>Mock draft</strong><small>Draft against the market &middot; same 30s clock as the Draft &middot; 12 presets</small></span><span className="arrow">&rarr;</span></a>
        <a className="lv-tool" href="/sim/tracker"><span className="lv-ico">T</span><span><strong>Draft tracker</strong><small>Drafting somewhere else? Log each pick, see who&rsquo;s left</small></span><span className="arrow">&rarr;</span></a>
        <div className="note"><b>Mock season is over,</b> not the mock. Every Draft room uses the mock&rsquo;s clock and board, so a mock is a practice run for the next room.</div>
      </div>

      <div className="lv-sh"><h2>{tonightTitle({ games: v.tonight, now: v.now, tz: viewerTz ?? 'America/New_York' })}</h2><a href="/scores">All scores &rarr;</a></div>
      <div className="lv-scores" data-section="tonight">
        {v.tonight.length === 0
          ? <p className="muted">No games on the board right now.</p>
          : v.tonight.map((g) => <ScoreCard key={g.id} g={g} />)}
      </div>

      {v.read && (
        <div className="lv-read" data-section="read">
          <div className="lv-eb q">Read the game</div>
          <h3>{v.read.title}</h3>
          <p>{v.read.dek ? `${v.read.dek} ` : ''}{v.read.readMin} min.</p>
          <a href={v.read.href}>Read the card &rarr;</a>
        </div>
      )}

      {!signedIn && (
        <div className="lob-stranger">
          <p className="lob-free">Free. An email and a handle. Nothing to install.</p>
          <Link className="ghost" href="/games/how-it-works">How to play each game &rarr;</Link>
        </div>
      )}

      {/* THE THREE PANES, as small links until they move under Rankings -
          nothing is orphaned. Your leagues rides along for the same reason. */}
      <div className="lv-more">
        <Link className="ghost" href="/games?pane=leaderboards">Leaderboards &rarr;</Link>
        <Link className="ghost" href="/games?pane=answer">Latest answer &rarr;</Link>
        <Link className="ghost" href="/games?pane=history">History &rarr;</Link>
        {signedIn && <Link className="ghost" href="/leagues">{leagues.length ? `Your leagues (${leagues.length})` : 'Start a league'} &rarr;</Link>}
        <Link className="ghost" href="/games/how-it-works">How the games work &rarr;</Link>
      </div>
    </>
  );
}


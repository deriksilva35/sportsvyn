// components/today/GamesBand.js - the four game cards.
//
// NEVER FILTERED. The Games band and the Daily Card readband sit above the
// league tuner and ignore it: the games are the product, and a reader who has
// turned EPL off has said nothing about whether they want to play the Daily.
//
// EVERY NUMBER HERE IS REAL STATE. The mock's "1/8 picked" is pickemCardData's
// {picked}/{total}; the lock line is pickemLockLine() (lib/today/gamesBandCards.js), never a
// hardcoded weekday - the same class of defect as the Week 0 label.

import { pickemLockLine, seasonGameCard } from '@/lib/today/gamesBandCards';
import { GAME_NAMES } from '@/lib/games/lobby';
import { plural } from '@/lib/text/plural';

function Card({ eyebrow, isNew, title, sub, cta, ctaClass = '', href, hot = false }) {
  return (
    <div className={`gcard${hot ? ' hot' : ''}`}>
      <div className="eb">
        {eyebrow}
        {isNew ? <span className="newpill">New</span> : null}
      </div>
      <h3>{title}</h3>
      <div className="st">{sub}</div>
      {href
        ? <a className={`gbtn ${ctaClass}`} href={href}>{cta}</a>
        : <span className={`gbtn ${ctaClass}`}>{cta}</span>}
    </div>
  );
}

export default function GamesBand({ daily, yesterday, pickem, weekly, draft, weeklyNextOpensAt = null, draftNextOpensAt = null }) {
  // Yesterday's result leads the Daily card, because it is what a returning
  // player wants first. Real fields: `perfect` is the day's perfect score and
  // `winner.score` the best anyone actually posted.
  const dailySub = yesterday?.perfect != null
    ? `Yesterday's perfect ${yesterday.perfect}${yesterday.winner?.score != null ? ` · top ${yesterday.winner.score}` : ''}`
    : 'One board a day · eight slots, three minutes';  // sat-5 Y2: v2 drops nothing

  // The lock line is DERIVED from the board's own first kickoff - a Pick'em
  // board seals per game at kickoff - and never a typed weekday. Same class of
  // defect as the Week 0 label this page just lost.
  // A SETTLED BOARD HAS NO GAMES-LEFT-TO-LOCK LINE TO SHOW (relay 2b item 6
  // gave pickemCardData() a settled shape with no total/nextKickoff at all,
  // for the lobby's own row) - this card falls back to naming the result
  // instead of rendering the games-count/lock line against fields that no
  // longer exist on that shape.
  const pickemSub = pickem?.settled
    ? (pickem.record ? `${pickem.record.correct} of ${pickem.record.played} · settled` : 'Settled')
    : pickem
      ? [plural(pickem.total, 'game'), pickemLockLine(pickem)].filter(Boolean).join(' · ')
      : null;
  // THE SEASON GAMES FROM THEIR OWN STATE (lib/today/gamesBandCards.js) - these
  // read weekly?.cta and weekly?.open, which no view ever had, so every card fell
  // through to a typed 'Opens Sep 8'.
  const wk = seasonGameCard('weekly', weekly, { nextOpensAt: weeklyNextOpensAt });
  const dr = seasonGameCard('draft', draft, { nextOpensAt: draftNextOpensAt });

  return (
    <>
      <div className="bmods four">
        {daily ? (
          <Card hot
            eyebrow={daily.edition ? `Edition No. ${daily.edition}` : 'The Daily'}
            title="The Daily" sub={dailySub}
            cta={daily.edition ? `Play Ed. ${daily.edition}` : 'Play today'}
            ctaClass="play" href="/daily/board" />
        ) : null}
        {pickem ? (
          <Card eyebrow={`Board ${pickem.boardNumber}`} isNew={!pickem.settled && !pickem.entered} title={GAME_NAMES.pickem}
            sub={pickemSub}
            cta={pickem.settled ? 'See results' : `${pickem.picked}/${pickem.total} picked · ${pickem.entered ? 'Finish board' : 'Make picks'}`}
            href="/pickem" />
        ) : null}
        {/* The ghost states are the readers' own: a game that has not opened
            says when it opens rather than pretending to be playable. */}
        <Card eyebrow="Season game" title="The Weekly"
          sub={wk.sub} cta={wk.cta} ctaClass={wk.open ? '' : 'ghosted'} href={wk.href} />
        <Card eyebrow="Season game" title="The Draft"
          sub={dr.sub} cta={dr.cta} ctaClass={dr.open ? '' : 'ghosted'} href={dr.href} />
      </div>
    </>
  );
}

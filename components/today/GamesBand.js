// components/today/GamesBand.js - the four game cards.
//
// NEVER FILTERED. The Games band and the Daily Card readband sit above the
// league tuner and ignore it: the games are the product, and a reader who has
// turned EPL off has said nothing about whether they want to play the Daily.
//
// EVERY NUMBER HERE IS REAL STATE. The mock's "1/8 picked" is pickemCardData's
// {picked}/{total}; the lock line is lockLabel(locksAt), never a hardcoded
// weekday - the same class of defect as the Week 0 label.

import { lockLabel } from '@/lib/pickem/read';
import { GAME_NAMES } from '@/lib/games/lobby';

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

export default function GamesBand({ daily, yesterday, pickem, weekly, draft }) {
  // Yesterday's result leads the Daily card, because it is what a returning
  // player wants first. Real fields: `perfect` is the day's perfect score and
  // `winner.score` the best anyone actually posted.
  const dailySub = yesterday?.perfect != null
    ? `Yesterday's perfect ${yesterday.perfect}${yesterday.winner?.score != null ? ` · top ${yesterday.winner.score}` : ''}`
    : 'One board a day · PPR, drop worst';

  // The lock line is DERIVED from the board's own first kickoff - a Pick'em
  // board seals per game at kickoff - and never a typed weekday. Same class of
  // defect as the Week 0 label this page just lost.
  const pickemSub = pickem
    ? `${pickem.total} games · locks ${lockLabel(pickem.nextKickoff)}`
    : null;

  return (
    <>
      <div className="bmods four">
        {daily ? (
          <Card hot
            eyebrow={daily.edition ? `Edition No. ${daily.edition}` : 'The Daily'}
            title="The Daily" sub={dailySub}
            cta={daily.edition ? `Play Ed. ${daily.edition}` : 'Play today'}
            ctaClass="play" href="/daily" />
        ) : null}
        {pickem ? (
          <Card eyebrow={`Board ${pickem.boardNumber}`} isNew={!pickem.entered} title={GAME_NAMES.pickem}
            sub={pickemSub}
            cta={`${pickem.picked}/${pickem.total} picked · ${pickem.entered ? 'Finish board' : 'Make picks'}`}
            href="/pickem" />
        ) : null}
        {/* The ghost states are the readers' own: a game that has not opened
            says when it opens rather than pretending to be playable. */}
        <Card eyebrow="Season game" title="The Weekly"
          sub={weekly?.sub ?? 'Six NFL players, best five count'}
          cta={weekly?.cta ?? 'Opens Sep 8'} ctaClass={weekly?.open ? '' : 'ghosted'}
          href={weekly?.open ? '/weekly' : null} />
        <Card eyebrow="Season game" title="The Draft"
          sub={draft?.sub ?? 'Eight picks feed a best six'}
          cta={draft?.cta ?? 'Opens Sep 8'} ctaClass={draft?.open ? '' : 'ghosted'}
          href={draft?.open ? '/draft' : null} />
      </div>
    </>
  );
}

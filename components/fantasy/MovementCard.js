'use client';

// components/fantasy/MovementCard.js — the /nfl instrument-column entry card.
//
// A VIEW of the movement board, not a second computation of it: every row here
// came out of getMovementBoard and carries the board's own band, so the card
// cannot show a mover the board withholds. The server slices the lists; this
// island owns only which tab is showing.
//
// THE CLIMBING TAB IS HIDDEN ENTIRELY WHILE DRIFT IS GATED. Not disabled, not
// empty, not present-with-a-dash - absent. `climbing === null` is the server
// saying "drift cannot be computed yet"; an empty array would mean "it can, and
// nobody is climbing", and those must not look alike. A greyed-out tab invites
// a click that can never be answered.
//
// FFC ATTRIBUTION TRAVELS WITH THIS COMPONENT, for the same reason FantasyBoard
// carries its own: this surface renders FFC ADP data, so the licence condition
// belongs to the component rather than to whichever page happens to mount it.

import { useState } from 'react';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';
import { CARD, cardEmpty } from './boardCopy';

const fmt1 = (v) => (v == null ? null : v.toFixed(1));
const signed = (v) => (v > 0 ? '+' : '') + v.toFixed(1);

function Row({ p, i, tab }) {
  // The inset accent is the band's, so the card and the board agree about who
  // counts as steam or sliding. Drift-ranked rows carry no accent - a long
  // quiet climb is not the same event as a one-morning jump.
  const accent = tab === 'climbing' ? '' : p.band.key === 'steam' ? ' steam' : p.band.key === 'sliding' ? ' sliding' : '';
  return (
    <div className={`mc-row${accent}`}>
      <span className="mc-rk">{i + 1}</span>
      <span className="mc-plr">
        <span className="mc-nm">{p.name}{p.isRookie ? <span className="mc-rkb">R</span> : null}</span>
        <span className="mc-pt">{p.position} · {p.team ?? ''}</span>
      </span>
      <span className="mc-adp">{fmt1(p.adp)}<em>{CARD.colAdp}</em></span>
      {tab === 'climbing' ? (
        <span className="mc-d3 pos">{p.drift}<em>{CARD.colDrift}</em></span>
      ) : (
        <span className={`mc-d3 ${p.d3 > 0.05 ? 'pos' : p.d3 < -0.05 ? 'neg' : 'flat'}`}>
          {signed(p.d3)}<em>{CARD.col3d}</em>
        </span>
      )}
    </div>
  );
}

export default function MovementCard({ card }) {
  const [tab, setTab] = useState('rising');

  // Built from what the server actually returned. Climbing is appended only
  // when the server sent a list at all.
  const TABS = [
    ['rising', CARD.tabs.rising],
    ['falling', CARD.tabs.falling],
    ...(card.climbing ? [['climbing', CARD.tabs.climbing]] : []),
  ];

  const open = card.gates.d3;
  const rows = tab === 'climbing' ? (card.climbing ?? []) : card[tab];
  const empty = cardEmpty(card.snapshotCount);

  return (
    <section className="mc" data-surface="ink">
      <div className="mc-head">
        <div>
          <div className="mc-lbl">{CARD.label}</div>
          <div className="mc-sub">{CARD.sub(card.format, card.size)}</div>
        </div>
        <a className="mc-all" href={CARD.href}>{CARD.all} <span aria-hidden="true">→</span></a>
      </div>

      {open ? (
        <>
          <div className="mc-tabs">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {rows.length === 0
            ? <div className="mc-flat">{CARD.flat}</div>
            : rows.map((p, i) => <Row key={p.ffcPlayerId} p={p} i={i} tab={tab} />)}
        </>
      ) : (
        <div className="mc-empty">
          <div className="h">{empty.head}</div>
          <div className="p">{empty.body}</div>
        </div>
      )}

      <div className="mc-foot">
        <span className="mc-stamp">{CARD.stamp(card.latestSnapshot)}</span>
        <a className="mc-cta" href={CARD.ctaHref}>{CARD.cta}</a>
      </div>
      <div className="mc-attr">
        {FFC_ATTRIBUTION.text} · <a href={FFC_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer">{FFC_ATTRIBUTION.host}</a>
      </div>
    </section>
  );
}

'use client';
// components/scores/ExpandCard.js - the arcade card, tappable (scores-v4 step 2).
//
// The card's face is rendered on the server and handed in as children; this
// adds the tap and the drawer under it. Tapping anywhere on the card (except a
// link inside it) opens the drawer:
//   · the LINE SCORE, by period, drawn at once from the row (the `line` prop,
//     built server-side by lib/scores/expand.js lineFor) - it never waits on
//     the network;
//   · KEY MOMENTS and the LAST 5 PLAYS, from /api/scores/expand/[league]/[slug],
//     which the edge caches 30 s while live and an hour once final.
// A live card re-reads on every open; any other card reads once.
import { useState, useRef } from 'react';

export function ExpandLine({ line }) {
  if (!line) return null;
  return (
    <table className="sv4-ls" data-line="1">
      <thead>
        <tr><th scope="col" />{line.columns.map((c) => <th key={c} scope="col">{c}</th>)}<th scope="col" className="t">{line.total}</th>{line.extra.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {line.rows.map((r) => (
          <tr key={r.side} data-side={r.side}>
            <th scope="row">{r.abbr}</th>
            {r.cells.map((v, i) => <td key={line.columns[i] ?? i}>{v}</td>)}
            <td className="t">{r.total}</td>
            {r.extra.map((v, i) => <td key={line.extra[i]}>{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Plays({ title, list, empty, section }) {
  return (
    <section className="sv4-xs" data-x={section}>
      <h3>{title}</h3>
      {list.length === 0 ? <p className="none">{empty}</p> : (
        <ol>
          {list.map((p, i) => (
            <li key={i} className={p.scoring ? 'sc' : undefined}>
              <span className="w">{p.when}</span>
              {p.score ? <b className="s">{p.score}</b> : null}
              <span className="tx">{p.abbr ? <em>{p.abbr} </em> : null}{p.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ExpandCard({ articleProps, league, slug, live = false, label, gameHref, line = null, expandable = true, children, fetcher = null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle');   // idle | loading | done | error
  const inflight = useRef(false);

  async function load() {
    if (inflight.current) return;
    if (state === 'done' && !live) return;
    inflight.current = true;
    setState((s) => (s === 'done' ? s : 'loading'));
    try {
      const get = fetcher ?? ((u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))));
      const d = await get(`/api/scores/expand/${league}/${slug}`);
      setData(d); setState('done');
    } catch {
      setState((s) => (s === 'done' ? s : 'error'));
    } finally {
      inflight.current = false;
    }
  }

  // A GAME THAT HAS NOT STARTED HAS NO PLAYS (thu-26). The panel used to
  // fetch them anyway and print "Key moments - No scoring yet / Last 5 plays -
  // No plays yet" under a 7:00 PM first pitch: two empty boxes saying what the
  // time already said. Before the start the panel is the line and the link.
  const upcoming = articleProps?.['data-variant'] === 'upcoming';

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !upcoming) load();
  }

  // THE LINE FROM THE ROW UNTIL THE FETCH HAS ONE: the payload's line is the
  // game page's own read and may be a poll newer, so it wins once it lands.
  const shown = data?.line ?? line;
  if (!expandable) {
    return (
      <article {...articleProps}>
        <a className="sv4-hit" href={gameHref} aria-label={label} />
        {children}
      </article>
    );
  }
  return (
    <article {...articleProps} data-open={open ? '1' : '0'}>
      <button type="button" className="sv4-hit" aria-expanded={open} aria-label={`${label}${open ? ', hide details' : ', show details'}`} onClick={toggle} />
      {children}
      {open ? (
        <div className="sv4-x" data-expanded="1">
          <ExpandLine line={shown} />
          {!upcoming && state === 'loading' ? <p className="sv4-xl" data-loading="1">Loading plays…</p> : null}
          {!upcoming && state === 'error' ? <p className="sv4-xl">Plays did not load. Tap to close and try again.</p> : null}
          {data && !upcoming ? (
            <>
              <Plays title="Key moments" section="scoring" list={data.scoring ?? []} empty="No scoring yet." />
              <Plays title="Last 5 plays" section="last" list={data.last ?? []} empty="No plays yet." />
            </>
          ) : null}
          <a className="sv4-xgo" href={gameHref}>Game page &rarr;</a>
        </div>
      ) : null}
    </article>
  );
}

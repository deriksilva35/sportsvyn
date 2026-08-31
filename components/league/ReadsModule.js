// components/league/ReadsModule.js — up to three published pieces for this code.
//
// ZERO ARTICLES, NO MODULE. Neither gridiron league has a published article
// today - every one on the platform belongs to a World Cup league - so this
// renders nothing on both, and appears the day one is published against their
// league_id with no further work. An empty Reads shell would be a promise.

import Link from 'next/link';

export default function ReadsModule({ reads }) {
  if (!reads?.length) return null;
  return (
    <section className="lgm" aria-label="Reads">
      <div className="lgm-h"><h2>Reads</h2></div>
      <div className="lgm-rows">
        {reads.map((a) => (
          <Link className="lgm-read" key={a.slug} href={`/article/${a.slug}`}>
            <span className="lgm-rt">{a.title}</span>
            {a.subtitle ? <span className="lgm-rd">{a.subtitle}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

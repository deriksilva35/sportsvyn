// components/games/preOpenLine.js - the Weekly's and Draft's pre-open pitch
// sentence, and ONLY that sentence.
//
// WHY THIS LIVES IN ITS OWN FILE, IMPORTING NOTHING BUT REACT (relay 2c
// item 1): a "&middot; " glued to the word before it survived a source-level
// grep clean, because the grep checked the JSX SOURCE and the bug is in the
// RENDERED OUTPUT - a text child that starts right after a closing tag and
// continues onto the next source line loses its own leading whitespace in
// JSX's line-based text-trimming, even though the source plainly has a
// space. Testing that requires actually rendering the JSX, and the page
// files that owned this sentence import `@/auth`, `next/navigation` and
// other Next-only aliases that do not resolve for a plain `node --test`
// render - so the sentence moved here, where it has nothing left to import
// but react, and a test can compile and render this one file in isolation.
//
// THE FIX: an explicit {' '} on BOTH sides of &middot;, not one. A single
// {' '} before the entity (as this file had, once, on only one side) still
// leaves the entity's own JSX text node starting a fresh line before the
// closing tag - the exact shape that loses its leading space.
//
// React IS imported (rather than left to the automatic runtime Next uses
// elsewhere) because lib/testing/renderJsx.mjs compiles this file standalone
// with the classic runtime, which needs the identifier in scope; Next's own
// build tolerates the explicit import exactly as well as its absence.
import React from 'react';

export function WeeklyPreOpenLine() {
  return (
    <p className="hero-line">
      One board of this week&rsquo;s actives{' '}&middot;{' '}edit until{' '}
      <b>first kickoff</b>{' '}&middot;{' '}results Tuesday morning
    </p>
  );
}

export function DraftPreOpenLine() {
  return (
    <p className="hero-line">
      Draft against the room{' '}&middot;{' '}<b>best ball</b>{' '}&middot;{' '}results Tuesday morning
    </p>
  );
}

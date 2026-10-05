// lib/time/zoneScan.mjs - find hard-coded time zones in source. Used by
// lib/time/zoneGuard.test.mjs; a module of its own so the scanner itself has a
// test and the guard is not a regex nobody has checked.
//
// WHAT COUNTS. Comments are removed first (a comment explaining why a rule is
// in Eastern is not output). In what is left, two things are counted per line:
//   - a zone abbreviation as a whole word: ET PT EDT EST PDT PST
//   - an IANA US zone literal: America/New_York, America/Los_Angeles, ...
// A line counts once however many it carries. The count per file is what the
// allowlist pins - so a NEW one in an allowlisted file fails as surely as one
// in a file that had none.

const ZONE_RE = /\b(?:ET|PT|EDT|EST|PDT|PST)\b|America\/(?:New_York|Los_Angeles|Chicago|Denver|Phoenix)/;

/** Source with // and /* *\/ comments blanked out; strings, templates kept. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote = null; // ' " `
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      else if (c === '\n' && quote !== '`') quote = null; // unterminated: recover at EOL
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      // a // inside a URL in JSX text ("https://...") is not a comment, but JSX
      // text never carries a zone we care about after it on the same line
      // closely enough to matter; treat as comment, the conservative read for
      // a guard is "fewer false hits", and a URL line holds no clock time.
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i += 1; }
      i += 2;
      continue;
    }
    if (c === '{' && d === '/' && src[i + 2] === '*') {
      // JSX comment {/* ... */}: blank it, keep the line breaks
      out += '{';
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** [{ line, text }] for each line of `src` that names a zone. */
export function zoneHits(src) {
  return stripComments(src).split('\n')
    .map((text, k) => ({ line: k + 1, text: text.trim() }))
    .filter((h) => ZONE_RE.test(h.text));
}

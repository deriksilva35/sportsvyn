// lib/migrations/sqlLex.mjs - a small Postgres lexer, just enough for the
// migration ledger. It knows the four things that can hide a semicolon or a
// keyword: -- and /* */ comments, 'quoted' and E'escaped' strings, "quoted"
// identifiers, and $tag$ dollar-quoted bodies. It is not a parser; it never
// needs to be one.
//
// Two outputs, for two different jobs:
//
//   splitTopLevel(sql)  the file's real statements, a DO block or a function
//                       body kept whole. Used to RUN a file (a migration that
//                       cannot sit in a transaction is run one statement at a
//                       time) and to find a file's own top-level BEGIN/COMMIT.
//
//   analysisFragments(sql)  comments gone, string contents blanked (a COMMENT
//                       ON ... IS 'we CREATE TABLE ...' must not look like
//                       DDL), and dollar-quote markers turned into statement
//                       breaks so the ALTER TABLE inside a DO $$ ... $$ guard
//                       is seen as an ALTER TABLE. Used only to READ a file
//                       for the backfill's object check, never to run one.

function scan(sql, { onDollar, blankStrings, dropComments }) {
  // Walks the text once and emits { out, cuts } where `out` is the rewritten
  // text and `cuts` are top-level semicolon offsets IN `out`.
  let out = '';
  const cuts = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += dropComments ? ' ' : sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      out += dropComments ? ' ' : sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      const prev = i > 0 ? sql[i - 1] : '';
      const escaped = (prev === 'E' || prev === 'e') && !/[A-Za-z0-9_]/.test(i > 1 ? sql[i - 2] : '');
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      j = Math.min(j + 1, n);
      out += blankStrings ? "''" : sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } break; }
        j++;
      }
      j = Math.min(j + 1, n);
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      const prev = i > 0 ? sql[i - 1] : '';
      if (m && !/[A-Za-z0-9_]/.test(prev)) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = sql.indexOf(tag, bodyStart);
        const bodyEnd = close === -1 ? n : close;
        const after = close === -1 ? n : close + tag.length;
        // Flatten only a CODE body (DO $$ ... $$, AS $$ ... $$ for a function);
        // a dollar-quoted VALUE (042 inserts a prompt as $$...$$) is a string.
        const isCode = /\b(?:DO|AS|LANGUAGE\s+[A-Za-z_]+)\s*$/i.test(out);
        if (onDollar === 'flatten' && !isCode) {
          out += blankStrings ? "''" : sql.slice(i, after);
        } else if (onDollar === 'flatten') {
          // The body is code we want to read: break statements at the markers
          // and lex the body recursively so its own comments/strings are handled.
          const inner = scan(sql.slice(bodyStart, bodyEnd), { onDollar, blankStrings, dropComments });
          cuts.push(out.length);
          out += ';';
          const base = out.length;
          for (const k of inner.cuts) cuts.push(base + k);
          out += inner.out;
          cuts.push(out.length);
          out += ';';
        } else {
          out += sql.slice(i, after);
        }
        i = after;
        continue;
      }
    }
    if (c === ';') { cuts.push(out.length); out += ';'; i++; continue; }
    out += c;
    i++;
  }
  return { out, cuts };
}

function cutInto(text, cuts) {
  const pieces = [];
  let start = 0;
  for (const k of cuts) {
    pieces.push({ text: text.slice(start, k), start, end: k + 1 });
    start = k + 1;
  }
  pieces.push({ text: text.slice(start), start, end: text.length });
  return pieces;
}

/**
 * The file's real top-level statements, verbatim (comments kept), with their
 * [start, end) offsets in the ORIGINAL text (end includes the ';').
 * Empty / comment-only statements are dropped.
 */
export function splitTopLevel(sql) {
  const { out, cuts } = scan(sql, { onDollar: 'keep', blankStrings: false, dropComments: false });
  // Nothing is rewritten in this mode, so offsets in `out` are offsets in `sql`.
  if (out !== sql) throw new Error('splitTopLevel: lexer rewrote text in verbatim mode');
  return cutInto(out, cuts)
    .map((p) => ({ ...p, code: codeOf(p.text) }))
    .filter((p) => p.code !== '');
}

/** A statement's text with comments removed and whitespace collapsed. */
export function codeOf(text) {
  const { out } = scan(text, { onDollar: 'keep', blankStrings: false, dropComments: true });
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Fragments for object analysis: comments dropped, string literals blanked to
 * '', dollar bodies flattened into fragments. Whitespace collapsed.
 */
export function analysisFragments(sql, { keepStrings = false } = {}) {
  const { out, cuts } = scan(sql, { onDollar: 'flatten', blankStrings: !keepStrings, dropComments: true });
  return cutInto(out, cuts)
    .map((p) => p.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

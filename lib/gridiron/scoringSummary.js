// lib/gridiron/scoringSummary.js - one short line for a scoring play, parsed
// from the feed's own sentence (thu-5). PURE.
//
//   "<Passer> <n>-yd TD pass to <Receiver>"
//   "<Runner> <n>-yd TD run"
//   "<Kicker> <n>-yd FG"
//   "Safety"
//   "<Player> <n>-yd <INT|fumble|punt|kick> return TD"
//   ... " · 2-pt <pass|run> good" when a two-point try succeeded
//
// DROPPED: the formation "(Shotgun)" / "(No Huddle, Shotgun)", the extra
// point, center and holder, penalty clauses, and "X reported in as eligible."
// / "Direct snap to X." prefixes - by construction, since only the named parts
// are extracted. A sentence none of the patterns reads falls back to its first
// clause; the row ellipsizes it on one line.

const NAME = "[A-Z][A-Za-z]*\\.[A-Z][A-Za-z.'-]*(?: (?:Jr\\.|Sr\\.|II|III|IV))?";
const yd = (n) => `${Number(n)}-yd`;

/** The sentence with the noise taken off the front. */
export function cleanPlayText(text) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i += 1) {
    const before = t;
    t = t.replace(/^\([^)]*\)\s*/, '')                       // (Shotgun), (No Huddle, Shotgun), (09:11)
      .replace(/^.*?reported in as eligible\.\s*/i, '')   // "L.Newman reported in as eligible." (names carry dots)
      .replace(/^Direct snap to \S+\.\s*/i, '')
      .trim();
    if (t === before) break;
  }
  return t;
}

/** "2-pt pass good" / "2-pt run good" / null. Only a try that succeeded is named. */
export function twoPointPart(text) {
  const m = /TWO-POINT CONVERSION ATTEMPT\.\s*(.*?)\s*ATTEMPT (SUCCEEDS|FAILS)/i.exec(String(text ?? ''));
  if (!m || m[2].toUpperCase() !== 'SUCCEEDS') return null;
  return / pass /i.test(` ${m[1]} `) ? '2-pt pass good' : '2-pt run good';
}

/** The first clause, for a sentence nothing above reads. */
export function firstClause(text) {
  const t = cleanPlayText(text);
  const m = /^(.*?)(?:[.,](?:\s|$)|$)/.exec(t);
  return (m?.[1] ?? t).trim();
}

/**
 * One scoring play's summary. `text` is plays.text; `playType` is used only as
 * a hint where the sentence itself does not say what kind of return it was.
 */
export function scoringSummary(text, { playType = '' } = {}) {
  const raw = String(text ?? '');
  const t = cleanPlayText(raw);
  const two = twoPointPart(raw);
  const withTwo = (s) => (two ? `${s} · ${two}` : s);
  const td = new RegExp(`(${NAME}) for (-?\\d+) yards?, TOUCHDOWN`);

  // RETURNS FIRST: an interception or fumble sentence also contains "pass".
  const ret = /INTERCEPTED by/i.test(t) ? 'INT'
    : /RECOVERED by/i.test(t) || /fumble-return/i.test(playType) ? 'fumble'
      : /\bpunts\b/i.test(t) || /punt-return/i.test(playType) ? 'punt'
        : /\bkicks\b/i.test(t) || /kick(off)?-return/i.test(playType) ? 'kick'
          : null;
  if (ret) {
    const all = [...t.matchAll(new RegExp(td.source, 'g'))];
    const m = all.at(-1);
    if (m) return withTwo(`${m[1]} ${yd(m[2])} ${ret} return TD`);
  }
  const pass = new RegExp(`^(${NAME}) pass(?: [a-z]+){0,2} to (${NAME})(?: to [^,]*?)? for (-?\\d+) yards?, TOUCHDOWN`).exec(t);
  if (pass) return withTwo(`${pass[1]} ${yd(pass[3])} TD pass to ${pass[2]}`);
  const run = new RegExp(`^(${NAME})(?: [a-z]+){0,4} for (-?\\d+) yards?, TOUCHDOWN`).exec(t);
  if (run) return withTwo(`${run[1]} ${yd(run[2])} TD run`);
  const fg = new RegExp(`^(${NAME}) (\\d+) yard field goal is GOOD`).exec(t);
  if (fg) return `${fg[1]} ${yd(fg[2])} FG`;
  if (/\bSAFETY\b/i.test(raw) || /safety/i.test(playType)) return 'Safety';
  return firstClause(raw);
}

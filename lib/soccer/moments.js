// lib/soccer/moments.js - a soccer match's goals and sendings-off, as the
// arcade card and the EPL game page draw them (thu-24). PURE.
//
// ONE SOURCE: match_events (is_current), the table the EPL live poller and the
// retired poll-live both wrote - 39 of PROD's 50 EPL finals carry it on 1 Oct.
// A VAR-cancelled goal is already absent there (lib/events.js flips it out).
//
// The rules, each measured on a matchweek-5 payload:
//   - a goal is a 'Goal' event that is not a missed penalty or a shootout kick;
//   - an own goal's team_side is the side it COUNTS FOR (Martinez, Man United,
//     20 Sep: stored on Fulham's side) - so it sits under the side that scored;
//   - a second yellow arrives as a yellow AND a 'Red Card' for the same player:
//     one sending-off, drawn once.

const shootout = (r) => /penalty shootout/i.test(r.comments ?? r.raw?.comments ?? '');

/** match_events rows -> { goals, reds } in match order. */
export function momentsFromEvents(rows = []) {
  const ordered = [...rows].sort((a, b) => (a.minute - b.minute) || ((a.minute_extra ?? 0) - (b.minute_extra ?? 0)) || ((a.id ?? 0) - (b.id ?? 0)));
  const goals = []; const reds = []; const sent = new Set();
  for (const r of ordered) {
    if (r.is_current === false) continue;
    if (r.event_type === 'Goal') {
      if (/missed/i.test(r.detail ?? '') || shootout(r)) continue;
      goals.push({
        minute: r.minute, extra: r.minute_extra ?? null, side: r.team_side,
        player: r.player_name ?? null, assist: r.assist_name ?? null,
        kind: /own goal/i.test(r.detail ?? '') ? 'own' : /penalty/i.test(r.detail ?? '') ? 'penalty' : 'goal',
      });
    } else if (r.event_type === 'Card' && /red card|second yellow/i.test(r.detail ?? '')) {
      const key = `${r.team_side}:${r.player_name}`;
      if (sent.has(key)) continue;
      sent.add(key);
      reds.push({ minute: r.minute, extra: r.minute_extra ?? null, side: r.team_side, player: r.player_name ?? null });
    }
  }
  return { goals, reds };
}

const PARTICLES = new Set(['van', 'von', 'de', 'da', 'dos', 'das', 'di', 'del', 'der', 'den', 'le', 'la', 'ten', 'ter', 'mac']);
/** 'T. Barry' -> 'Barry'; 'J. P. van Hecke' -> 'van Hecke'; 'Abdul Fatawu Issahaku' -> 'Issahaku'. */
export function surname(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  let i = parts.length - 1;
  while (i > 0 && PARTICLES.has(parts[i - 1].toLowerCase())) i -= 1;
  return parts.slice(i).join(' ');
}

/** 90+4 -> "90+4'". */
export const minuteText = (m, extra) => `${m}${extra ? `+${extra}` : ''}'`;

/**
 * One side's lines for the card: a scorer once with all his minutes
 * ("Brobbey 12', 33', 59'"), (OG) / (P) marked, then the sendings-off.
 * @returns [{ key, kind: 'goal'|'red', text, label }]
 */
export function sideLines({ goals = [], reds = [] } = {}, side) {
  const out = [];
  const by = new Map();
  for (const g of goals.filter((x) => x.side === side)) {
    const tag = g.kind === 'own' ? ' (OG)' : g.kind === 'penalty' ? ' (P)' : '';
    const k = `${g.player}|${g.kind === 'own' ? 'own' : 'for'}`;
    if (!by.has(k)) { by.set(k, { name: surname(g.player), mins: [] }); }
    by.get(k).mins.push(`${minuteText(g.minute, g.extra)}${tag}`);
  }
  for (const [k, v] of by) out.push({ key: `g:${k}`, kind: 'goal', text: `${v.name} ${v.mins.join(', ')}`, label: `Goal, ${v.name}, ${v.mins.join(', ')}` });
  for (const r of reds.filter((x) => x.side === side)) {
    out.push({ key: `r:${r.player}`, kind: 'red', text: `${surname(r.player)} ${minuteText(r.minute, r.extra)}`, label: `Red card, ${surname(r.player)}, ${minuteText(r.minute, r.extra)}` });
  }
  return out;
}

/** Both sides' lines, or null when there is nothing to draw. */
export function cardMoments(m) {
  if (!m) return null;
  const home = sideLines(m, 'home'); const away = sideLines(m, 'away');
  return home.length || away.length ? { home, away } : null;
}

/** The game page's list: every goal and sending-off in match order, one line each. */
export function momentList(m, { homeAbbr = '', awayAbbr = '' } = {}) {
  if (!m) return [];
  const ab = (s) => (s === 'home' ? homeAbbr : awayAbbr);
  let h = 0; let a = 0;
  const all = [
    ...m.goals.map((g) => ({ ...g, t: 'goal' })),
    ...m.reds.map((r) => ({ ...r, t: 'red' })),
  ].sort((x, y) => (x.minute - y.minute) || ((x.extra ?? 0) - (y.extra ?? 0)));
  return all.map((e) => {
    if (e.t === 'goal') { if (e.side === 'home') h += 1; else a += 1; }
    const what = e.t === 'red' ? 'Red card'
      : `${e.kind === 'own' ? 'Own goal' : e.kind === 'penalty' ? 'Penalty' : 'Goal'}${e.assist && e.kind === 'goal' ? ` (${surname(e.assist)})` : ''}`;
    return {
      kind: e.t, side: e.side, when: minuteText(e.minute, e.extra), abbr: ab(e.side),
      text: `${surname(e.player)} - ${what}`,
      score: e.t === 'goal' ? `${homeAbbr} ${h} - ${awayAbbr} ${a}` : null,
    };
  });
}

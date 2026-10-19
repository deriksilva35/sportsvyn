/**
 * lib/emails/morning.js - THE MORNING EMAIL (ruling thu-1). PURE: data in,
 * { subject, preheader, html, text } out.
 *
 * DRAFT BODY (sun-2): the content spec was not on the droplet, so this is the
 * body Derik reviews in the Monday test send. Four short blocks, each only
 * when it has something true to say:
 *   1. TODAY'S DAILY      the one primary button
 *   2. YOUR YESTERDAY     your Daily score and place, if you played
 *   3. GAME OF THE DAY    the marquee game on today's slate
 *   4. LOCKING TODAY      boards that lock today, and whether you're in
 * then the way out. The light arcade look of the 15 Oct broadcast: white
 * ground, indigo #1A1650, lime #D4FF00 buttons, Rubik with Arial fallbacks.
 * Table layout, inline styles only (mail clients strip the rest).
 *
 * HYPHENS ONLY. No em or en dashes anywhere in the copy.
 */

export const MORNING_FOOTER = "You're getting this because you play on Sportsvyn. Turn it off any time at sportsvyn.com/you.";

const INK = '#1A1650';
const MUTED = '#4A4870';
const LINE = '#E4E3EE';
const LIME = '#D4FF00';
const FONT = "Rubik,'Helvetica Neue',Arial,sans-serif";
const MONO = "'Rubik Mono One','Arial Black',Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (x) => (x == null ? '' : Number(x).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

/** "Mon, Oct 19" from an ET date. */
export function dayLine(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The subject: the one thing worth opening for, most specific first. */
export function morningSubject({ day, yesterday = null, game = null }) {
  if (yesterday?.rank && yesterday?.of) return `You were ${ordinal(yesterday.rank)} of ${yesterday.of} yesterday - today's Daily is live`;
  if (game) return `${game.away} at ${game.home} today - and a new Daily`;
  return `Today's Daily is live - ${dayLine(day)}`;
}

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${LIME};color:${INK};font-family:${MONO};font-size:13px;letter-spacing:0.04em;text-decoration:none;padding:14px 22px;border-radius:99px;">${esc(label)}</a>`;
const kicker = (t) => `<div style="font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:${INK};padding:0 0 8px;">${esc(t)}</div>`;
const block = (inner) => `<tr><td style="padding:18px 24px;border-top:1px solid ${LINE};">${inner}</td></tr>`;

/**
 * day: ET date. links: { daily, game?, you, unsubscribe } (absolute, possibly
 * click-tracked). yesterday: { score, rank, of } | null. game: { away, home,
 * time, league } | null. locks: [{ label, time, entered, href }].
 */
export function buildMorningEmail({ day, wordmarkUrl, links, yesterday = null, game = null, locks = [] }) {
  const subject = morningSubject({ day, yesterday, game });
  const preheader = 'Your Daily, your yesterday and what locks today.';

  const parts = [];
  parts.push(block(`${kicker(`THE DAILY - ${dayLine(day).toUpperCase()}`)}
    <div style="font-family:${FONT};font-size:16px;line-height:1.45;color:${INK};padding:0 0 14px;">A new board is up. Build your lineup before midnight ET.</div>
    ${button(links.daily, "Play today's Daily")}`));
  if (yesterday) {
    parts.push(block(`${kicker('YOUR YESTERDAY')}
      <div style="font-family:${FONT};font-size:16px;line-height:1.45;color:${INK};">${yesterday.rank && yesterday.of
        ? `<b>${esc(nf(yesterday.score))}</b> - ${esc(ordinal(yesterday.rank))} of ${esc(yesterday.of)} players.`
        : `<b>${esc(nf(yesterday.score))}</b> on the Daily.`}</div>`));
  }
  if (game) {
    parts.push(block(`${kicker('GAME OF THE DAY')}
      <div style="font-family:${FONT};font-size:16px;line-height:1.45;color:${INK};"><a href="${esc(links.game ?? links.scores)}" style="color:${INK};font-weight:700;text-decoration:underline;">${esc(game.away)} at ${esc(game.home)}</a></div>
      <div style="font-family:${FONT};font-size:13px;color:${MUTED};padding-top:4px;">${esc([game.league, game.time].filter(Boolean).join(' - '))}</div>`));
  }
  if (locks.length) {
    const rows = locks.map((l) => `<tr>
        <td style="font-family:${FONT};font-size:15px;color:${INK};padding:4px 0;"><a href="${esc(l.href)}" style="color:${INK};text-decoration:underline;">${esc(l.label)}</a></td>
        <td style="font-family:${FONT};font-size:13px;color:${MUTED};padding:4px 0;text-align:right;white-space:nowrap;">${esc(l.entered ? `You're in - locks ${l.time}` : `Locks ${l.time}`)}</td>
      </tr>`).join('');
    parts.push(block(`${kicker('LOCKING TODAY')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`));
  }

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#FFFFFF;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td align="center" style="padding:8px 24px 18px;">
          <img src="${esc(wordmarkUrl)}" alt="Sportsvyn" width="180" style="display:block;border:0;width:180px;height:auto;">
          <div style="padding-top:6px;font-family:${MONO};font-size:9px;letter-spacing:0.22em;color:${MUTED};">THE ARCADE OF SPORTS</div>
        </td></tr>
        ${parts.join('\n')}
        <tr><td style="padding:18px 24px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">
          ${esc(MORNING_FOOTER)}<br><a href="${esc(links.unsubscribe)}" style="color:${MUTED};">Unsubscribe from all email</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `THE DAILY - ${dayLine(day)}`,
    `A new board is up. Build your lineup before midnight ET.`,
    `Play today's Daily: ${links.daily}`,
    yesterday ? `\nYOUR YESTERDAY\n${nf(yesterday.score)}${yesterday.rank && yesterday.of ? ` - ${ordinal(yesterday.rank)} of ${yesterday.of} players.` : ' on the Daily.'}` : null,
    game ? `\nGAME OF THE DAY\n${game.away} at ${game.home}${game.time ? ` - ${game.time}` : ''}\n${links.game ?? links.scores}` : null,
    locks.length ? `\nLOCKING TODAY\n${locks.map((l) => `${l.label} - ${l.entered ? "you're in, " : ''}locks ${l.time}: ${l.href}`).join('\n')}` : null,
    `\n---\n${MORNING_FOOTER}\nUnsubscribe from all email: ${links.unsubscribe}`,
  ].filter(Boolean).join('\n');

  return { subject, preheader, html, text };
}

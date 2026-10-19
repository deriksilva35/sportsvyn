/**
 * lib/emails/morning.js - THE MORNING EMAIL (ruling thu-1; body to the thu-1 spec,
 * mon-1). PURE: module content in, { subject, preheader, html, text } out. The
 * content is decided in lib/email/morningModules.js; every module is optional
 * and a missing one is simply not in the mail.
 *
 *   1 headline            one line from the day
 *   2 yesterday's Daily   the answer, how many played, the top 3
 *   3 today's Daily       the one primary button
 *   4 this week           game counts by sport, Mon-Sun, today in bold
 *   5 game of the day     playoff > rivalry > closest line
 *   6 free to play        three open games, a button each
 *   7 YOUR MOVE           players only: your yesterday + your entries locking today
 *   8 spotlight           one feature a day; "Get the app" only without an iOS device
 *   9 footer              why you get it, where to turn it off, unsubscribe
 *
 * The light arcade look of the 15 Oct broadcast: white ground, indigo #1A1650,
 * lime #D4FF00 buttons, Rubik with Arial fallbacks. Table layout, inline styles.
 * Text and HTML only - no images beyond the wordmark. No coins anywhere.
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

/** THE SUBJECT: built from the day, honest, the most specific true thing first. */
export function morningSubject({ day, headline = null, yesterday = null, game = null, heroLine = null }) {
  // AN OPENER DAY LEADS WITH IT (mon-1 addendum): "NBA opening night: 3 games tonight - make your picks".
  if (heroLine) return heroLine;
  if (yesterday?.rank && yesterday?.of) return `You were ${ordinal(yesterday.rank)} of ${yesterday.of} yesterday - today's Daily is live`;
  if (headline) return `${headline} - and a new Daily`;
  if (game) return `${game.away} at ${game.home} today - and a new Daily`;
  return `Today's Daily is live - ${dayLine(day)}`;
}

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${LIME};color:${INK};font-family:${MONO};font-size:13px;letter-spacing:0.04em;text-decoration:none;padding:14px 22px;border-radius:99px;">${esc(label)}</a>`;
const small = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${LIME};color:${INK};font-family:${MONO};font-size:11px;letter-spacing:0.04em;text-decoration:none;padding:9px 14px;border-radius:99px;white-space:nowrap;">${esc(label)}</a>`;
const kicker = (t) => `<div style="font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:${INK};padding:0 0 8px;">${esc(t)}</div>`;
const para = (html, size = 16) => `<div style="font-family:${FONT};font-size:${size}px;line-height:1.45;color:${INK};">${html}</div>`;
const note = (html) => `<div style="font-family:${FONT};font-size:13px;line-height:1.45;color:${MUTED};padding-top:4px;">${html}</div>`;
const block = (inner) => `<tr><td style="padding:18px 24px;border-top:1px solid ${LINE};">${inner}</td></tr>`;

/**
 * day: ET date. links: { daily, scores, game?, unsubscribe, app } (absolute).
 * m: { headline, yesterdayDaily, week, game, free, move, spotlight } - each optional.
 */
export function buildMorningEmail({ day, wordmarkUrl, links, m = {} }) {
  const { hero = null, headline = null, yesterdayDaily = null, week = null, game = null, free = null, move = null, spotlight = null } = m;
  const subject = morningSubject({ day, headline, yesterday: move?.yesterday, game, heroLine: hero?.subject ?? null });
  const preheader = headline ?? 'Your Daily, the week in sports and what is free to play.';
  const parts = [];
  const text = [];

  // 0 HERO - a season opener only (mon-1 addendum): the eyebrow, tonight's
  // games with tip times, one big button, the confidence line when tonight's
  // board is a confidence board, and the draft-prep line.
  if (hero) {
    const games = hero.games.map((g) => `<tr><td style="font-family:${FONT};font-size:16px;color:${INK};padding:5px 0;font-weight:700;">${esc(g.away)} at ${esc(g.home)}</td></tr>
        <tr><td style="font-family:${FONT};font-size:13px;color:${MUTED};padding:0 0 6px;">${esc(g.time)}</td></tr>`).join('');
    parts.push(`<tr><td style="padding:20px 24px 22px;background:${INK};border-radius:16px;">
      <div style="font-family:${MONO};font-size:28px;line-height:1.1;color:${LIME};padding-bottom:12px;">${esc(hero.eyebrow)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;"><tr><td style="padding:10px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${games}</table>
      </td></tr></table>
      <div style="padding-top:16px;"><a href="${esc(hero.href)}" style="display:block;text-align:center;background:${LIME};color:${INK};font-family:${MONO};font-size:16px;letter-spacing:0.04em;text-decoration:none;padding:18px 22px;border-radius:99px;">${esc(hero.cta)}</a></div>
      ${hero.confidenceLine ? `<div style="font-family:${FONT};font-size:14px;color:#FFFFFF;text-align:center;padding-top:10px;">${esc(hero.confidenceLine)}</div>` : ''}
    </td></tr>
    <tr><td style="padding:12px 24px 4px;text-align:center;font-family:${FONT};font-size:15px;"><a href="${esc(hero.prepHref)}" style="color:${INK};font-weight:700;text-decoration:underline;">${esc(hero.prep.label)}</a></td></tr>`);
    text.push(hero.eyebrow, ...hero.games.map((g) => `${g.away} at ${g.home} - ${g.time}`), `${hero.cta}: ${hero.href}`,
      ...(hero.confidenceLine ? [hero.confidenceLine] : []), `${hero.prep.label}: ${hero.prepHref}`, '');
  }
  // 1 HEADLINE
  if (headline) {
    parts.push(`<tr><td style="padding:4px 24px 18px;font-family:${MONO};font-size:20px;line-height:1.25;color:${INK};text-align:center;">${esc(headline)}</td></tr>`);
    text.push(headline.toUpperCase(), '');
  }
  // 2 YESTERDAY'S DAILY
  if (yesterdayDaily) {
    const top = yesterdayDaily.top.map((t, i) => `${i + 1}. <b>${esc(t.name)}</b> ${esc(nf(t.score))}`).join('<br>');
    parts.push(block(`${kicker("YESTERDAY'S DAILY")}${para(esc(yesterdayDaily.answer), 15)}
      ${note(`${esc(nf(yesterdayDaily.played))} played.${top ? ' Top 3:' : ''}`)}${top ? para(top, 15) : ''}`));
    text.push("YESTERDAY'S DAILY", yesterdayDaily.answer, `${nf(yesterdayDaily.played)} played.`,
      ...yesterdayDaily.top.map((t, i) => `${i + 1}. ${t.name} ${nf(t.score)}`), '');
  }
  // 3 TODAY'S DAILY
  parts.push(block(`${kicker(`THE DAILY - ${dayLine(day).toUpperCase()}`)}
    ${para('A new board is up. Build your lineup before midnight ET.')}
    <div style="padding-top:14px;">${button(links.daily, "Play today's Daily")}</div>`));
  text.push(`THE DAILY - ${dayLine(day)}`, 'A new board is up. Build your lineup before midnight ET.', `Play today's Daily: ${links.daily}`, '');
  // 4 THIS WEEK IN SPORTS
  if (week) {
    const cell = (v, bold) => `<td align="center" style="font-family:${FONT};font-size:13px;color:${INK};padding:5px 2px;${bold ? `font-weight:700;background:${LIME};` : ''}">${esc(v)}</td>`;
    const head = `<tr><td></td>${week.days.map((d) => cell(d.dow, d.today)).join('')}</tr>`;
    const rows = week.rows.map((r) => `<tr><td style="font-family:${MONO};font-size:10px;color:${INK};padding:5px 6px 5px 0;">${esc(r.league)}</td>${r.cells.map((n, i) => cell(n || '-', week.days[i].today)).join('')}</tr>`).join('');
    parts.push(block(`${kicker('THIS WEEK IN SPORTS')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${head}${rows}</table>`));
    text.push('THIS WEEK IN SPORTS', `      ${week.days.map((d) => (d.today ? `*${d.dow}*` : d.dow)).join(' ')}`,
      ...week.rows.map((r) => `${r.league.padEnd(5)} ${r.cells.map((n, i) => (week.days[i].today ? `*${n}*` : String(n))).join(' ')}`), '');
  }
  // 5 GAME OF THE DAY
  if (game) {
    parts.push(block(`${kicker('GAME OF THE DAY')}
      ${para(`<a href="${esc(links.game ?? links.scores)}" style="color:${INK};font-weight:700;text-decoration:underline;">${esc(game.away)} at ${esc(game.home)}</a>`)}
      ${note(esc([game.league, game.time, game.why === 'rivalry' ? 'a rivalry' : game.why === 'closest line' ? `the closest line today${game.spread != null ? ` (${nf(game.spread)})` : ''}` : null].filter(Boolean).join(' - ')))}`));
    text.push('GAME OF THE DAY', `${game.away} at ${game.home}${game.time ? ` - ${game.time}` : ''}`, links.game ?? links.scores, '');
  }
  // 6 FREE TO PLAY THIS WEEK
  if (free?.length) {
    const rows = free.map((f) => `<tr>
        <td style="font-family:${FONT};font-size:15px;color:${INK};padding:6px 0;">${esc(f.label)}<div style="font-size:12px;color:${MUTED};">Locks ${esc(f.time)}</div></td>
        <td align="right" style="padding:6px 0;">${small(f.href, 'Play')}</td>
      </tr>`).join('');
    parts.push(block(`${kicker('FREE TO PLAY THIS WEEK')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`));
    text.push('FREE TO PLAY THIS WEEK', ...free.map((f) => `${f.label} - locks ${f.time}: ${f.href}`), '');
  }
  // 7 YOUR MOVE
  if (move) {
    const y = move.yesterday;
    const yLine = y ? (y.rank && y.of ? `Yesterday's Daily: <b>${esc(nf(y.score))}</b>, ${esc(ordinal(y.rank))} of ${esc(y.of)}.` : `Yesterday's Daily: <b>${esc(nf(y.score))}</b>.`) : '';
    const locks = move.locks.map((l) => `<a href="${esc(l.href)}" style="color:${INK};text-decoration:underline;">${esc(l.label)}</a> - you're in, locks ${esc(l.time)}`).join('<br>');
    parts.push(block(`${kicker('YOUR MOVE')}${yLine ? para(yLine, 15) : ''}${locks ? para(locks, 15) : ''}`));
    text.push('YOUR MOVE', ...(y ? [`Yesterday's Daily: ${nf(y.score)}${y.rank && y.of ? `, ${ordinal(y.rank)} of ${y.of}` : ''}.`] : []),
      ...move.locks.map((l) => `${l.label} - you're in, locks ${l.time}: ${l.href}`), '');
  }
  // 8 SPOTLIGHT
  if (spotlight) {
    const go = spotlight.href ? ` <a href="${esc(spotlight.href)}" style="color:${INK};font-weight:700;">Try it</a>` : '';
    const app = spotlight.appLink && links.app ? `<div style="padding-top:10px;">${small(links.app, 'Get the app')}</div>` : '';
    parts.push(block(`${kicker(`SPOTLIGHT - ${spotlight.title.toUpperCase()}`)}${para(`${esc(spotlight.line)}${go}`, 15)}${app}`));
    text.push(`SPOTLIGHT - ${spotlight.title}`, spotlight.line, ...(spotlight.href ? [spotlight.href] : []), ...(spotlight.appLink && links.app ? [`Get the app: ${links.app}`] : []), '');
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

  text.push('---', MORNING_FOOTER, `Unsubscribe from all email: ${links.unsubscribe}`);
  return { subject, preheader, html, text: text.join('\n') };
}

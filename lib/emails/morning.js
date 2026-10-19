/**
 * lib/emails/morning.js - THE MORNING EMAIL (ruling thu-1; the thu-1 body, mon-1;
 * the v2 layout with pictures, mon-3). PURE: module content in, { subject,
 * preheader, html, text } out. Every module is optional and a missing one is
 * not in the mail; the rules live in lib/email/morningModules.js.
 *
 *   0 hero              opener days only: the hero picture, "Make your picks", the mock link
 *   1 headline          one line from the day - NOT under a hero (the hero says it)
 *   2 yesterday's Daily the perfect lineup as a grid, the top players, how many played
 *   3 today's Daily     the one primary button
 *   6 free to play      a 1x3 row of empty game tiles, "Play" under each
 *   5 game of the day   a big chip, its line, "Game page"; "Also tonight" under it
 *   4 this week         game counts by sport, Mon-Sun, today marked, "*" = only if needed
 *   7 YOUR MOVE         players only, with status pills
 *   8 spotlight         a lock-screen preview; "Get the app" only without an iOS device
 *   9 footer
 * PACIFIC FIRST everywhere ("4:00 PM PT / 7:00 PM ET"). Pictures are the public
 * /og/email/* PNGs drawn at 2x, alt text = matchup and time; no reader in any URL.
 * The light arcade look: white, indigo #1A1650, lime #D4FF00, Rubik with Arial
 * fallbacks. Table layout, inline styles. No coins anywhere.
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

const button = (href, label, { big = false, block = false } = {}) => `<a href="${esc(href)}" style="display:${block ? 'block' : 'inline-block'};text-align:center;background:${LIME};color:${INK};font-family:${MONO};font-size:${big ? 16 : 13}px;letter-spacing:0.04em;text-decoration:none;padding:${big ? '18px 22px' : '14px 22px'};border-radius:99px;">${esc(label)}</a>`;
const small = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${LIME};color:${INK};font-family:${MONO};font-size:11px;letter-spacing:0.04em;text-decoration:none;padding:9px 14px;border-radius:99px;white-space:nowrap;">${esc(label)}</a>`;
const pill = (label, on = true) => `<span style="display:inline-block;background:${on ? LIME : '#F2F2EF'};color:${INK};font-family:${MONO};font-size:10px;letter-spacing:0.04em;padding:4px 10px;border-radius:99px;white-space:nowrap;">${esc(label)}</span>`;
const kicker = (t) => `<div style="font-family:${MONO};font-size:11px;letter-spacing:0.08em;color:${INK};padding:0 0 8px;">${esc(t)}</div>`;
const para = (html, size = 16) => `<div style="font-family:${FONT};font-size:${size}px;line-height:1.45;color:${INK};">${html}</div>`;
const note = (html) => `<div style="font-family:${FONT};font-size:13px;line-height:1.45;color:${MUTED};padding-top:4px;">${html}</div>`;
const block = (inner) => `<tr><td style="padding:18px 24px;border-top:1px solid ${LINE};">${inner}</td></tr>`;
// A PICTURE: 2x pixels shown at `width`, alt text always (images off still reads).
const picture = (src, alt, width) => `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}" style="display:block;border:0;width:100%;max-width:${width}px;height:auto;font-family:${FONT};font-size:14px;color:${INK};">`;

/**
 * day: ET date. links: { daily, scores, unsubscribe, app } (absolute).
 * m: { hero, headline, yesterdayDaily, week, game, free, move, spotlight } - each optional.
 */
export function buildMorningEmail({ day, wordmarkUrl, links, m = {} }) {
  const { hero = null, headline = null, yesterdayDaily = null, week = null, game = null, free = null, move = null, spotlight = null } = m;
  const subject = morningSubject({ day, headline, yesterday: move?.yesterday, game, heroLine: hero?.subject ?? null });
  const preheader = hero?.subject ?? headline ?? 'Your Daily, the week in sports and what is free to play.';
  const parts = [];
  const text = [];

  // 0 HERO - the picture (eyebrow, NBA IS BACK, tonight's chips), the big
  // button, the confidence line when tonight's board is one, the mock link.
  if (hero) {
    const head = hero.img ? `<a href="${esc(hero.href)}" style="text-decoration:none;">${picture(hero.img, hero.alt ?? hero.eyebrow, 512)}</a>`
      : `<div style="font-family:${MONO};font-size:28px;line-height:1.1;color:${INK};text-align:center;">${esc(hero.eyebrow)}</div>`;
    parts.push(`<tr><td style="padding:0 24px 8px;">${head}
      <div style="padding-top:16px;">${button(hero.href, hero.cta, { big: true, block: true })}</div>
      ${hero.confidenceLine ? `<div style="font-family:${FONT};font-size:14px;color:${INK};text-align:center;padding-top:10px;">${esc(hero.confidenceLine)}</div>` : ''}
      <div style="padding:12px 0 6px;text-align:center;font-family:${FONT};font-size:15px;"><a href="${esc(hero.prepHref)}" style="color:${INK};font-weight:700;text-decoration:underline;">${esc(hero.prep.label)}</a></div>
    </td></tr>`);
    text.push(hero.eyebrow, ...hero.games.map((g) => `${g.away} at ${g.home} - ${g.time}`), `${hero.cta}: ${hero.href}`,
      ...(hero.confidenceLine ? [hero.confidenceLine] : []), `${hero.prep.label}: ${hero.prepHref}`, '');
  }
  // 1 HEADLINE - never under a hero (mon-3).
  if (headline && !hero) {
    parts.push(`<tr><td style="padding:4px 24px 18px;font-family:${MONO};font-size:20px;line-height:1.25;color:${INK};text-align:center;">${esc(headline)}</td></tr>`);
    text.push(headline.toUpperCase(), '');
  }
  // 2 YESTERDAY'S DAILY - the perfect lineup as a grid, the top players, the played count.
  if (yesterdayDaily) {
    const lineup = yesterdayDaily.lineup ?? [];
    const cells = lineup.map((p) => `<td width="50%" style="padding:3px;"><div style="border:1px solid ${LINE};border-radius:10px;padding:7px 10px;">
        <div style="font-family:${MONO};font-size:9px;letter-spacing:0.06em;color:${MUTED};">${esc(p.slot)}</div>
        <div style="font-family:${FONT};font-size:14px;font-weight:700;color:${INK};">${esc(p.name)}</div></div></td>`);
    const grid = [];
    for (let i = 0; i < cells.length; i += 2) grid.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td></td>'}</tr>`);
    const top = yesterdayDaily.top.map((t, i) => `<tr><td style="font-family:${MONO};font-size:11px;color:${MUTED};padding:3px 8px 3px 0;width:18px;">${i + 1}</td><td style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};">${esc(t.name)}</td><td align="right" style="font-family:${FONT};font-size:15px;color:${INK};">${esc(nf(t.score))}</td></tr>`).join('');
    const lead = yesterdayDaily.ceiling != null ? `The perfect lineup${yesterdayDaily.seasonYear ? ` (${esc(yesterdayDaily.seasonYear)})` : ''} scored <b style="color:${INK};">${esc(nf(yesterdayDaily.ceiling))}</b>.` : esc(yesterdayDaily.answer);
    parts.push(block(`${kicker("YESTERDAY'S DAILY")}${note(lead)}
      ${grid.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${grid.join('')}</table>` : ''}
      ${top ? `<div style="padding-top:14px;">${kicker('TOP PLAYERS')}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${top}</table>` : ''}
      ${note(`${esc(nf(yesterdayDaily.played))} played.`)}`));
    text.push("YESTERDAY'S DAILY", yesterdayDaily.answer, ...lineup.map((p) => `${p.slot} ${p.name}`),
      ...yesterdayDaily.top.map((t, i) => `${i + 1}. ${t.name} ${nf(t.score)}`), `${nf(yesterdayDaily.played)} played.`, '');
  }
  // 3 TODAY'S DAILY
  parts.push(block(`${kicker(`THE DAILY - ${dayLine(day).toUpperCase()}`)}
    ${para('A new board is up. Build your lineup before midnight ET.')}
    <div style="padding-top:14px;">${button(links.daily, "Play today's Daily")}</div>`));
  text.push(`THE DAILY - ${dayLine(day)}`, 'A new board is up. Build your lineup before midnight ET.', `Play today's Daily: ${links.daily}`, '');
  // 6 FREE TO PLAY - a 1x3 row of empty tiles, "Play" under each.
  if (free?.length) {
    const w = Math.floor(100 / free.length);
    const tiles = free.map((f) => `<td width="${w}%" align="center" valign="top" style="padding:0 4px;">
        ${f.img ? `<a href="${esc(f.href)}">${picture(f.img, f.alt ?? f.label, 160)}</a>` : ''}
        <div style="font-family:${FONT};font-size:14px;font-weight:700;color:${INK};padding-top:8px;">${esc(f.label)}</div>
        <div style="font-family:${FONT};font-size:11px;line-height:1.35;color:${MUTED};padding:2px 0 8px;">${esc(f.locksAt ? `Locks ${f.time}` : f.time)}</div>
        ${small(f.href, 'Play')}</td>`).join('');
    parts.push(block(`${kicker('FREE TO PLAY THIS WEEK')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tiles}</tr></table>`));
    text.push('FREE TO PLAY THIS WEEK', ...free.map((f) => `${f.label} - ${f.locksAt ? `locks ${f.time}` : f.time}: ${f.href}`), '');
  }
  // 5 GAME OF THE DAY - the big chip, its line, "Game page"; Also tonight right under it.
  if (game) {
    const href = game.href ?? links.scores;
    const why = { primetime: game.primetime ?? 'primetime', 'season opener': 'the season opener', playoff: 'a playoff game', rivalry: 'a rivalry',
      'closest line': `the closest line today${game.spread != null ? ` (${nf(game.spread)})` : ''}` }[game.why] ?? null;
    const a = game.also;
    const also = a ? `<div style="padding-top:18px;">${kicker('ALSO TONIGHT')}${a.img ? `<a href="${esc(a.href)}">${picture(a.img, a.alt, 512)}</a>` : para(`<b>${esc(a.away)} at ${esc(a.home)}</b>`)}
        ${note(esc([a.league, a.time].filter(Boolean).join(' - ')))}<div style="padding-top:10px;">${small(a.href, 'Game page')}</div></div>` : '';
    parts.push(block(`${kicker('GAME OF THE DAY')}
      ${game.img ? `<a href="${esc(href)}">${picture(game.img, game.alt, 512)}</a>` : para(`<b>${esc(game.away)} at ${esc(game.home)}</b>`)}
      ${note(esc([game.league, game.time, why].filter(Boolean).join(' - ')))}
      <div style="padding-top:10px;">${small(href, 'Game page')}</div>${also}`));
    text.push('GAME OF THE DAY', `${game.away} at ${game.home}${game.time ? ` - ${game.time}` : ''}`, `Game page: ${href}`,
      ...(a ? [`Also tonight: ${a.away} at ${a.home} - ${a.time}: ${a.href}`] : []), '');
  }
  // 4 THIS WEEK IN SPORTS
  if (week) {
    const cell = (v, bold) => `<td align="center" style="font-family:${FONT};font-size:13px;color:${INK};padding:5px 2px;${bold ? `font-weight:700;background:${LIME};` : ''}">${esc(v)}</td>`;
    const head = `<tr><td></td>${week.days.map((d) => cell(d.dow, d.today)).join('')}</tr>`;
    const shown = (r, i) => (r.cells[i] ? `${r.cells[i]}${r.starred?.[i] ? '*' : ''}` : '-');
    const rows = week.rows.map((r) => `<tr><td style="font-family:${MONO};font-size:10px;color:${INK};padding:5px 6px 5px 0;">${esc(r.league)}</td>${r.cells.map((n, i) => cell(shown(r, i), week.days[i].today)).join('')}</tr>`).join('');
    const notes = (week.notes ?? []).map((t) => note(esc(t))).join('');
    parts.push(block(`${kicker('THIS WEEK IN SPORTS')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${head}${rows}</table>${notes}`));
    text.push('THIS WEEK IN SPORTS', `      ${week.days.map((d) => (d.today ? `[${d.dow}]` : d.dow)).join(' ')}`,
      ...week.rows.map((r) => `${r.league.padEnd(5)} ${r.cells.map((n, i) => (week.days[i].today ? `[${shown(r, i)}]` : shown(r, i))).join(' ')}`), ...(week.notes ?? []), '');
  }
  // 7 YOUR MOVE - one row each, a status pill on the right.
  if (move) {
    const y = move.yesterday;
    const rows = [];
    if (y) rows.push([`Yesterday's Daily: <b>${esc(nf(y.score))}</b>`, pill(y.rank && y.of ? `${ordinal(y.rank)} of ${y.of}` : 'Played')]);
    for (const l of move.locks) rows.push([`<a href="${esc(l.href)}" style="color:${INK};text-decoration:underline;">${esc(l.label)}</a><div style="font-size:12px;color:${MUTED};">Locks ${esc(l.time)}</div>`, pill("You're in")]);
    parts.push(block(`${kicker('YOUR MOVE')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map(([l, r]) => `<tr><td style="font-family:${FONT};font-size:15px;color:${INK};padding:6px 0;">${l}</td><td align="right" valign="top" style="padding:6px 0 6px 8px;">${r}</td></tr>`).join('')}</table>`));
    text.push('YOUR MOVE', ...(y ? [`Yesterday's Daily: ${nf(y.score)}${y.rank && y.of ? `, ${ordinal(y.rank)} of ${y.of}` : ''}.`] : []),
      ...move.locks.map((l) => `${l.label} - you're in, locks ${l.time}: ${l.href}`), '');
  }
  // 8 SPOTLIGHT - a lock-screen preview drawn in HTML; "Get the app" only without an iOS device.
  if (spotlight) {
    const go = spotlight.href ? ` <a href="${esc(spotlight.href)}" style="color:${INK};font-weight:700;">Try it</a>` : '';
    const p = spotlight.preview;
    const lock = p ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK};border-radius:18px;margin-top:12px;"><tr><td style="padding:14px 16px;">
        <div style="font-family:${MONO};font-size:10px;letter-spacing:0.08em;color:${LIME};">SPORTSVYN - LIVE</div>
        <div style="font-family:${FONT};font-size:17px;font-weight:700;color:#FFFFFF;padding-top:6px;">${esc(p.line)}</div>
        <div style="font-family:${FONT};font-size:12px;color:#C9C7E6;padding-top:2px;">${esc(p.sub)}</div></td></tr></table>` : '';
    const app = spotlight.appLink && links.app ? `<div style="padding-top:12px;">${small(links.app, 'Get the app')}</div>` : '';
    parts.push(block(`${kicker(`SPOTLIGHT - ${spotlight.title.toUpperCase()}`)}${para(`${esc(spotlight.line)}${go}`, 15)}${lock}${app}`));
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

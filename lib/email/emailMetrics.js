// lib/email/emailMetrics.js - OPENS AND CLICKS WITHOUT THE SCANNERS (tue-4). PURE.
//
// Mail security scanners (corporate gateways, Apple Mail Privacy Protection,
// link-safety crawlers) fetch every link in a message the moment it lands. Those
// "clicks" are not readers. The rule, applied identically to Resend's
// email.clicked webhook rows and to our own /api/email/click ledger rows:
//
//   A click is a SCANNER click when ONE message (webhook: messageId) or ONE
//   account + campaign (our ledger: userId + campaign) has 3 or more clicks
//   inside any 15-second window, and that window STARTS within 2 minutes after
//   the message was delivered (webhook: the email.delivered time; our ledger:
//   when we handed the send to Resend).
//
// Every click in such a window is excluded from every count. A burst with no
// known delivery time is NOT flagged (we cannot say it started right after
// delivery), and a burst that starts later than 2 minutes is a person (or a
// device sync) and is kept. The three numbers are the decision; change them
// here and the tests say what moved.

export const SCANNER_MIN_CLICKS = 3;
export const SCANNER_WINDOW_MS = 15_000;
export const SCANNER_AFTER_DELIVERY_MS = 120_000;

/**
 * clicks: [{ key, t, anchor }] - key groups a message / account, t = click time
 * (ms), anchor = delivery time (ms) or null. -> Set of indices that are scanner clicks.
 */
export function flagScannerClicks(clicks, { minClicks = SCANNER_MIN_CLICKS, windowMs = SCANNER_WINDOW_MS, afterMs = SCANNER_AFTER_DELIVERY_MS } = {}) {
  const flagged = new Set();
  const groups = new Map();
  clicks.forEach((c, i) => { if (!groups.has(c.key)) groups.set(c.key, []); groups.get(c.key).push({ i, t: Number(c.t), anchor: c.anchor == null ? null : Number(c.anchor) }); });
  for (const list of groups.values()) {
    list.sort((a, b) => a.t - b.t);
    const anchor = list.map((c) => c.anchor).find((a) => a != null && Number.isFinite(a)) ?? null;
    if (anchor == null) continue;
    for (let s = 0; s < list.length; s += 1) {
      const start = list[s].t;
      if (!(start >= anchor && start - anchor <= afterMs)) continue;
      let e = s;
      while (e + 1 < list.length && list[e + 1].t - start <= windowMs) e += 1;
      if (e - s + 1 >= minClicks) for (let k = s; k <= e; k += 1) flagged.add(list[k].i);
    }
  }
  return flagged;
}

const ms = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : null; };
const dayOfCampaign = (c) => /(\d{4}-\d{2}-\d{2})$/.exec(String(c ?? ''))?.[1] ?? null;

/**
 * THE DAILY TABLE. All inputs are plain rows:
 *   sends         [{ day, userId, messageId, sentAt }]        our ledger, outcome 'sent'
 *   events        [{ kind: 'delivered'|'opened'|'clicked', messageId, at }]   Resend webhook
 *   ledgerClicks  [{ userId, campaign, at }]                  our /api/email/click rows
 *   played        { [day]: number }                           recipients who played that day
 * -> [{ day, sent, delivered, opened, clicks, clickers, scannerClicks, ourClicks, ourScannerClicks, played }]
 * newest day first. Scanner clicks are in none of the click counts.
 */
export function buildDaily({ sends = [], events = [], ledgerClicks = [], played = {} } = {}) {
  const byMsg = new Map(sends.filter((s) => s.messageId).map((s) => [s.messageId, s]));
  const deliveredAt = new Map();
  for (const e of events) if (e.kind === 'delivered' && !deliveredAt.has(e.messageId)) deliveredAt.set(e.messageId, ms(e.at));

  const clickEvents = events.filter((e) => e.kind === 'clicked' && byMsg.has(e.messageId));
  const wFlag = flagScannerClicks(clickEvents.map((e) => ({
    key: e.messageId, t: ms(e.at), anchor: deliveredAt.get(e.messageId) ?? ms(byMsg.get(e.messageId).sentAt),
  })));

  const sentAtFor = new Map(sends.map((s) => [`${s.userId}|${s.day}`, ms(s.sentAt)]));
  const ours = ledgerClicks.filter((c) => dayOfCampaign(c.campaign) && sentAtFor.has(`${c.userId}|${dayOfCampaign(c.campaign)}`));
  const oFlag = flagScannerClicks(ours.map((c) => ({
    key: `${c.userId}|${c.campaign}`, t: ms(c.at), anchor: sentAtFor.get(`${c.userId}|${dayOfCampaign(c.campaign)}`),
  })));

  const days = new Map();
  const row = (day) => { if (!days.has(day)) days.set(day, { day, sent: 0, delivered: new Set(), opened: new Set(), clicks: 0, clickers: new Set(), scannerClicks: 0, ourClicks: 0, ourScannerClicks: 0, played: played[day] ?? 0 }); return days.get(day); };
  for (const s of sends) row(s.day).sent += 1;
  for (const e of events) {
    const s = byMsg.get(e.messageId);
    if (!s) continue;
    if (e.kind === 'delivered') row(s.day).delivered.add(e.messageId);
    if (e.kind === 'opened') row(s.day).opened.add(e.messageId);
  }
  clickEvents.forEach((e, i) => {
    const r = row(byMsg.get(e.messageId).day);
    if (wFlag.has(i)) r.scannerClicks += 1; else { r.clicks += 1; r.clickers.add(e.messageId); }
  });
  ours.forEach((c, i) => { const r = row(dayOfCampaign(c.campaign)); if (oFlag.has(i)) r.ourScannerClicks += 1; else r.ourClicks += 1; });
  return [...days.values()]
    .map((r) => ({ ...r, delivered: r.delivered.size, opened: r.opened.size, clickers: r.clickers.size }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

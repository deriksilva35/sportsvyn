// lib/wire/rss.js — club feeds.
//
// THE TEAM IS THE FEED, NOT THE ITEM. No club item carries a machine-readable
// team - media:keywords is editorial categories like "News: Roster Stories" -
// so team_ids comes from the news_feeds row we polled. That cannot be wrong,
// where parsing could be.
//
// THE NATIONALS ARE NOT HERE AND WERE NOT ATTEMPTED. ESPN answers its RSS
// endpoints with 202 and a zero-byte body; NFL.com's feed paths return HTML
// error pages. Both are bot walls, and neither is worth a scraper.
//
// A CLUB FEED IS THE CLUB'S OWN PR, and the wire should not pretend otherwise.
// "Final: Bengals 30, Eagles 13" is a fact; "5 things to know about new Packers
// RB Kaleb Johnson" is marketing. Everything is STORED and the render allowlist
// decides what a reader sees - that ruling is held for Derik, and until it
// lands nothing downstream should treat this lane as editorial.

import { wireKey } from './hash.js';

const TAG = (s, t) => {
  const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(s);
  if (!m) return null;
  return decode(m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()) || null;
};
const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

/** PURE: an RSS body -> items. No network, so the parser is testable. */
export function parseFeed(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = TAG(it, 'title');
    if (!title) continue;
    out.push({
      title,
      link: TAG(it, 'link'),
      guid: TAG(it, 'guid'),
      pubDate: TAG(it, 'pubDate'),
      keywords: TAG(it, 'media:keywords'),
    });
  }
  return out;
}

export function toRows(items, feed) {
  const out = [];
  for (const it of items ?? []) {
    // GUID FIRST, LINK SECOND. A club guid is a stable uuid; the link is stable
    // too but can gain tracking params. A feed with neither is not ingestable
    // and is dropped rather than keyed on the headline, which editors reword.
    const id = it.guid ?? it.link;
    if (!id) continue;
    const when = it.pubDate ? new Date(it.pubDate) : null;
    out.push({
      league_id: feed.league_id,
      team_ids: [feed.team_id].filter(Boolean),
      lane: 'club',
      headline: it.title,
      url: it.link ?? null,
      source: feed.name,
      published_at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
      dedupe_hash: wireKey('club', feed.id, id),
      // KEYWORDS ARE STORED, NOT ACTED ON. The render allowlist is a ruling
      // that has not been made; storing them means it can be made later
      // without a re-ingest.
      payload: { keywords: it.keywords ?? null, feedId: feed.id },
    });
  }
  return out;
}

export function rssFetcher() {
  return async (url) => {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Sportsvynbot/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${res.status} on ${url}`);
    const body = await res.text();
    if (!body.includes('<item')) throw new Error(`no <item> in ${url} (${body.length}b)`);
    return body;
  };
}

/**
 * POLL THE CLUBS WITH BOUNDED CONCURRENCY.
 *
 * THIRTY-TWO SEQUENTIAL FETCHES DO NOT FIT IN A TICK. The first dry run proved
 * it by running out of time part-way through the second pass - and the cron's
 * maxDuration is 60 seconds, so it would have timed out in production and been
 * reported as a failing job rather than a slow one.
 *
 * EIGHT AT A TIME, and each feed's failure is its own. One club site being slow
 * or down must cost that club's headlines and nothing else, which is the same
 * rule the cron applies between lanes.
 */
export async function pollFeeds(feeds, { fetchOne, concurrency = 8, onFeed } = {}) {
  const f = fetchOne ?? rssFetcher();
  const queue = [...(feeds ?? [])];
  const rows = [];
  const down = [];
  const worker = async () => {
    for (;;) {
      const feed = queue.shift();
      if (!feed) return;
      try {
        const got = toRows(parseFeed(await f(feed.url)), feed);
        rows.push(...got);
        await onFeed?.(feed, null, got.length);
      } catch (e) {
        down.push(feed.name ?? feed.url);
        await onFeed?.(feed, e, 0);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return { rows, down };
}

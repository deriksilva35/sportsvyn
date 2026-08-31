// lib/wire/injuries.js — the injury wire. NFL ONLY.
//
// BDL /nfl/v1/player_injuries is the only injury source we hold. There is no
// NCAAF equivalent (404) and CFBD has none either (404), so college has no
// injury lane and will not until a source exists. Saying that here rather than
// leaving a gap somebody later reads as a bug.
//
// THE DATE AND THE COMMENT ARE BOTH NULLABLE, and a real row proves it:
// Giovanni Manu arrives with date null and comment "Knee". The headline is
// built from what is present and the rest is simply absent.

import { wireKey } from './hash.js';

const BASE = 'https://api.balldontlie.io';

/** "Brian Branch, S, DET · PUP-P". PURE. Hyphen grammar, no em dash. */
export function injuryHeadline(x) {
  const p = x?.player ?? {};
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  if (!name) return null;
  const status = String(x.status ?? '').trim();
  if (!status) return null;
  const pos = p.position_abbreviation ?? shortPos(p.position);
  const team = p.team?.abbreviation ?? null;
  const who = [name, pos, team].filter(Boolean).join(', ');
  return `${who} · ${status}`;
}

// The feed sends "Running Back", not "RB", on the position field; the
// abbreviation field is the one to prefer and this is only the fallback.
const shortPos = (s) => (s ? String(s).split(/\s+/).map((w) => w[0]).join('').toUpperCase() : null);

export function toRows(items, { leagueId = null, teamByAbbr = new Map() } = {}) {
  const out = [];
  for (const x of items ?? []) {
    const headline = injuryHeadline(x);
    if (!headline) continue;
    const abbr = x.player?.team?.abbreviation ?? null;
    out.push({
      league_id: leagueId,
      team_ids: [teamByAbbr.get(abbr)].filter(Boolean),
      lane: 'injury',
      headline,
      url: null,
      // THE SOURCE STRING IS USER-FACING - it lands in news_items.source and a
      // surface will print it. The stats vendor is not named to readers (see
      // lib/legal.test.mjs); the honest neutral label is what this is: a
      // league injury report, relayed.
      source: 'Injury report',
      published_at: x.date ?? null,
      // THE KEY IS THE STATE, NOT THE SIGHTING. A player's status is re-sent
      // every poll; it is only news when the status or the note changes. The
      // comment is in the key because a status can stay "Questionable" while
      // the report behind it changes, and that IS a new thing to say.
      dedupe_hash: wireKey('injury', x.player?.id, x.status, x.date ?? x.comment ?? 'none'),
      payload: {
        playerId: x.player?.id ?? null,
        status: x.status ?? null,
        comment: x.comment ?? null,
        team: abbr,
      },
    });
  }
  return out;
}

export function bdlInjuryFetcher({ base = BASE } = {}) {
  return async ({ cursor = null, perPage = 100 } = {}) => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const u = new URL(`${base}/nfl/v1/player_injuries`);
    u.searchParams.set('per_page', String(perPage));
    if (cursor) u.searchParams.set('cursor', String(cursor));
    const res = await fetch(u, { headers: { Authorization: key } });
    if (!res.ok) throw new Error(`BDL ${res.status} on /nfl/v1/player_injuries`);
    return res.json();
  };
}

/**
 * CURSOR PAGINATION, BOUNDED. maxPages exists because an injury list is not
 * something a 15-minute cron should walk to the end of every tick; the feed is
 * ordered and the recent end is the news.
 */
export async function fetchInjuries({ fetchPage, maxPages = 2, perPage = 100 } = {}) {
  const f = fetchPage ?? bdlInjuryFetcher();
  const all = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i += 1) {
    const j = await f({ cursor, perPage });
    all.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

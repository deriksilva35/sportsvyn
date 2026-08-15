// lib/gridiron/nflverse.js - nflverse roster + player files, fetched and cached.
//
// SOURCE: github.com/nflverse/nflverse-data, released as GitHub assets rather
// than repo files. CC-BY-4.0, which permits commercial use with attribution;
// the attribution itself is a product-surface item and is tracked elsewhere.
//
// TWO FILES, TWO JOBS, and neither substitutes for the other:
//
//   players.csv      ONE row per player, all-time. `position` is 100% populated
//                    INCLUDING for retired players - 17,833 of 17,833 whose
//                    careers ended before 2018 carry one, where BDL gives ~9%.
//                    This is the position source.
//   roster_YYYY.csv  One row per (player, TEAM STINT) for that season. 113 of
//                    2,065 players in 2015 have more than one. Used only to
//                    disambiguate a name collision against the team the stat
//                    rows say a player actually played for, then discarded.
//
// CACHED TO DISK because these are static history: the 2015 roster will not
// change again. A re-run costs no bandwidth and works offline.

import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const CACHE = process.env.NFLVERSE_CACHE_DIR
  ?? path.join(process.env.HOME ?? '/tmp', '.cache', 'nflverse');

async function cached(name, url, { log = () => {} } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
  log(`fetching ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`nflverse ${res.status} for ${name}`);
  const text = await res.text();
  fs.writeFileSync(file, text);
  return text;
}

/**
 * RFC-4180-ish CSV. nflverse quotes fields containing commas (player names with
 * suffixes, college names) and doubles embedded quotes; nothing else exotic.
 */
export function parseCsv(txt) {
  const rows = []; let f = ''; let row = []; let q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); f = ''; rows.push(row); row = []; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}

export async function loadPlayers(opts) {
  return parseCsv(await cached('players.csv', `${BASE}/players/players.csv`, opts));
}

export async function loadRoster(season, opts) {
  return parseCsv(await cached(`roster_${season}.csv`, `${BASE}/rosters/roster_${season}.csv`, opts));
}

// ---------------------------------------------------------------------------
// Team vocabulary
// ---------------------------------------------------------------------------
// nflverse team codes are ERA-DEPENDENT and do not match ours. 2015 uses the
// old gamebook spellings (BLT, HST, CLV, ARZ) plus three franchises that have
// since moved (SL -> LAR, SD -> LAC, OAK -> LV); 2022 uses LA for the Rams.
// BDL, by contrast, normalises everything to the MODERN identity, so a 2015
// game comes back as "Los Angeles Rams". Mapping runs nflverse -> ours.
export const NFLVERSE_TEAM = {
  BLT: 'BAL', HST: 'HOU', CLV: 'CLE', ARZ: 'ARI', WAS: 'WSH',
  SL: 'LAR', STL: 'LAR', LA: 'LAR', SD: 'LAC', OAK: 'LV',
};
export const ourTeam = (code) => NFLVERSE_TEAM[code] ?? code;

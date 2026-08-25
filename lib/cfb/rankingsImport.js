// lib/cfb/rankingsImport.js - fetch a week's polls from CFBD and store them.
//
// Both polls come from ONE request. CFBD's /rankings response carries every
// poll for a week in a single envelope, so importing AP and the Coaches Poll
// costs exactly one call, not two - which is why the weekly cron is free
// against the 30K/month budget it shares with fixtures and the plays poller.

import { sql } from '../db.js';
import {
  AP_POLL, COACHES_POLL, pollFromWeek, normalizeRanks, cfbTeamMap, writeRanks,
} from './rankings.js';

const CFBD_BASE = 'https://apinext.collegefootballdata.com';

async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${CFBD_BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Import one week. `week` omitted means "whatever weeks CFBD currently serves"
 * - the endpoint returns only the weeks that exist, so asking without a week is
 * itself the cheapest "what is the newest poll" probe.
 */
export async function importRankingsWeek({ season, week = null, seasonType = 'regular' } = {}) {
  const q = `/rankings?year=${season}&seasonType=${seasonType}${week != null ? `&week=${week}` : ''}`;
  const envelopes = await cfbdGet(q);
  if (!Array.isArray(envelopes) || !envelopes.length) {
    return { season, seasonType, weeks: 0, polls: {}, reason: 'no-weeks-published' };
  }
  const teamMap = await cfbTeamMap();
  const summary = { season, seasonType, weeks: envelopes.length, polls: {}, unresolved: {} };

  for (const env of envelopes) {
    for (const pollName of [AP_POLL, COACHES_POLL]) {
      // A week that genuinely lacks a poll is recorded and skipped, not fatal:
      // the FCS-only weeks early in a season carry Coaches but not AP.
      let poll;
      try { poll = pollFromWeek(env, pollName); }
      catch (e) {
        summary.polls[`${pollName} wk${env.week}`] = `absent: ${String(e.message).slice(0, 80)}`;
        continue;
      }
      const { rows, unresolved } = normalizeRanks(poll, teamMap);
      const written = await writeRanks(pollName, { season: env.season, week: env.week, seasonType: env.seasonType ?? seasonType }, rows);
      summary.polls[`${pollName} wk${env.week}`] = written;
      if (unresolved.length) summary.unresolved[`${pollName} wk${env.week}`] = unresolved;
    }
  }
  return summary;
}

/** Every week CFBD has for a season - the backfill path. */
export async function backfillSeason(season, seasonType = 'regular') {
  return importRankingsWeek({ season, week: null, seasonType });
}

/** What the page reads: the season we are in, per the matches table. */
export async function currentCfbSeason(now = new Date()) {
  const [r] = await sql`
    SELECT max(m.season_year) AS season
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'cfb' AND m.kickoff_at <= ${new Date(now).toISOString()}::timestamptz + interval '60 days'`;
  return r?.season ?? new Date(now).getUTCFullYear();
}

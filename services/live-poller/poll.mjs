// services/live-poller/poll.mjs — one poll of one league. The only file here
// that talks to a provider, and it is deliberately thin: every decision it
// makes was made in a pure module under lib/live/ and can be tested without a
// network, a clock or a database.

import { mapLiveStatus, liveState } from '../../lib/live/vocabulary.js';
import { writeLive, scoreChanged } from '../../lib/live/write.js';
import { toScoreRow } from '../../lib/live/scoreEvent.js';
import { emit } from '../../lib/wire/emit.js';
import { transitionsFor } from '../../lib/push/transitions.js';
import { dispatch } from '../../lib/push/dispatch.js';

const CFBD = 'https://apinext.collegefootballdata.com';
const BDL = 'https://api.balldontlie.io';

// ---------------------------------------------------------------------------
// Fetchers. ONE CALL PER POLL PER LEAGUE, which is the number the whole quota
// argument rests on.
// ---------------------------------------------------------------------------

export function cfbdScoreboard({ classification = null } = {}) {
  return async () => {
    const key = process.env.CFBD_API_KEY;
    if (!key) throw new Error('CFBD_API_KEY missing in env');
    const q = classification ? `?classification=${classification}` : '';
    const res = await fetch(`${CFBD}/scoreboard${q}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${res.status} on /scoreboard${q}`);
    return { rows: await res.json(), calls: 1 };
  };
}

// DATES[], NOT SEASONS[]. The season query pages the whole schedule at 100 a
// page - three calls to learn about twelve games - and every page after the
// first is spent on games that finished in September. One day is one call and
// no cursor. Measured 1 Sep 2026: 12 rows, next_cursor undefined.
export function bdlDay(dateIso) {
  return async () => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${BDL}/nfl/v1/games?dates[]=${dateIso}&per_page=100`,
      { headers: { Authorization: key } });
    if (!res.ok) throw new Error(`BDL ${res.status} on /nfl/v1/games`);
    const j = await res.json();
    return { rows: j?.data ?? [], calls: 1 };
  };
}

// ---------------------------------------------------------------------------
// Normalisers. Provider row -> the four things we own. PURE-ish: no db.
// ---------------------------------------------------------------------------

export function fromCfbd(row, unmapped) {
  const status = mapLiveStatus('cfbd', row?.status, unmapped);
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: Number.isFinite(Number(row?.homeTeam?.points)) ? Number(row.homeTeam.points) : null,
    awayScore: Number.isFinite(Number(row?.awayTeam?.points)) ? Number(row.awayTeam.points) : null,
    liveState: liveState(row?.period, row?.clock),
  };
}

export function fromBdl(row, unmapped) {
  // status_state IS THE MACHINE FIELD. `status` on this feed is prose - the
  // kickoff rendered as "9/13 - 1:00 PM EDT" before the game, one distinct
  // value per row - so it cannot be a table key and is not read here.
  const status = mapLiveStatus('bdl', row?.status_state, unmapped);
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: Number.isFinite(Number(row?.home_team_score)) ? Number(row.home_team_score) : null,
    awayScore: Number.isFinite(Number(row?.visitor_team_score)) ? Number(row.visitor_team_score) : null,
    // BDL SENDS NO PERIOD OR CLOCK on this endpoint - measured on the real
    // payload, 1 Sep 2026. So an NFL score event carries the scoreline without
    // the chip, which the headline builder already handles by dropping the
    // qualifier whole rather than rendering half of it.
    liveState: null,
  };
}

/**
 * WHAT A GIVEN STATUS ENTITLES US TO WRITE.
 *
 * CFBD SENDS points: 0 FOR A GAME THAT HAS NOT KICKED OFF - not null, zero.
 * Caught by the dry run against the real payload: every scheduled row came back
 * "0-0", and because COALESCE treats 0 as a value the poller would have written
 * it, put 0-0 on the scoreboard for unplayed games, and emitted a Wire event
 * reading "ECU 0, ALA 0" for a game three days away - deduped on those numbers
 * and therefore uncorrectable.
 *
 * So a scheduled row contributes its STATUS and nothing else. The scores go to
 * null, which COALESCE preserves, so an existing value is untouched and an
 * absent one stays absent. This is the same gate syncCfbLiveScores calls "the
 * one gate that matters", stated once here rather than per provider.
 */
export function scopeToStatus(upd) {
  if (upd.status === 'live' || upd.status === 'final') return upd;
  return { ...upd, homeScore: null, awayScore: null, liveState: null };
}

// ---------------------------------------------------------------------------
// One poll.
// ---------------------------------------------------------------------------

/**
 * SCOPED BY OUR OWN TABLE, NOT BY THE PAYLOAD. We enumerate the rows WE hold as
 * live-or-imminent and look each up in the provider's, rather than walking 99
 * scoreboard entries and writing whatever they claim. The blast radius is
 * exactly "games this league already has in flight" and cannot grow if the
 * provider starts returning more.
 */
export async function pollOnce(sql, {
  league, providerKey, fetcher, normalise, now = new Date(), dryRun = false, push = true,
}) {
  const out = {
    league, considered: 0, matched: 0, unmatched: 0, written: 0,
    scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [],
    latencies: [], wouldWrite: [], pushes: [], pushErrors: [], pushAuthFailure: false,
  };

  const candidates = await sql`
    SELECT m.id, m.slug, m.status, m.home_score, m.away_score,
           m.league_id, m.home_team_id, m.away_team_id, m.kickoff_at,
           m.external_ids->>${providerKey} AS pid,
           l.slug AS league_slug,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           (m.metadata->'detail'->>'final_seen_at') AS final_seen_at
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = ${league}
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status IN ('live', 'scheduled')
       AND m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz + interval '30 minutes'`;
  out.considered = candidates.length;
  if (!candidates.length) return out;

  const fetchedAt = Date.now();
  const { rows, calls } = await fetcher();
  out.calls = calls ?? 1;
  const byId = new Map((rows ?? []).map((r) => [String(r?.id), r]));

  const events = [];
  for (const m of candidates) {
    const row = m.pid == null ? null : byId.get(String(m.pid));
    if (!row) { out.unmatched += 1; continue; }
    out.matched += 1;
    const raw = normalise(row, out.unmapped);
    // AN UNREADABLE STATUS WRITES NOTHING AT ALL. Not the score either: a
    // status we cannot map is not evidence that anything else on the row is
    // safe to believe.
    if (raw.status == null) continue;
    const upd = scopeToStatus(raw);

    if (dryRun) {
      out.wouldWrite.push({
        slug: m.slug, from: m.status, to: upd.status,
        score: `${m.away_score ?? '-'}-${m.home_score ?? '-'} -> ${upd.awayScore ?? '-'}-${upd.homeScore ?? '-'}`,
        liveState: upd.liveState,
      });
      continue;
    }

    const after = await writeLive(sql, m.id, upd);
    if (!after) continue;
    out.written += 1;
    if (after.status === 'final' && m.status !== 'final') out.finals += 1;

    // THE PUSH RIDER. It is handed the transition this poll just made and asks
    // no provider anything - the loop that noticed is the loop that sends,
    // which is the whole reason an alert can be a minute old instead of five.
    //
    // ITS FAILURE IS CONTAINED. A notification is a courtesy on top of a
    // scoreboard; losing one must never cost the write that the board, the
    // Wire and the settle all depend on.
    if (!dryRun && push) {
      const evs = transitionsFor(
        { ...m, live_state: null },
        { ...after, live_state: upd.liveState },
      );
      for (const t of evs) {
        try {
          // pushPayload() (lib/push/payload.js) destructures camelCase
          // homeAbbr/awayAbbr/leagueSlug - the query above selects them
          // snake_case (home_abbr/away_abbr/league_slug, the naming every
          // other column in this file uses). Without this mapping every
          // real dispatch() call hit pushPayload()'s `if (!homeAbbr ||
          // !awayAbbr || !leagueSlug...) return null` guard and bailed
          // before ever reaching the per-device send loop - silently, with
          // no log line, no error, and no push_sends row - independent of
          // and on top of the audienceFor() bug fixed alongside this one.
          const match = {
            ...m, ...after,
            homeAbbr: m.home_abbr, awayAbbr: m.away_abbr, leagueSlug: m.league_slug,
          };
          const r = await dispatch(sql, { match, event: t.event, state: t.state });
          out.pushes.push({ event: t.event, sent: r.sent, skipped: r.skipped, failed: r.failed });
          if (r.authFailure) out.pushAuthFailure = true;
        } catch (e) { out.pushErrors.push(String(e?.message ?? e).slice(0, 120)); }
      }
    }

    // AN EVENT ONLY FOR A GAME BEING PLAYED. A final has its own emitter, and a
    // scheduled game has no score to report.
    if (upd.status === 'live' && scoreChanged(m, after)) {
      out.scoreChanges += 1;
      // THE LATENCY INSTRUMENT. Neither provider sends an observation
      // timestamp - measured, both payloads - so what is recorded is the gap we
      // can actually see: the moment the fetch returned to the moment the write
      // landed. Thursday's report can then state a real number for OUR half and
      // say plainly that the provider's half is unmeasurable from here, rather
      // than quoting the poll interval and calling it latency.
      out.latencies.push({ matchId: m.id, ourMs: Date.now() - fetchedAt });
      const ev = toScoreRow({ ...m, ...{
        home_score: after.home_score, away_score: after.away_score,
        seen_at: new Date().toISOString(),
      } }, upd.liveState);
      if (ev) events.push(ev);
    }
  }

  if (events.length) {
    // ONE EVENT PER SCORE STATE, EVER - the dedupe_hash is the match and the
    // two scores, so a poll that sees the same scoreline again writes nothing.
    const ins = await emit(events);
    out.events = Array.isArray(ins) ? ins.length : (ins?.length ?? 0);
  }
  out.unmapped = [...new Set(out.unmapped)];
  return out;
}

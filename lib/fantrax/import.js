// lib/fantrax/import.js — one Fantrax league becomes a draft_configs row, a
// pool snapshot and a set of keepers.
//
// EVERY TRANSLATION IS IN vocabulary.js. This file does the reading, joining
// and writing; it never decides what a K is called.
//
// THE KEEPERS ARE THE POINT. A Fantrax league arrives with its first 41 picks
// already made, and a draft that ignores them is not this league's draft. They
// are written to draft_config_keepers - the league's statement - and seeded
// into a draft's picks only when a draft is started.

import * as api from './api.js';
import { toPoolPosition, displayName, toRosterSlots, toScoringFormat, draftablePositions } from './vocabulary.js';
import { normalizeName, matchPoolIdentities } from '../gridiron/nameMatch.js';
import { providerSeatConflicts } from './keeperSeed.js';

const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * THE CROSSWALK. fantraxId -> { name, position }.
 *
 * THE '#' SPLIT IS NOT COSMETIC. getPlayerIds keys team defenses compound
 * ("20295#1100") while getAdp carries the bare id ("20290"). Measured on the
 * probe: joining on the exact key reaches 820 of 852 ADP rows; adding the
 * prefix reaches 852. The 32 it recovers are exactly the team defenses, which
 * is every DST in the league.
 */
export function buildCrosswalk(playerIds) {
  const byId = new Map();
  for (const [key, v] of Object.entries(playerIds ?? {})) {
    const entry = {
      name: v.name ?? null,
      position: v.position ?? null,
      teamShortName: v.teamShortName ?? v.team ?? null,
      compound: key.includes('#'),
    };
    byId.set(key, entry);
    const bare = key.split('#')[0];
    // The compound key wins its own slot; the bare form is only a fallback, so
    // a real player id can never be shadowed by a defense's prefix.
    if (!byId.has(bare)) byId.set(bare, entry);
  }
  return byId;
}

/**
 * getAdp x crosswalk -> pool rows.
 *
 * A ROW WITHOUT A NAME IS NOT WRITTEN. sim_player_pool.name is NOT NULL, and a
 * nameless player in a draft board is worse than an absent one - the reader
 * cannot tell what they are being offered.
 */
export function toPoolRows(adp, crosswalk, { snapshotDate, scoringFormat, teamsCount, slots = null, exclude = null }) {
  const rows = []; const skipped = [];
  // THE LEAGUE'S HOLDINGS ARE NOT ON THE BOARD. `exclude` is fantraxId ->
  // playerInfo status for every player the league already has (T = on a team,
  // WW = on waivers); the check runs AFTER the position gate so the arithmetic
  // the importer prints - draftable-joined minus excluded = written - is about
  // players this league could otherwise have drafted, not linebackers.
  let draftable = 0; let excluded = 0;
  // THE LEAGUE'S POOL, NOT THE PROVIDER'S UNIVERSE. Fantrax serves an
  // IDP-capable ADP list; a league with no IDP slot cannot roster a linebacker,
  // and writing them anyway kills the draft when the AI runs out of legal
  // options. Derived from the slots, so a league that adds an IDP slot gets
  // them back without anyone editing a list.
  const allowed = slots ? draftablePositions(slots) : null;
  for (const a of adp ?? []) {
    const id = a?.id == null ? null : String(a.id);
    if (!id) { skipped.push({ reason: 'no id', row: a }); continue; }
    const x = crosswalk.get(id) ?? null;
    const isTeamRow = Boolean(a.tmId) || x?.compound === true;
    const name = x?.name ? displayName(x.name) : (isTeamRow && a.name ? `${a.name} Defense` : null);
    if (!name) { skipped.push({ reason: 'no name', id }); continue; }
    const adpVal = Number(a.ADP_PPR ?? a.ADP);
    if (!Number.isFinite(adpVal)) { skipped.push({ reason: 'no adp', id }); continue; }
    const position = toPoolPosition(a.pos ?? x?.position, { isTeamRow });
    if (allowed && !allowed.has(position)) { skipped.push({ reason: `undraftable position ${position}`, id }); continue; }
    draftable += 1;
    const status = exclude?.get(id) ?? null;
    if (status) { excluded += 1; skipped.push({ reason: `rostered (${status})`, id, name }); continue; }
    rows.push({
      snapshot_date: snapshotDate, scoring_format: scoringFormat, teams_count: teamsCount,
      ffc_player_id: id,
      name,
      position,
      team: isTeamRow ? (a.name ?? null) : (x?.teamShortName ?? null),
      adp: adpVal,
      source: 'fantrax',
      league: 'nfl',
    });
  }
  return { rows, skipped, draftable, excluded };
}

/**
 * THE COLLEGE BOARD'S PLACEMENT, and the one number in this file that is ours
 * rather than the provider's.
 *
 * DERIVED PLACEMENT, NOT A PROVIDER FACT. Fantrax renders an overall rank
 * ("Rk 4830") in its draft room but serves no rank field on any endpoint -
 * getAdp/getPlayerIds carry six keys and none is a rank, and includeRank is
 * ignored byte-for-byte. So we place college rows ourselves: after every NFL
 * player, ordered among themselves by NCAAF ADP. The base clears 999, which is
 * Fantrax's unranked sentinel and not a board position.
 */
export const COLLEGE_PLACEMENT_BASE = 10000;

/**
 * getAdp('NCAAF') x the NCAAF crosswalk -> pool rows on the SAME board.
 *
 * ONE BOARD, TWO LEAGUES. These rows go into the same snapshot as the NFL rows,
 * under the same source, and are told apart by `league`. That is the ruling:
 * the reader filters to NCAA to see them and sorts by NCAAF ADP inside that
 * filter, and the bots never reach them because they sit below every NFL
 * player - not because anything converts one board's prices into the other's.
 *
 * THE TRUE PRICE AND THE BOARD POSITION ARE DIFFERENT COLUMNS, deliberately.
 * `adp` gets the derived placement, because `adp` is what the engine orders,
 * pars and (in an adp-temperature room) takes T from. `ncaaf_adp` gets the
 * provider's number, for display and for the sort inside the NCAA filter.
 * Caleb Hawkins prices at 3.78 on the college board; in `adp` that would make
 * him the fourth pick of the draft. Two columns means no code path can confuse
 * them, because the wrong one is not there to be read.
 *
 * THE POSITION GATE IS THE LEAGUE'S, exactly as it is for NFL rows: the college
 * feed carries P, LB, S and TK that no roster here can hold. Measured on the
 * live feed: 997 rows in, 927 draftable for config 225's slots.
 */
export function toCollegePoolRows(adp, crosswalk, { snapshotDate, scoringFormat, teamsCount, slots = null }) {
  const allowed = slots ? draftablePositions(slots) : null;
  const skipped = [];
  const candidates = [];
  for (const a of adp ?? []) {
    const id = a?.id == null ? null : String(a.id);
    if (!id) { skipped.push({ reason: 'no id', row: a }); continue; }
    const x = crosswalk.get(id) ?? null;
    // A college team row is a school defense: the ADP row names the school and
    // the crosswalk key is compound, the same shape an NFL team defense has.
    const isTeamRow = Boolean(a.tmId) || x?.compound === true;
    // A SCHOOL DEFENCE IS NAMED FROM THE SCHOOL, NOT FROM THE PROVIDER'S STRING.
    // The NCAAF id table calls these rows "Team", "Defense/Special Teams" and
    // "Team Offense" - the same generic vocabulary the NFL feed uses, which for
    // NFL is disambiguated downstream by a club name the crosswalk carries.
    // College team rows carry no such name: the only identity on the row is the
    // school code in the ADP payload. Taking the provider's string would put 138
    // rows called "Team" on one board, so the school wins for team rows here.
    const name = isTeamRow
      ? (a.name ? `${a.name} Defense` : null)
      : (x?.name ? displayName(x.name) : null);
    if (!name) { skipped.push({ reason: 'no name', id }); continue; }
    const ncaafAdp = Number(a.ADP_PPR ?? a.ADP);
    if (!Number.isFinite(ncaafAdp)) { skipped.push({ reason: 'no adp', id }); continue; }
    const position = toPoolPosition(a.pos ?? x?.position, { isTeamRow });
    if (allowed && !allowed.has(position)) { skipped.push({ reason: `undraftable position ${position}`, id }); continue; }
    candidates.push({ id, name, position, ncaafAdp, team: isTeamRow ? (a.name ?? null) : (x?.teamShortName ?? null) });
  }
  // THE ORDER IS THE PLACEMENT. Sorted once, here, so the index IS the rank -
  // there is nowhere else for the two to disagree.
  candidates.sort((p, q) => p.ncaafAdp - q.ncaafAdp);
  const rows = candidates.map((c, i) => ({
    snapshot_date: snapshotDate, scoring_format: scoringFormat, teams_count: teamsCount,
    ffc_player_id: c.id,
    name: c.name,
    position: c.position,
    team: c.team,
    adp: COLLEGE_PLACEMENT_BASE + i,
    ncaaf_adp: c.ncaafAdp,
    source: 'fantrax',
    league: 'ncaaf',
  }));
  return { rows, skipped };
}

/**
 * playerInfo -> fantraxId -> status, for the statuses that mean "held".
 * Measured on the probe: 8138 entries, FA 8060 / T 76 / WW 2, and the 78 are
 * the 76 rostered players plus two nameless waiver claims.
 */
export function heldByLeague(playerInfo) {
  const out = new Map();
  for (const [id, v] of Object.entries(playerInfo ?? {})) {
    const st = String(v?.status ?? '').toUpperCase();
    if (st === 'T' || st === 'WW') out.set(String(id), st);
  }
  return out;
}

/**
 * teams jsonb, in draftOrder. slot is 1-based, the seat the engine thinks in.
 *
 * THE READER'S SEAT IS RECORDED HERE, at import, as `isMine` on the one entry
 * whose fantraxTeamId is the teamId getLeagues reports for this league. The
 * start flow needs that seat and has no business calling Fantrax to find it
 * again; the match is made once, where both halves are already in hand.
 */
export function toTeams(draftResults, leagueInfo, myTeamId = null) {
  const info = leagueInfo?.teamInfo ?? {};
  const byId = new Map(Object.values(info).map((t) => [t.id, t.name]));
  return (draftResults?.draftOrder ?? []).map((teamId, i) => ({
    slot: i + 1, name: byId.get(teamId) ?? teamId, fantraxTeamId: teamId,
    ...(myTeamId != null && teamId === myTeamId ? { isMine: true } : {}),
  }));
}

/**
 * The made picks become keepers.
 *
 * HARD-FAIL ON AN UNRESOLVED ID. The probe measured 41 of 41 draft-result
 * playerIds present in getPlayerIds. A miss therefore means the world changed -
 * a traded player purged, an id space shifted - and importing a keeper with a
 * blank name would put an unreadable row on a draft board that nobody could
 * explain later.
 */
export function toKeepers(draftResults, crosswalk, teams, adp = null) {
  const slotByTeam = new Map(teams.map((t) => [t.fantraxTeamId, t.slot]));
  // THE PRICE COMES FROM THE SAME FEED ROW THE POOL DECLINED TO WRITE. A keeper
  // is excluded from the pool (he is held), so his ADP has to be frozen here or
  // it is gone; null when the feed has no row, never 0.
  const adpById = new Map((adp ?? []).map((a) => [String(a?.id ?? ''), a]));
  const rows = []; const unresolved = [];
  for (const p of draftResults?.draftPicks ?? []) {
    if (!p?.playerId) continue;
    const id = String(p.playerId);
    const x = crosswalk.get(id);
    if (!x?.name) { unresolved.push(p.playerId); continue; }
    const slot = slotByTeam.get(p.teamId);
    if (!slot) { unresolved.push(`${p.playerId} (no seat for ${p.teamId})`); continue; }
    const a = adpById.get(id);
    const price = a ? Number(a.ADP_PPR ?? a.ADP) : NaN;
    rows.push({
      fantrax_team_id: String(p.teamId),   // the owner - the durable key (084)
      team_slot: slot,                     // the provider's seating, as imported
      round: p.round,
      pick_in_round: p.pickInRound,
      fantrax_player_id: id,
      player_name: displayName(x.name),
      position: toPoolPosition(x.position),
      adp: Number.isFinite(price) ? price : null,
      team: x.teamShortName ?? null,
    });
  }
  return { rows, unresolved };
}

// ---------------------------------------------------------------------------
// Minors: the devy shelf.
// ---------------------------------------------------------------------------

/**
 * "Elijiah" against "Elijah": human-typed names hit loosely, and a loose hit is
 * REPORTED AS LOOSE rather than failed or silently accepted. Exact means the
 * house key matches; loose means the last name matches exactly and the first
 * is within two edits (a doubled letter, a dropped one, a transposition).
 */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function nameHit(typed, resolved) {
  const a = normalizeName(typed); const b = normalizeName(resolved);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const [af, ...ar] = a.split(' '); const [bf, ...br] = b.split(' ');
  if (ar.length && ar.join(' ') === br.join(' ') && editDistance(af, bf) <= 2) return 'loose';
  return null;
}

/**
 * Every MINORS roster item, on the team Fantrax says holds it, with a name
 * from the first rung of the ladder that knows him:
 *     NFL id table -> NCAAF id table -> the rookie-draft fixture -> null
 *
 * TEAM ASSIGNMENT IS THE PROVIDER'S. getTeamRosters names the team for every
 * item; nothing here infers a holder from a pick, a name or a position.
 *
 * THE FIXTURE RUNG IS OWNER-SCOPED. A fixture is a human's list of who took
 * whom, keyed by first name, not team id. An owner maps to a team ONLY on
 * evidence - the reader's own seat (isMine), or a fixture name that a higher
 * rung already landed on that team's minors - and a fixture name is offered
 * only to the nameless entries of that one team, and only when exactly one
 * entry could take it. Two nameless receivers and one typed receiver is not a
 * match; it is reported.
 *
 * Returns the entries per team plus the audit the report prints: the owner ->
 * team correspondence observed, every fixture name's outcome, and every
 * fixture-sourced assignment for ratification.
 */
const ACTIVE_STATUSES = new Set(['ACTIVE', 'RESERVE', 'INJURED_RESERVE']);

export function toMinors(rosters, teams, { nfl, ncaaf = null, fixture = null, keeperIds = new Set(), myOwner = null } = {}) {
  const byTeamId = new Map(teams.map((t) => [t.fantraxTeamId, t]));
  const perTeam = new Map(teams.map((t) => [t.fantraxTeamId, []]));
  const addsPerTeam = new Map(teams.map((t) => [t.fantraxTeamId, []]));
  const unknownTeams = []; const unknownStatus = [];
  // EVERY ROSTERED PLAYER LANDS IN EXACTLY ONE BUCKET, and the buckets are
  // printed. The rule started as "rostered = keepers + minors" and held on the
  // probe (76 = 41 + 35) by coincidence: two keepers were on the minors shelf
  // and two waiver claims were active, and they cancelled. The live roster
  // then grew by a claim (77) and the coincidence broke. A player the league
  // holds who is neither a made pick nor on the shelf is an ADD - acquired
  // after keepers were declared - and is carried on the team so the config
  // loses nobody; the draft does not seed him because no pick is his.
  const buckets = { keeperActive: 0, keeperMinors: 0, minors: 0, adds: 0 };
  const seenKeepers = new Set();
  let rostered = 0;
  for (const [teamId, r] of Object.entries(rosters?.rosters ?? {})) {
    if (!byTeamId.has(teamId)) { unknownTeams.push(teamId); continue; }
    for (const it of r?.rosterItems ?? []) {
      rostered += 1;
      const id = String(it.id);
      const status = String(it?.status ?? '').toUpperCase();
      const a = nfl?.get(id); const b = ncaaf?.get(id);
      const name = a?.name ? displayName(a.name) : b?.name ? displayName(b.name) : null;
      const nameSource = a?.name ? 'nfl' : b?.name ? 'ncaaf' : null;
      const isKeeper = keeperIds.has(id);
      if (isKeeper) seenKeepers.add(id);
      if (status === 'MINORS') {
        buckets[isKeeper ? 'keeperMinors' : 'minors'] += 1;
        perTeam.get(teamId).push({
          fantraxId: id, name, position: toPoolPosition(it.position), nameSource,
          ...(isKeeper ? { alsoKeeper: true } : {}),
        });
      } else if (ACTIVE_STATUSES.has(status)) {
        if (isKeeper) { buckets.keeperActive += 1; continue; }
        buckets.adds += 1;
        addsPerTeam.get(teamId).push({ fantraxId: id, name, position: toPoolPosition(it.position), status });
      } else {
        unknownStatus.push({ teamId, id, status });
      }
    }
  }
  const missingKeepers = [...keeperIds].filter((id) => !seenKeepers.has(id));

  // ---- fixture rung ------------------------------------------------------
  const audit = { owners: [], fixtureAssignments: [], ambiguous: [] };
  for (const o of fixture?.owners ?? []) {
    const names = (o.players ?? []).map((pl) => (typeof pl === 'string' ? { name: pl, position: null } : pl));
    // Evidence: which teams already carry one of this owner's names.
    const evidence = [];
    for (const t of teams) {
      for (const m of perTeam.get(t.fantraxTeamId)) {
        if (!m.name) continue;
        for (const f of names) {
          const hit = nameHit(f.name, m.name);
          if (hit) evidence.push({ team: t.name, slot: t.slot, fixtureName: f.name, resolved: m.name, hit, via: m.nameSource });
        }
      }
    }
    if (myOwner && o.owner === myOwner) {
      const mine = teams.find((t) => t.isMine);
      if (mine) evidence.push({ team: mine.name, slot: mine.slot, fixtureName: null, resolved: null, hit: 'isMine', via: 'seat' });
    }
    const teamSlots = [...new Set(evidence.map((e) => e.slot))];
    const team = teamSlots.length === 1 ? teams.find((t) => t.slot === teamSlots[0]) : null;
    const outcome = { owner: o.owner, team: team?.name ?? null, slot: team?.slot ?? null,
      evidence, names: names.map((f) => ({ name: f.name, outcome: 'unplaced' })) };
    for (const f of outcome.names) {
      const e = evidence.find((x) => x.fixtureName === f.name);
      if (e) f.outcome = e.hit === 'exact' ? `exact: ${e.resolved} (${e.via})` : `loose: "${f.name}" ~ "${e.resolved}" (${e.via})`;
    }
    if (team) {
      const entries = perTeam.get(team.fantraxTeamId);
      const nameless = entries.filter((m) => !m.name);
      const spare = names.filter((f) => !evidence.some((e) => e.fixtureName === f.name));
      for (const f of spare) {
        // Position sanity: a typed position must not contradict the roster's.
        const fits = nameless.filter((m) => !m.name && (!f.position || toPoolPosition(f.position) === m.position));
        if (fits.length === 1 && spare.filter((g) => !g.position || toPoolPosition(g.position) === fits[0].position).length === 1) {
          fits[0].name = displayName(f.name); fits[0].nameSource = 'fixture';
          audit.fixtureAssignments.push({ team: team.name, slot: team.slot, fantraxId: fits[0].fantraxId, position: fits[0].position, name: f.name });
          outcome.names.find((n) => n.name === f.name).outcome = `fixture -> ${fits[0].fantraxId} (${fits[0].position})`;
        } else {
          audit.ambiguous.push({ owner: o.owner, team: team.name, fixtureName: f.name, candidates: fits.map((m) => `${m.fantraxId} ${m.position}`) });
        }
      }
    }
    audit.owners.push(outcome);
  }

  const entries = teams.map((t) => ({
    slot: t.slot, fantraxTeamId: t.fantraxTeamId,
    minors: perTeam.get(t.fantraxTeamId), adds: addsPerTeam.get(t.fantraxTeamId),
  }));
  const count = entries.reduce((n, t) => n + t.minors.length, 0);
  const adds = entries.flatMap((t) => t.adds.map((a) => ({ slot: t.slot, ...a })));
  return { entries, count, rostered, buckets, adds, missingKeepers, unknownTeams, unknownStatus, audit };
}

// ---------------------------------------------------------------------------

export async function importFantraxLeague(sql, { userId, leagueId, now = new Date(), fetchers = api, rookieFixture = null, myOwner = null }) {
  const summary = { leagueId, userId, poolWritten: 0, poolCandidates: 0, poolDraftable: 0, poolExcluded: 0, collegeWritten: 0, collegeSkipped: 0, keepers: 0, minors: 0, skipped: [] };

  // ONE FULL getLeagueInfo. The 375KB of playerInfo is the only place the
  // provider states who the league already holds; it is read for status and
  // discarded. The NCAAF id table is the second rung of the minors ladder:
  // measured, 18 of 18 devy ids absent from the NFL table are present in it.
  const [leagues, info, results, playerIds, ncaafIds, adp, rosters, ncaafAdp] = await Promise.all([
    fetchers.getLeagues(), fetchers.getLeagueInfo(leagueId, { excludePlayerInfo: false }),
    fetchers.getDraftResults(leagueId), fetchers.getPlayerIds('NFL'), fetchers.getPlayerIds('NCAAF'),
    fetchers.getAdp(), fetchers.getTeamRosters(leagueId), fetchers.getAdp('NCAAF'),
  ]);

  const mine = leagues.find((l) => l.leagueId === leagueId);
  if (!mine) return { ok: false, reason: 'league_not_on_account' };

  const scoring = toScoringFormat(info);
  if (!scoring.ok) return { ok: false, reason: 'unsupported_scoring', error: scoring.error };

  const { slots, total, unmapped } = toRosterSlots(info.rosterInfo);
  if (unmapped.length) return { ok: false, reason: 'unmapped_roster_positions', error: `Unrecognised roster positions: ${unmapped.join(', ')}` };

  const teamsCount = Object.keys(info.teamInfo ?? {}).length;
  const crosswalk = buildCrosswalk(playerIds);
  const ncaaf = buildCrosswalk(ncaafIds);
  const teams = toTeams(results, info, mine.teamId);
  const snapshotDate = today(now);
  const held = heldByLeague(info.playerInfo);

  // ---- pool ----------------------------------------------------------------
  const { rows: poolRows, skipped, draftable, excluded } = toPoolRows(adp, crosswalk, {
    snapshotDate, scoringFormat: scoring.format, teamsCount, slots, exclude: held,
  });
  // THE COLLEGE ROWS SHARE THE SNAPSHOT. Same date, format, teams and source as
  // the NFL rows above; only `league` differs. The NCAAF crosswalk they resolve
  // through is the one built for the minors ladder - it was already fetched and
  // already built, and this is its second reader.
  //
  // NOT EXCLUDED BY `held`. That map is playerInfo's roster status, which is an
  // NFL-id fact: a devy player the league holds appears on a MINORS shelf, not
  // in playerInfo, so filtering college rows through it would be filtering them
  // through a table that cannot describe them.
  const { rows: collegeRows, skipped: collegeSkipped } = toCollegePoolRows(ncaafAdp, ncaaf, {
    snapshotDate, scoringFormat: scoring.format, teamsCount, slots,
  });
  summary.poolCandidates = (adp ?? []).length;
  summary.poolDraftable = draftable;
  summary.poolExcluded = excluded;
  summary.skipped = skipped;
  // THE SNAPSHOT IS REPLACED, NOT MERGED. An upsert cannot remove a row, and a
  // second import on the same day - measured, DEV 1 Sep - left the 58 rows the
  // first import had written and the second had excluded sitting in the same
  // snapshot, so the pool offered every keeper and an interactive draft took
  // Kenneth Walker III at overall 17. One transaction: clear this source's
  // rows for the (date, format, teams) key, then write today's set.
  await sql.transaction([
    sql`DELETE FROM sim_player_pool
         WHERE source = 'fantrax' AND snapshot_date = ${snapshotDate}
           AND scoring_format = ${scoring.format} AND teams_count = ${teamsCount}`,
    ...[...poolRows, ...collegeRows].map((r) => sql`
      INSERT INTO sim_player_pool (snapshot_date, scoring_format, teams_count, ffc_player_id,
                                   name, position, team, adp, source, league, ncaaf_adp)
      VALUES (${r.snapshot_date}, ${r.scoring_format}, ${r.teams_count}, ${r.ffc_player_id},
              ${r.name}, ${r.position}, ${r.team}, ${r.adp}, ${r.source}, ${r.league},
              ${r.ncaaf_adp ?? null})`),
  ]);
  summary.poolWritten = poolRows.length;
  summary.collegeWritten = collegeRows.length;
  summary.collegeSkipped = collegeSkipped.length;
  // STEP 2 IS NOT OPTIONAL (the adp-snapshot cron's own words). A pool row is
  // an ADP price with NO identity: the room's PPG, the player sheet and the
  // stat sorts all join through sim_player_pool.matched_player_id, and this
  // INSERT leaves it NULL. The first Fantrax import (1 Sep 2026) shipped step 1
  // alone and every PPG cell on the Pick tab read '-' until the daily cron
  // happened to run the matcher. So the import resolves its own rows, here,
  // before anything can draft from them. Name+position exact, idempotent,
  // pool-only writes; the unmatched stay dark and are reported, never guessed.
  const match = await matchPoolIdentities(sql);
  summary.poolMatched = match.counts.matched;
  summary.poolUnmatched = match.unmatched.map((u) => `${u.name} ${u.position}`);
  summary.poolAmbiguous = match.ambiguous.map((a) => `${a.name} ${a.position}`);

  // ---- keepers, resolved BEFORE the config is written ----------------------
  // Nothing is inserted until every keeper resolves: a config with a partial
  // keeper set is a draft that quietly gives somebody a free pick.
  const { rows: keepers, unresolved } = toKeepers(results, crosswalk, teams, adp);
  if (unresolved.length) {
    return { ok: false, reason: 'unresolved_keepers',
      error: `${unresolved.length} keeper(s) did not resolve: ${unresolved.slice(0, 5).join(', ')}` };
  }
  // THE PROVIDER'S SEATING MUST AGREE WITH ITSELF. This check used to run at
  // draft time (keeperSeed, pre-084); it belongs here, where the rows still
  // describe Fantrax's order and not a run's. Refused, never placed on a guess.
  const seatConflicts = providerSeatConflicts(keepers, teamsCount);
  if (seatConflicts.length) {
    return { ok: false, reason: 'keeper_seat_conflict',
      error: `${seatConflicts.length} keeper(s) sit off their team's pick: ${JSON.stringify(seatConflicts[0])}` };
  }
  // ONE KEEPER PER OWNER PER ROUND (084 unique). Two would need a traded pick,
  // which a re-seated snake cannot place. Refused here with a readable reason,
  // not as a constraint violation mid-insert with the config already written.
  const seen = new Set();
  for (const k of keepers) {
    const key = `${k.fantrax_team_id}:${k.round}`;
    if (seen.has(key)) {
      return { ok: false, reason: 'keeper_round_collision',
        error: `team ${k.fantrax_team_id} holds two keepers in round ${k.round} (${k.player_name})` };
    }
    seen.add(key);
  }

  // ---- minors, onto the teams jsonb ----------------------------------------
  const keeperIds = new Set(keepers.map((k) => k.fantrax_player_id));
  const minors = toMinors(rosters, teams, { nfl: crosswalk, ncaaf, fixture: rookieFixture, keeperIds, myOwner });
  if (minors.unknownTeams.length) {
    return { ok: false, reason: 'roster_team_unknown', error: `getTeamRosters names team(s) not in draftOrder: ${minors.unknownTeams.join(', ')}` };
  }
  // CONSERVATION, HARD. Every rostered player is a made pick, on the devy
  // shelf, or an add - and every made pick is rostered somewhere. A roster
  // status this code does not know, or a keeper the league no longer holds,
  // is a player the draft would seed or drop without anyone noticing.
  const b = minors.buckets;
  const accounted = b.keeperActive + b.keeperMinors + b.minors + b.adds;
  if (minors.unknownStatus.length || accounted !== minors.rostered) {
    return { ok: false, reason: 'roster_conservation',
      error: `rostered ${minors.rostered} != keepers on roster ${b.keeperActive + b.keeperMinors} + minors ${b.minors} + adds ${b.adds}; unknown status: ${JSON.stringify(minors.unknownStatus)}` };
  }
  if (b.keeperActive + b.keeperMinors !== keepers.length || minors.missingKeepers.length) {
    return { ok: false, reason: 'keeper_not_rostered',
      error: `${minors.missingKeepers.length} keeper(s) not on any roster: ${minors.missingKeepers.join(', ')}` };
  }
  for (const t of teams) {
    const e = minors.entries.find((x) => x.slot === t.slot);
    t.minors = e?.minors ?? [];
    t.adds = e?.adds ?? [];
  }
  summary.minors = minors.count;
  summary.rostered = minors.rostered;
  summary.rosterBuckets = b;
  summary.adds = minors.adds;
  summary.minorsAudit = minors.audit;

  // ---- config --------------------------------------------------------------
  const [cfg] = await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots,
                               pick_timer_seconds, is_preset, source, external_league_id,
                               teams, draft_date, pool_source)
    VALUES (${userId}, ${String(mine.leagueName ?? '').trim()}, ${teamsCount}, ${scoring.format},
            ${JSON.stringify(slots)}::jsonb, ${90}, false, 'fantrax', ${leagueId},
            ${JSON.stringify(teams)}::jsonb, ${results?.draftDate ?? null}, 'fantrax')
    RETURNING id`;
  summary.configId = cfg.id;
  // THE OWNER'S SEAT AT THE TABLE (085). Membership is one column per person -
  // the importer is the owner, tied to the franchise they imported as. The
  // partial unique on (config_id, fantrax_team_id) is what makes that seat
  // theirs; a member who redeems an invite claims one of the other eleven.
  await sql`
    INSERT INTO draft_config_members (config_id, user_id, role, fantrax_team_id)
    VALUES (${cfg.id}, ${userId}, 'owner', ${mine.teamId ?? null})`;

  for (const k of keepers) {
    await sql`
      INSERT INTO draft_config_keepers (config_id, fantrax_team_id, team_slot, round, pick_in_round,
                                        fantrax_player_id, player_name, position, adp, team)
      VALUES (${cfg.id}, ${k.fantrax_team_id}, ${k.team_slot}, ${k.round}, ${k.pick_in_round},
              ${k.fantrax_player_id}, ${k.player_name}, ${k.position}, ${k.adp}, ${k.team})`;
    summary.keepers += 1;
  }

  return {
    ok: true, ...summary,
    name: String(mine.leagueName ?? '').trim(), scoringFormat: scoring.format,
    rosterSlots: slots, rounds: total, teamsCount,
    myFantraxTeamId: mine.teamId,
    mySlot: teams.find((t) => t.isMine)?.slot ?? null,
    draftDate: results?.draftDate ?? null,
  };
}

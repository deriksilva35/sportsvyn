// lib/house/october.js - filing the house's five, at the moment a day is made.
//
// IT FILES AT CREATION, NOT ON A TICK. The other four games are filed by an
// hourly cron (lib/house/run.js) because their boards appear on a schedule
// nobody controls exactly. October's do not: ensureOctoberDay() is the one place
// a day comes into existence, it runs inside the postseason import and the
// preview creator, and the card opens the instant it returns. Filing there means
// the house is on the board before the first reader loads it, and it means
// "when does the house play?" has one answer instead of a cron window.
//
// ITS OWN MODULE, and deliberately not another function in lib/house/run.js.
// That file imports the drafts engine, the weekly reader, the pickem door and
// the odds reader; lib/october/create.js is called by an importer that needs
// none of them, and pulling the whole house tick into it would make a day's
// creation depend on modules October never touches.
//
// EVERY PICK GOES THROUGH THE READER'S OWN DOOR. saveOctoberPick() is the
// function the card calls, so the house meets refuseReason() exactly as a reader
// does: the day's per-game cap, no player twice on one card, no picking from a
// started or postponed game. THERE IS NO PRIVATE INSERT - the temptation is one
// INSERT with a whole lineup in it, and that would be a second writer able to
// file a card the rules forbid, which is the thing the house is supposed to
// prove it does not do.
//
// A SHORT CARD IS FILED SHORT AND DNFs. Exactly what happens to a reader who
// leaves a slot empty past its first pitch: lib/october/rules.js dayState()
// returns DNF and settleOctoberDay scores it 0 and says so. A house entry that
// got a fallback nobody else gets would not be playing the same game.

import { PERSONAS, playsGame } from './personas.js';
import { ensureHouseAccounts } from './accounts.js';
import { pickOctober } from './pickOctober.js';
import { saveOctoberPick } from '../october/entry.js';
import { octoberPool } from '../october/pool.js';
import { SLOTS, CARD_SIZE, maxPerGame } from '../october/rules.js';
import { makeRng } from '../fantasy/engine.js';

/**
 * A SEEDED RNG, DERIVED FROM THE PERSONA AND THE CONTEST, never Math.random.
 * The Gut is noisy on purpose and must be the SAME noise on a re-run: creation
 * is idempotent, and a second pass that filed a different five would make the
 * house's card depend on how many times an importer happened to run.
 *
 * The same construction as lib/house/run.js's seedFor, and the same reason.
 */
const seedFor = (personaKey, contestId) => {
  let h = 2166136261;
  for (const ch of `${personaKey}:${contestId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return makeRng(Math.abs(h) % 2147483647);
};

const ok = (v) => ({ ok: true, ...v });
const skip = (why) => ({ ok: true, skipped: why });

/**
 * One persona's five on one day.
 *
 * @param contest  the row ensureOctoberDay just made: { id, board, season_year, meta }
 */
export async function fileOctober({ userId, personaKey, contest, now = new Date() }) {
  if (!playsGame(personaKey, 'october')) return skip('no method on this game');

  // THE POOL IS THE READER'S POOL. octoberPool caches into contest.meta.pool on
  // first build, so filing at creation is the call that warms it - the first
  // human to load the card gets the cached one. A pool that could not be built
  // is a skip, never an invented roster: "no pool yet" is true and a made-up
  // five would be a lie that scores points.
  const pool = await octoberPool(contest).catch(() => null);
  const flat = Object.values(pool?.byGame ?? {}).flat();
  if (!flat.length) return skip('no pool yet');

  const board = contest.board ?? [];
  const lineup = pickOctober(personaKey, flat, { board, now }, seedFor(personaKey, contest.id));
  if (!lineup) return skip('no method on this game');
  if (!Object.keys(lineup).length) return skip('no eligible players');

  let filed = 0;
  const refused = [];
  for (const slot of SLOTS) {
    const p = lineup[slot];
    if (!p) continue;
    const r = await saveOctoberPick(userId, contest.id, slot, {
      playerId: p.playerId, matchId: p.matchId, kind: p.kind, name: p.name, team: p.team ?? null,
    }, { now });
    if (r.ok) { filed += 1; continue; }
    // A REFUSED SLOT IS RECORDED AND THE REST ARE STILL TRIED. October locks per
    // SLOT, not per card - unlike the Run, whose round locks as a whole - so one
    // game already under way says nothing about the other four. Stopping here
    // would leave a card short for a reason that did not apply to its other
    // slots.
    refused.push({ slot, reason: r.reason });
  }
  return ok({
    filed, of: CARD_SIZE, cap: maxPerGame(board),
    // SHORT MEANS IT WILL DNF, and the summary says so rather than making it
    // look like a filed card.
    short: filed < CARD_SIZE,
    ...(refused.length ? { refused } : {}),
  });
}

/**
 * Every persona's card on one freshly-made day. Called by ensureOctoberDay().
 *
 * ONE PERSONA'S BAD DAY COSTS ONLY ITS OWN ENTRY - each filing is guarded, and a
 * Homer with no clubs in tonight's games must not stop The Chalk from filing.
 */
export async function fileOctoberDay(contest, { now = new Date() } = {}) {
  if (!contest?.id) return { filed: {}, reason: 'no contest' };
  const { byKey, created, repaired } = await ensureHouseAccounts(
    (await import('../db.js')).sql,
  );
  const out = {};
  for (const p of PERSONAS) {
    if (!playsGame(p.key, 'october')) { out[p.key] = { skipped: 'does not play' }; continue; }
    try {
      out[p.key] = await fileOctober({ userId: byKey.get(p.key), personaKey: p.key, contest, now });
    } catch (e) {
      out[p.key] = { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
    }
  }
  return { created, repaired, filed: out };
}

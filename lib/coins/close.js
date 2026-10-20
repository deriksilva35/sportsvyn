// lib/coins/close.js - THE CLOSE: Tuesday 09:00 PT, the drawing (Rules v0.1
// s2, s4-s6; coins-2 B5).
//
// WHEN. The cron fires Tue 16:00Z and 17:00Z (09:00 PT in PDT and in PST). A
// week closes once its closes_at - itself 09:00 PT - has passed, so the PST
// 16:00Z firing finds nothing to close and the 17:00Z one does it; in PDT the
// 17:00Z firing finds the week already drawn. The claim (drawn_at, set once)
// is what makes a second firing a no-op, not the clock.
//
// THE ORDER, each step safe to rerun:
//   1. MINT (lib/coins/mint.js): a Weekly that settled before the Close is in.
//   2. AUTO-DROP (s4): every eligible player's coins still in hand go into the
//      lowest-value drum, auto = true. Minors, a NULL date of birth, house and
//      staff are never auto-dropped (ruling coins-2). One statement, guarded
//      against a second pass.
//   3. THE SEED: the week's last NFL final, "AWAY n - HOME n" (s5). No NFL
//      final that week: the last final of any league; none at all: the week id.
//   4. THE DRAW (lib/coins/draw.js): per drum, a seeded shuffle of its tickets;
//      the first `count` win.
//   5. THE CLAIM + WINNERS in one transaction: coin_weeks.drawn_at / seed_text
//      / draw (what the reveal page publishes) and drum_winners (pending). A
//      second run claims nothing and inserts nothing.
//   6. NEXT WEEK opens with the posted prizes.
//   7. TELL EVERY ENTRANT (s6): push (two waves: winners, everyone else) and
//      email, each once per user per week.
//
// DRY RUN writes nothing at all - no mint, no drop, no claim, no message - and
// returns the would-be winners, the auto-drops simulated after the real ones.

import { sql as defaultSql } from '../db.js';
import { runMint, ensureWeek } from './mint.js';
import { adultUserIds } from '../auth/ageGateDb.js';
import { OWNER_ADDRESSES } from '../email/owners.js';
import { lowestDrum } from './rules.js';
import { drawDrum, seedText } from './draw.js';

export const SOURCE = 'coins-close';

/** The oldest week whose Close has passed and that is not drawn yet. */
export async function weekToClose(now = new Date(), db = defaultSql, weekId = null) {
  const [w] = await db`
    SELECT w.*, (SELECT count(*)::int FROM coin_weeks x WHERE x.opens_at <= w.opens_at) AS ordinal
      FROM coin_weeks w WHERE w.drawn_at IS NULL AND w.closes_at <= ${new Date(now).toISOString()}
       AND (${weekId}::int IS NULL OR w.id = ${weekId})
     ORDER BY w.opens_at LIMIT 1`;
  return w ?? null;
}

/** Who among these users may be entered: 18+ on file, not house, not staff. */
export async function eligibleIds(userIds, now = new Date(), db = defaultSql) {
  if (!userIds.length) return new Set();
  const users = await db`SELECT id, email, contact_email, is_house FROM users WHERE id = ANY(${userIds})`;
  const owners = new Set(OWNER_ADDRESSES.map((a) => a.toLowerCase()));
  const adults = await adultUserIds(userIds, now, db);
  return new Set(users.filter((u) => !u.is_house && adults.has(Number(u.id))
    && ![u.email, u.contact_email].some((a) => a && owners.has(String(a).toLowerCase()))).map((u) => Number(u.id)));
}

/** The coins still in hand at the Close, per eligible user: [{ user_id, qty }]. */
export async function handsAtClose(week, now = new Date(), db = defaultSql) {
  const rows = await db`
    SELECT m.user_id, m.minted - COALESCE(d.dropped, 0) AS hand
      FROM (SELECT user_id, sum(qty)::int AS minted FROM coin_mint WHERE week_id = ${week.id} GROUP BY 1) m
      LEFT JOIN (SELECT user_id, sum(qty)::int AS dropped FROM drum_entries WHERE week_id = ${week.id} GROUP BY 1) d USING (user_id)`;
  const held = rows.filter((r) => Number(r.hand) > 0);
  const ok = await eligibleIds(held.map((r) => Number(r.user_id)), now, db);
  return held.filter((r) => ok.has(Number(r.user_id))).map((r) => ({ user_id: Number(r.user_id), qty: Number(r.hand) }))
    .sort((a, b) => a.user_id - b.user_id);
}

/** The published seed for a week. */
export async function seedFor(week, db = defaultSql) {
  const finals = (league) => db`
    SELECT h.abbreviation AS home_abbr, a.abbreviation AS away_abbr, m.home_score, m.away_score
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'final' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       AND m.kickoff_at >= ${week.opens_at} AND m.kickoff_at < ${week.closes_at}
       AND (${league}::text IS NULL OR l.slug = ${league})
     ORDER BY m.kickoff_at DESC, m.id DESC LIMIT 1`;
  const [nfl] = await finals('nfl');
  if (nfl) return seedText(nfl);
  const [any] = await finals(null);
  return any ? seedText(any) : `WEEK ${week.id}`;
}

/** Ticket labels for the published draw: a handle, else an opaque player number. */
async function labels(userIds, db) {
  if (!userIds.length) return new Map();
  const rows = await db`SELECT id, handle FROM users WHERE id = ANY(${userIds})`;
  return new Map(rows.map((r) => [Number(r.id), r.handle ? `@${r.handle}` : `player ${(Number(r.id) * 2654435761 % 2 ** 32).toString(36)}`]));
}

/**
 * THE RUN. -> { decision, week, seed, drums: [{ prize_key, coins, players, winners }], autoDropped, notified }.
 * `send` (email) and `notify` (push) are injected; a dry run calls neither.
 */
export async function runClose({ now = new Date(), db = defaultSql, dryRun = false, send = null, notify = null, mint = true, mintOpts = {}, previewWeekId = null, weekId = null } = {}) {
  // PREVIEW (dry run only): draw the OPEN week as if it closed now - the
  // review page on a preview deploy, before any real week has closed.
  if (previewWeekId != null && !dryRun) throw new Error('previewWeekId is for a dry run only');
  let week = previewWeekId != null
    ? (await db`SELECT w.*, (SELECT count(*)::int FROM coin_weeks x WHERE x.opens_at <= w.opens_at) AS ordinal FROM coin_weeks w WHERE w.id = ${previewWeekId} AND w.drawn_at IS NULL`)[0] ?? null
    : await weekToClose(now, db, weekId); // weekId: close exactly that week (tests, a hand rerun)
  if (!week) return { decision: 'nothing-to-close' };
  if (mint && !dryRun) await runMint({ now: new Date(new Date(week.closes_at).getTime() - 1), db, force: true, ...mintOpts });

  const prizes = await db`SELECT * FROM drum_prizes WHERE week_id = ${week.id} ORDER BY value_cents DESC, prize_key`;
  const low = lowestDrum(prizes);
  const hands = await handsAtClose(week, now, db);
  let autoDropped = hands.reduce((s, h) => s + h.qty, 0);

  if (!dryRun && low && hands.length) {
    const [ins] = await db.transaction((tx) => [tx`
      INSERT INTO drum_entries (user_id, week_id, prize_key, qty, dropped_at, auto)
      SELECT x.user_id, ${week.id}, ${low.prize_key}, x.qty, ${week.closes_at}, true
        FROM jsonb_to_recordset(${JSON.stringify(hands)}::jsonb) AS x(user_id int, qty int)
       WHERE (SELECT drawn_at FROM coin_weeks WHERE id = ${week.id}) IS NULL
         AND NOT EXISTS (SELECT 1 FROM drum_entries WHERE week_id = ${week.id} AND auto)
      ORDER BY x.user_id
      RETURNING id`], { isolationLevel: 'Serializable' });
    autoDropped = ins.length ? autoDropped : 0;
  }

  let entries = await db`SELECT id, user_id, prize_key, qty FROM drum_entries WHERE week_id = ${week.id} ORDER BY id`;
  if (dryRun && low) {
    let fake = Math.max(0, ...entries.map((e) => Number(e.id))) + 1;
    entries = [...entries, ...hands.map((h) => ({ id: fake++, user_id: h.user_id, prize_key: low.prize_key, qty: h.qty, simulated: true }))];
  }
  const seed = await seedFor(week, db);
  const lab = await labels([...new Set(entries.map((e) => Number(e.user_id)))], db);
  const drums = prizes.map((p) => {
    const mine = entries.filter((e) => e.prize_key === p.prize_key);
    const d = drawDrum({ entries: mine, seed, prizeKey: p.prize_key, count: p.count });
    return {
      prize_key: p.prize_key, title: p.title, kind: p.kind, value_cents: p.value_cents, count: p.count,
      coins: d.tickets.length, players: new Set(d.tickets.map((t) => t.user_id)).size,
      tickets: d.tickets.map((t) => lab.get(t.user_id)), order: d.order,
      winners: d.winners.map((w) => ({ ...w, label: lab.get(w.user_id) })),
    };
  });
  const players = new Set(entries.map((e) => Number(e.user_id))).size;
  const draw = { seed, method: 'sha256-counter fisher-yates v1', players, coins: drums.reduce((s, d) => s + d.coins, 0), drums };
  const out = { decision: dryRun ? 'dry-run' : 'drawn', week: week.id, ordinal: week.ordinal, seed, players, autoDropped, ...(dryRun ? { draw } : {}),
    drums: drums.map((d) => ({ prize_key: d.prize_key, coins: d.coins, players: d.players, winners: d.winners.map((w) => `${w.label} (coin ${w.coin_index})`) })) };
  if (dryRun) return out;

  const at = new Date(now).toISOString();
  const winners = drums.flatMap((d) => d.winners.map((w) => ({ prize_key: d.prize_key, user_id: w.user_id, coin_index: w.coin_index })));
  const [claimed] = await db.transaction((tx) => [
    tx`UPDATE coin_weeks SET drawn_at = ${at}, seed_text = ${seed}, draw = ${JSON.stringify(draw)}::jsonb
        WHERE id = ${week.id} AND drawn_at IS NULL RETURNING id`,
    tx`INSERT INTO drum_winners (week_id, prize_key, user_id, coin_index)
       SELECT ${week.id}, x.prize_key, x.user_id, x.coin_index
         FROM jsonb_to_recordset(${JSON.stringify(winners)}::jsonb) AS x(prize_key text, user_id int, coin_index int)
        WHERE (SELECT drawn_at FROM coin_weeks WHERE id = ${week.id}) = ${at}::timestamptz`,
  ]);
  if (!claimed.length) return { ...out, decision: 'already-drawn' };

  const next = await ensureWeek(db, now);
  out.next = next.id;
  out.notified = await tellEntrants({ week, next, drums, entries, db, send, notify });
  return out;
}

/** s6: every entrant hears, winners first. Push via `notify`, email via `send`; each optional. */
async function tellEntrants({ week, next, drums, entries, db, send, notify }) {
  const won = new Map();
  for (const d of drums) for (const w of d.winners) if (!won.has(w.user_id)) won.set(w.user_id, d.title);
  const coins = new Map();
  for (const e of entries) coins.set(Number(e.user_id), (coins.get(Number(e.user_id)) ?? 0) + Number(e.qty));
  const [{ n: nextOrdinal }] = await db`SELECT count(*)::int AS n FROM coin_weeks WHERE opens_at <= ${next.opens_at}`;
  const res = { push: null, email: null };
  if (notify) {
    const winners = [...won].map(([userId, prize]) => ({ userId, params: { week: String(week.ordinal), prize: `a ${prize}` } }));
    const rest = [...coins.keys()].filter((u) => !won.has(u))
      .map((userId) => ({ userId, params: { week: String(week.ordinal), coins: `${coins.get(userId)} coin${coins.get(userId) === 1 ? '' : 's'}`, next: String(nextOrdinal) } }));
    res.push = { won: await notify(`coins-won:${week.id}`, winners).catch((e) => ({ error: String(e?.message ?? e) })),
      rest: await notify(`coins-result:${week.id}`, rest).catch((e) => ({ error: String(e?.message ?? e) })) };
  }
  if (send) res.email = await send({ week, won, coins, nextOrdinal, db }).catch((e) => ({ error: String(e?.message ?? e) }));
  return res;
}


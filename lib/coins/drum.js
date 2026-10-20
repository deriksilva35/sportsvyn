// lib/coins/drum.js - THE DRUM: what a reader sees this week, and the drop
// (Rules v0.1 s4-s5; mock "The Drum" + "Confirm drop").
//
// COINS IN HAND = minted this week - dropped this week. Computed on every
// read, never stored (migration 147).
//
// WHO MAY DROP (ruling coins-2): 18 or older by the date of birth on file
// (lib/auth/ageGateDb.js adultUserIds - the date never leaves that file), not
// a house account, not an owner address (Sportsvyn's own people are not
// eligible to win, s1). Everyone else still earns and sees coins - a minor
// sees "18+ to win", no steppers, and is never auto-dropped. A NULL date is
// not 18+ until the first-win sheet collects it.
//
// A DROP IS FINAL (s4). There is no un-drop endpoint and no UPDATE or DELETE
// of drum_entries anywhere in the app.

import { sql as defaultSql } from '../db.js';
import { adultUserIds } from '../auth/ageGateDb.js';
import { OWNER_ADDRESSES } from '../email/owners.js';
import { meter, perCoinOdds, lowestDrum, WEEK_CAP } from './rules.js';

/** The week containing `now`, or null before the program's first week. */
export async function currentWeek(now = new Date(), db = defaultSql) {
  const at = new Date(now).toISOString();
  const [w] = await db`
    SELECT w.*, (SELECT count(*)::int FROM coin_weeks x WHERE x.opens_at <= w.opens_at) AS ordinal
      FROM coin_weeks w WHERE w.opens_at <= ${at} AND w.closes_at > ${at} LIMIT 1`;
  return w ?? null;
}

/** May this account drop coins (and so win)? */
export async function canEnter(userId, now = new Date(), db = defaultSql) {
  const [u] = await db`SELECT id, email, contact_email, is_house FROM users WHERE id = ${Number(userId)} LIMIT 1`;
  if (!u || u.is_house) return { ok: false, reason: 'house' };
  const owners = new Set(OWNER_ADDRESSES.map((a) => a.toLowerCase()));
  if ([u.email, u.contact_email].some((a) => a && owners.has(String(a).toLowerCase()))) return { ok: false, reason: 'staff' };
  const adults = await adultUserIds([u.id], now, db);
  return adults.has(Number(u.id)) ? { ok: true } : { ok: false, reason: 'age' };
}

/** A reader's coins for a week: { minted, dropped, inHand, mine: {prize_key: qty} }. */
export async function coinsFor(userId, weekId, db = defaultSql) {
  const [{ minted }] = await db`SELECT COALESCE(sum(qty), 0)::int AS minted FROM coin_mint WHERE user_id = ${Number(userId)} AND week_id = ${weekId}`;
  const drops = await db`SELECT prize_key, sum(qty)::int AS q FROM drum_entries WHERE user_id = ${Number(userId)} AND week_id = ${weekId} GROUP BY 1`;
  const mine = Object.fromEntries(drops.map((d) => [d.prize_key, d.q]));
  const dropped = drops.reduce((s, d) => s + d.q, 0);
  return { minted, dropped, inHand: Math.max(0, minted - dropped), mine };
}

/** The drums of a week with their live counts, lowest value last (the mock's order: biggest prize first). */
export async function drumsFor(weekId, db = defaultSql) {
  const rows = await db`
    SELECT p.prize_key, p.title, p.kind, p.value_cents, p.count,
           COALESCE(sum(e.qty), 0)::int AS coins, count(DISTINCT e.user_id)::int AS players
      FROM drum_prizes p LEFT JOIN drum_entries e ON e.week_id = p.week_id AND e.prize_key = p.prize_key
     WHERE p.week_id = ${weekId}
     GROUP BY p.id ORDER BY p.value_cents DESC, p.kind, p.prize_key`;
  const low = lowestDrum(rows)?.prize_key ?? null;
  return rows.map((r) => ({ ...r, odds: perCoinOdds({ coins: r.coins, count: r.count }), lowest: r.prize_key === low }));
}

/** "HOW YOU EARNED THEM": this week's points, newest first, with the meter. */
export async function earningsFor(userId, weekId, db = defaultSql) {
  const rows = await db`
    SELECT contest_key, event, points, detail, created_at FROM arcade_points
     WHERE user_id = ${Number(userId)} AND week_id = ${weekId} ORDER BY created_at DESC, id DESC LIMIT 60`;
  const [{ tp, me }] = await db`
    SELECT (SELECT COALESCE(sum(points), 0)::int FROM arcade_points WHERE user_id = ${Number(userId)}) AS tp,
           (SELECT COALESCE(sum(qty), 0)::int FROM coin_mint WHERE user_id = ${Number(userId)}) AS me`;
  return { rows, meter: meter({ totalPoints: tp, mintedEver: me }) };
}

/** Everything /coins and the Play strip draw. Signed out: the week and the drums only. */
export async function drumView({ userId = null, now = new Date(), db = defaultSql } = {}) {
  const week = await currentWeek(now, db);
  if (!week) return { week: null };
  const drums = await drumsFor(week.id, db);
  const base = { week: { id: week.id, ordinal: week.ordinal, opensAt: week.opens_at, closesAt: week.closes_at }, drums, cap: WEEK_CAP };
  if (userId == null) return base;
  const [coins, earned, entry] = await Promise.all([coinsFor(userId, week.id, db), earningsFor(userId, week.id, db), canEnter(userId, now, db)]);
  return { ...base, me: { ...coins, earned: earned.rows, meter: earned.meter, eligible: entry.ok, ineligible: entry.ok ? null : entry.reason } };
}

/** PURE: normalise a drop request -> [{ prize_key, qty }] or a refusal. */
export function parseDrop(body) {
  const list = Array.isArray(body?.drops) ? body.drops : [{ prize_key: body?.prize_key, qty: body?.qty }];
  const merged = new Map();
  for (const d of list) {
    const key = String(d?.prize_key ?? '').trim();
    const qty = Number(d?.qty);
    if (!key || !/^[a-z0-9_-]{1,40}$/.test(key)) return { ok: false, error: 'bad prize' };
    if (!Number.isInteger(qty) || qty < 1 || qty > WEEK_CAP) return { ok: false, error: 'bad qty' };
    merged.set(key, (merged.get(key) ?? 0) + qty);
  }
  if (!merged.size) return { ok: false, error: 'nothing to drop' };
  return { ok: true, drops: [...merged].map(([prize_key, qty]) => ({ prize_key, qty })) };
}

/**
 * THE DROP. Server-validated against coins in hand, in ONE guarded INSERT run
 * SERIALIZABLE: two drops racing from two tabs cannot both spend the same coin
 * (the loser gets a serialization failure, reported as 'retry').
 * -> { ok, dropped, inHand } | { ok:false, status, error }
 */
export async function dropCoins({ userId, body, now = new Date(), db = defaultSql }) {
  const parsed = parseDrop(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const week = await currentWeek(now, db);
  if (!week || week.drawn_at) return { ok: false, status: 409, error: 'no open week' };
  const entry = await canEnter(userId, now, db);
  if (!entry.ok) return { ok: false, status: 403, error: entry.reason === 'age' ? '18+ to win' : 'not eligible' };
  const keys = (await db`SELECT prize_key FROM drum_prizes WHERE week_id = ${week.id}`).map((p) => p.prize_key);
  if (parsed.drops.some((d) => !keys.includes(d.prize_key))) return { ok: false, status: 400, error: 'bad prize' };
  const total = parsed.drops.reduce((s, d) => s + d.qty, 0);
  const uid = Number(userId);
  const at = new Date(now).toISOString();
  let inserted;
  try {
    [inserted] = await db.transaction((tx) => [tx`
      INSERT INTO drum_entries (user_id, week_id, prize_key, qty, dropped_at, auto)
      SELECT ${uid}, ${week.id}, x.prize_key, x.qty, ${at}, false
        FROM jsonb_to_recordset(${JSON.stringify(parsed.drops)}::jsonb) AS x(prize_key text, qty int)
       WHERE ${at}::timestamptz < (SELECT closes_at FROM coin_weeks WHERE id = ${week.id} AND drawn_at IS NULL)
         AND (SELECT COALESCE(sum(qty), 0) FROM coin_mint WHERE user_id = ${uid} AND week_id = ${week.id})
           - (SELECT COALESCE(sum(qty), 0) FROM drum_entries WHERE user_id = ${uid} AND week_id = ${week.id}) >= ${total}
      RETURNING id`], { isolationLevel: 'Serializable' });
  } catch (e) {
    if (/could not serialize|serialization/i.test(String(e?.message))) return { ok: false, status: 409, error: 'retry' };
    throw e;
  }
  if (!inserted.length) return { ok: false, status: 409, error: 'not enough coins in hand' };
  const after = await coinsFor(uid, week.id, db);
  return { ok: true, dropped: total, inHand: after.inHand, mine: after.mine };
}

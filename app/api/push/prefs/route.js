// /api/push/prefs — read and write one scope's alert preferences.
//
// A MATCH ROW EXISTS OR IT DOES NOT. There is no "inherit" value to write, so
// "reset to team defaults" is a DELETE - which is also why this route has one.

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { DEFAULTS, SELECT_FIELDS, nextRow, resolvePrefs } from '@/lib/push/prefs';
import { viewerActivityFor } from '@/lib/push/liveActivityStore';

export const dynamic = 'force-dynamic';

// 'league' joined for NFL RED ZONE: scope_id is the league id, and the row is
// a standing instruction for every game in it.
const SCOPES = new Set(['team', 'match', 'league']);

export async function GET(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ signedIn: false, prefs: { ...DEFAULTS, source: 'default' }, liveActivity: false });

  const u = new URL(request.url);
  const matchId = Number(u.searchParams.get('matchId')) || null;
  const teamId = Number(u.searchParams.get('teamId')) || null;
  // BY SLUG, NOT BY ID. The caller is a client component and an integer league
  // id in a bundle is a number nobody can check; the slug is the thing the URL
  // space already speaks. The id is resolved here and handed back, so the PUT
  // that follows writes the same row this GET read.
  const leagueSlug = (u.searchParams.get('league') ?? '').trim().toLowerCase();
  const [lg] = leagueSlug ? await sql`
    SELECT id FROM leagues WHERE slug = ${leagueSlug}` : [];
  const leagueId = lg?.id ?? null;

  const [matchPref] = matchId ? await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'match' AND scope_id = ${matchId}` : [];
  const [teamPref] = teamId ? await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'team' AND scope_id = ${teamId}` : [];
  // IS THERE A LEAGUE FLOOR UNDER THIS GAME? The per-game sheet needs it to
  // say what turning the game OFF actually does - with red zone on, off means
  // "back to red zone", not silence. Only asked when a match is in hand, and
  // it is one indexed lookup on a table the route is already reading.
  const [floor] = matchId ? await sql`
    SELECT 1 FROM alert_prefs ap
      JOIN matches m ON m.id = ${matchId}
     WHERE ap.user_id = ${userId} AND ap.scope = 'league'
       AND ap.scope_id = m.league_id AND ap.master
     LIMIT 1` : [];
  const leagueFloor = Boolean(floor);
  // THE RED-ZONE ROW, when the caller asks for one. The You page's switch is
  // the only caller today and asks for a league alone; the per-game sheet does
  // not, because a league row must never be what a game's bell renders - it is
  // the floor under that sheet, not its state.
  const [leaguePref] = leagueId ? await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'league' AND scope_id = ${leagueId}` : [];
  // THE LOCK-SCREEN SWITCH RIDES THIS FETCH RATHER THAN OPENING A ROUTE OF
  // ITS OWN. It is keyed on exactly the same two things the prefs are - this
  // match, this reader - and it is read at exactly the same moment, when the
  // sheet first opens. A second endpoint would be a second round trip for one
  // boolean, and a second place for the sheet's state to be half-loaded.
  //
  // Caught to false: a failed read must leave the switch off, because off is
  // the state a reader can act on - an ON switch that cannot be turned off
  // is worse than an OFF switch that has to be tapped twice.
  const liveActivity = matchId
    ? await viewerActivityFor(sql, { matchId, userId }).catch(() => false)
    : false;
  // scope: 'match' whenever a matchId was asked for - the per-game sheet's
  // own read. With neither a saved match row nor a saved team row,
  // resolvePrefs() renders OFF rather than DEFAULTS (relay ruling: "the
  // screen may never show a push the system will not attempt").
  return Response.json({
    signedIn: true,
    prefs: resolvePrefs({ teamPref, matchPref, leaguePref, scope: matchId ? 'match' : null }),
    // The row the switch writes back to. Null when no league was asked for.
    leagueId,
    // Whether a red-zone row is on for this match's league, so the sheet can
    // say where an OFF game goes.
    leagueFloor,
    liveActivity,
  });
}

export async function PUT(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ error: 'sign-in required' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const { scope, scopeId } = body ?? {};
  if (!SCOPES.has(scope) || !Number.isInteger(Number(scopeId))) {
    return Response.json({ error: 'scope and scopeId required' }, { status: 400 });
  }
  // THE SAVED ROW FOR THIS EXACT SCOPE decides what the write means (R1):
  // a first master tap writes the DEFAULTS row, a master-off keeps the
  // triggers. nextRow() holds the rule; this only fetches its inputs.
  const [existing] = await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = ${scope} AND scope_id = ${Number(scopeId)}`;
  const v = nextRow(existing ?? null, body);
  // `final` is stored in the final_only column - see COLUMN_OF in prefs.js.
  await sql`
    INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
    VALUES (${userId}, ${scope}, ${Number(scopeId)}, ${v.master}, ${v.kickoff}, ${v.score},
            ${v.quarter}, ${v.close}, ${v.final})
    ON CONFLICT (user_id, scope, scope_id) DO UPDATE
      SET master = EXCLUDED.master, kickoff = EXCLUDED.kickoff, score = EXCLUDED.score,
          quarter = EXCLUDED.quarter, close = EXCLUDED.close,
          final_only = EXCLUDED.final_only, updated_at = now()`;
  return Response.json({ ok: true, prefs: { ...v, source: scope } });
}

export async function DELETE(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ error: 'sign-in required' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!SCOPES.has(body?.scope)) return Response.json({ error: 'scope required' }, { status: 400 });
  await sql`DELETE FROM alert_prefs WHERE user_id = ${userId}
             AND scope = ${body.scope} AND scope_id = ${Number(body.scopeId)}`;
  return Response.json({ ok: true });
}

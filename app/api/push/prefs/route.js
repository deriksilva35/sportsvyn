// /api/push/prefs — read and write one scope's alert preferences.
//
// A MATCH ROW EXISTS OR IT DOES NOT. There is no "inherit" value to write, so
// "reset to team defaults" is a DELETE - which is also why this route has one.

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { DEFAULTS, SELECT_FIELDS, nextRow, resolvePrefs } from '@/lib/push/prefs';

export const dynamic = 'force-dynamic';

const SCOPES = new Set(['team', 'match']);

export async function GET(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ signedIn: false, prefs: { ...DEFAULTS, source: 'default' } });

  const u = new URL(request.url);
  const matchId = Number(u.searchParams.get('matchId')) || null;
  const teamId = Number(u.searchParams.get('teamId')) || null;

  const [matchPref] = matchId ? await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'match' AND scope_id = ${matchId}` : [];
  const [teamPref] = teamId ? await sql`
    SELECT ${sql.unsafe(SELECT_FIELDS)} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'team' AND scope_id = ${teamId}` : [];
  // scope: 'match' whenever a matchId was asked for - the per-game sheet's
  // own read. With neither a saved match row nor a saved team row,
  // resolvePrefs() renders OFF rather than DEFAULTS (relay ruling: "the
  // screen may never show a push the system will not attempt").
  return Response.json({ signedIn: true, prefs: resolvePrefs({ teamPref, matchPref, scope: matchId ? 'match' : null }) });
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

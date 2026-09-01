// /api/push/prefs — read and write one scope's alert preferences.
//
// A MATCH ROW EXISTS OR IT DOES NOT. There is no "inherit" value to write, so
// "reset to team defaults" is a DELETE - which is also why this route has one.

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { DEFAULTS, resolvePrefs } from '@/lib/push/prefs';

export const dynamic = 'force-dynamic';

const SCOPES = new Set(['team', 'match']);
const FIELDS = Object.keys(DEFAULTS);

export async function GET(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ signedIn: false, prefs: { ...DEFAULTS, source: 'default' } });

  const u = new URL(request.url);
  const matchId = Number(u.searchParams.get('matchId')) || null;
  const teamId = Number(u.searchParams.get('teamId')) || null;

  const [matchPref] = matchId ? await sql`
    SELECT ${sql.unsafe(FIELDS.join(', '))} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'match' AND scope_id = ${matchId}` : [];
  const [teamPref] = teamId ? await sql`
    SELECT ${sql.unsafe(FIELDS.join(', '))} FROM alert_prefs
     WHERE user_id = ${userId} AND scope = 'team' AND scope_id = ${teamId}` : [];
  return Response.json({ signedIn: true, prefs: resolvePrefs({ teamPref, matchPref }) });
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
  const v = {};
  for (const f of FIELDS) v[f] = body[f] == null ? DEFAULTS[f] : Boolean(body[f]);
  await sql`
    INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
    VALUES (${userId}, ${scope}, ${Number(scopeId)}, ${v.master}, ${v.kickoff}, ${v.score},
            ${v.quarter}, ${v.close}, ${v.final_only})
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

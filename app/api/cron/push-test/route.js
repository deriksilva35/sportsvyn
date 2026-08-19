/**
 * POST /api/cron/push-test - one real push, THROUGH THIS RUNTIME, to an
 * owner device.
 *
 * UNDER /api/cron, NOT /api/admin, and the reason is a header collision:
 * proxy.js demands Basic auth on /api/admin/* using the SAME Authorization
 * header the Bearer check reads - a request cannot carry both. The cron
 * family's contract IS Bearer CRON_SECRET, so this lives with its auth.
 *
 * WHY IT EXISTS: the droplet proved the sender code against APNs, but the
 * cron hooks run in VERCEL, and Vercel's env spent a night dark while its
 * dashboard said otherwise. This endpoint is the missing proof link - the
 * same modules the cron path uses (apnsConfig -> sendToToken, real hook
 * copy), executed by the same runtime the hooks fire from. If this lands on
 * a lock screen, tonight's 04:00Z pair will too.
 *
 * TWO LOCKS, both required:
 *   - Bearer CRON_SECRET (cronAuthorized - the same gate every cron has)
 *   - the target user's email must be an owner address. This can NEVER be a
 *     side door for pushing a real user: the same rule, for the same reason,
 *     as the broadcast script's --to allowlist.
 *
 * Ledgered as source push / kind test with runtime:'vercel', so the ledger
 * distinguishes this proof from droplet tests and from organic events.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { apnsConfig, sendToToken, alertPayload } from '@/lib/push/apns';
import { copyFor } from '@/lib/push/copy';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const OWNER_EMAILS = [
  'deriksilva@gmail.com',
  'derik@safetymanagers.com',
  'derik@sportsvyn.com',
  'deriksilva@compsysllc.com',
  'derik@theskry.com',
];

export async function POST(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const cfg = apnsConfig();
  if (!cfg.enabled) return Response.json({ error: 'gate dark' }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const userId = Number(body?.userId);
  if (!Number.isFinite(userId)) return Response.json({ error: 'userId required' }, { status: 400 });

  const [u] = await sql`SELECT id, email, contact_email FROM users WHERE id = ${userId}`;
  const owned = u && (OWNER_EMAILS.includes(u.email) || OWNER_EMAILS.includes(u.contact_email ?? ''));
  if (!owned) return Response.json({ error: 'test pushes target owner devices only' }, { status: 403 });

  const [dev] = await sql`
    SELECT token FROM device_tokens
     WHERE user_id = ${userId} AND revoked_at IS NULL
     ORDER BY last_seen_at DESC LIMIT 1`;
  if (!dev) return Response.json({ error: 'no live token for that user' }, { status: 404 });

  const eventId = `daily-revealed:vercel-test-${body?.tag ?? 1}`;
  const copy = copyFor(eventId);

  const [row] = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    VALUES ('push', 'test', now(), true,
            ${JSON.stringify({ eventId, test: true, runtime: 'vercel', userId, outcome: 'sending' })}::jsonb)
    RETURNING id`;
  const res = await sendToToken(cfg, dev.token, alertPayload(copy));
  await sql`
    UPDATE sync_runs SET finished_at = now(), ok = ${res.ok},
           summary = ${JSON.stringify({ eventId, test: true, runtime: 'vercel', userId, outcome: res.ok ? 'sent' : 'failed', apns: res })}::jsonb
     WHERE id = ${row.id}`;

  return Response.json({ ok: res.ok, apns: res, ledger: row.id, sandbox: cfg.sandbox });
}

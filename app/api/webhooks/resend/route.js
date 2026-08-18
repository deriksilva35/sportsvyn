/**
 * POST /api/webhooks/resend — delivery feedback for everything we send.
 *
 * ============================================================================
 * WHY THIS EXISTS: "SENT" WAS NEVER "DELIVERED"
 * ============================================================================
 * The welcome-mail ledger records outcome:'sent' the moment the Resend API call
 * returns. That is ACCEPTANCE, not delivery - the message has not left their
 * queue yet. An address that hard-bounces is accepted identically and fails
 * minutes later, and until now we never heard about it.
 *
 * It mattered concretely: asked whether 22 Apple private-relay welcome sends
 * had actually landed, the honest answer was "we cannot tell" - no webhook, and
 * a send-scoped API key that 401s on GET /emails. This is that gap closed, so
 * the next time the question is asked the ledger can answer it.
 *
 * ============================================================================
 * SIGNATURE VERIFICATION IS MANDATORY AND FAILS CLOSED
 * ============================================================================
 * This endpoint is public and writes to our ledger, so an unsigned POST could
 * fabricate delivery history. Resend signs with Svix: the signed payload is
 * `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 under the webhook
 * secret with its `whsec_` prefix stripped and the remainder base64-decoded.
 *
 * VERIFIED AGAINST THE RAW BODY, not the parsed object. JSON.parse followed by
 * JSON.stringify does not round-trip byte-for-byte - key order and number
 * formatting can both move - so the text is read once and parsed only after the
 * signature holds.
 *
 * TIMESTAMP TOLERANCE of five minutes, because a signature with no freshness
 * window is replayable forever by anyone who ever saw one valid request.
 *
 * NO SECRET, NO SERVICE. If RESEND_WEBHOOK_SECRET is unset we return 503 rather
 * than accepting unverified writes. A webhook that silently trusts everything
 * when misconfigured is worse than one that is switched off.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TOLERANCE_SEC = 5 * 60;

/** Svix signature check over the raw body. Returns true only on a real match. */
function verify({ secret, id, timestamp, signature, body }) {
  if (!secret || !id || !timestamp || !signature) return false;

  // Freshness first - it is the cheap check and it bounds replay.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  // svix-signature is a space-separated list of `v1,<sig>` - a secret rotation
  // sends both old and new, so ANY match is a pass.
  for (const part of String(signature).split(' ')) {
    const sig = part.split(',')[1];
    if (!sig) continue;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, which is itself a non-match.
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

// The events worth recording. `sent` is deliberately ignored: we already write
// that ourselves at call time, and recording it twice would make the ledger
// disagree with itself about how many sends there were.
const OUTCOME = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

export async function POST(request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response('webhook not configured', { status: 503 });

  const body = await request.text();
  const ok = verify({
    secret,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
  });
  if (!ok) return new Response('bad signature', { status: 401 });

  let evt;
  try { evt = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }

  const outcome = OUTCOME[evt?.type];
  // 200 on an event we do not track: a webhook that 4xxs on an unknown type
  // gets retried forever and eventually disabled by the sender.
  if (!outcome) return Response.json({ ok: true, ignored: evt?.type ?? null });

  const messageId = evt?.data?.email_id ?? evt?.data?.id ?? null;
  const to = Array.isArray(evt?.data?.to) ? evt.data.to[0] : (evt?.data?.to ?? null);
  if (!messageId) return Response.json({ ok: true, ignored: 'no message id' });

  // A ROW PER EVENT, not an update of the send row. A message can be delayed
  // then delivered, or delivered then complained about; collapsing that into
  // one mutable field would lose the sequence, which is the part worth having.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES ('resend-webhook', ${outcome}, now(), now(),
            ${outcome !== 'bounced' && outcome !== 'complained'},
            ${JSON.stringify({ messageId, to, outcome, type: evt.type })}::jsonb)`;

  return Response.json({ ok: true, outcome, messageId });
}

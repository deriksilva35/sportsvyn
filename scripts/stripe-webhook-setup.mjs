// scripts/stripe-webhook-setup.mjs — create the TEST-MODE webhook endpoint
// pointing at the prod route, and write STRIPE_WEBHOOK_SECRET into .env.local
// WITHOUT printing it. Test events deliver to the prod URL fine. Idempotent-ish:
// if an endpoint with this URL already exists, we DON'T recreate (the signing
// secret is only returned on create) — reveal it in the Stripe Dashboard instead.
import { readFileSync, appendFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env.local', import.meta.url);
const env = readFileSync(ENV_PATH, 'utf8');
const KEY = (env.match(/^STRIPE_SECRET_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!KEY?.startsWith('sk_test_')) { console.error('REFUSE: need sk_test_ key'); process.exit(1); }

const URL_TARGET = 'https://sportsvyn.com/api/stripe/webhook';
const EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'];
const BASE = 'https://api.stripe.com/v1';
const H = { Authorization: `Bearer ${KEY}`, 'Stripe-Version': '2024-06-20' };

async function api(method, path, bodyParams) {
  const body = bodyParams
    ? bodyParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : undefined;
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...H, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body,
  });
  return { status: res.status, json: await res.json() };
}

// already present?
const list = await api('GET', '/webhook_endpoints?limit=100');
const existing = (list.json?.data ?? []).find((e) => e.url === URL_TARGET);
if (existing) {
  console.log(`webhook endpoint already exists: ${existing.id}`);
  console.log(`  url: ${existing.url}`);
  console.log(`  events: ${existing.enabled_events?.join(', ')}`);
  console.log('  NOTE: signing secret is only returned at creation. If STRIPE_WEBHOOK_SECRET');
  console.log('        is not already set, reveal it in Stripe Dashboard > Developers > Webhooks.');
  process.exit(0);
}

const body = [['url', URL_TARGET], ['api_version', '2024-06-20'], ...EVENTS.map((e) => ['enabled_events[]', e])];
const made = await api('POST', '/webhook_endpoints', body);
if (made.status >= 300) { console.error('create failed:', JSON.stringify(made.json.error)); process.exit(1); }

const secret = made.json.secret; // whsec_... — write it, never print it
if (!env.match(/^STRIPE_WEBHOOK_SECRET=/m)) {
  appendFileSync(ENV_PATH, `\nSTRIPE_WEBHOOK_SECRET=${secret}\n`);
  console.log('STRIPE_WEBHOOK_SECRET written to .env.local (value NOT printed).');
} else {
  console.log('STRIPE_WEBHOOK_SECRET already present in .env.local — left as-is.');
}
console.log(`\nwebhook endpoint created: ${made.json.id}`);
console.log(`  url: ${made.json.url}`);
console.log(`  events: ${made.json.enabled_events?.join(', ')}`);
console.log('  status:', made.json.status);
console.log('\n>>> To wire PROD: Stripe Dashboard > Developers > Webhooks > [this endpoint] >');
console.log('    "Signing secret" > Reveal, and paste it into Vercel as STRIPE_WEBHOOK_SECRET (Production).');

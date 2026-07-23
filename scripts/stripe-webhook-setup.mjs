// scripts/stripe-webhook-setup.mjs — create the webhook endpoint pointing at the
// prod route, for the 3 subscription events. Never prints a secret.
//
// TEST (default): reads STRIPE_SECRET_KEY (sk_test_). Writes the test signing
//   secret into .env.local as STRIPE_WEBHOOK_SECRET (only if not already set),
//   without printing it.
//     node scripts/stripe-webhook-setup.mjs
// LIVE (--live): reads STRIPE_LIVE_SECRET_KEY (sk_live_); LIVE banner + 5s delay.
//   Registers the same URL in live mode. Does NOT touch .env.local — the LIVE
//   signing secret must be revealed in the Stripe Dashboard (live mode) and added
//   to Vercel PRODUCTION as STRIPE_WEBHOOK_SECRET.
//     node scripts/stripe-webhook-setup.mjs --live
//
// Idempotent-ish: if an endpoint with this URL already exists (in that mode), we
// don't recreate (the signing secret is only returned at creation).
import { readFileSync, appendFileSync } from 'node:fs';

const ENV_PATH = new URL('../.env.local', import.meta.url);
const envText = readFileSync(ENV_PATH, 'utf8');
const readEnv = (name) => (envText.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');

const LIVE = process.argv.slice(2).includes('--live');

let KEY;
if (LIVE) {
  KEY = readEnv('STRIPE_LIVE_SECRET_KEY');
  if (!KEY?.startsWith('sk_live_')) { console.error('REFUSE: --live needs STRIPE_LIVE_SECRET_KEY (sk_live_) in .env.local'); process.exit(1); }
  console.log('\n============================================================');
  console.log('  !!  LIVE MODE — creating a webhook endpoint in the LIVE account');
  console.log('  Ctrl-C now to abort. Continuing in 5s...');
  console.log('============================================================\n');
  await new Promise((r) => setTimeout(r, 5000));
} else {
  KEY = readEnv('STRIPE_SECRET_KEY');
  if (!KEY?.startsWith('sk_test_')) { console.error('REFUSE: need sk_test_ STRIPE_SECRET_KEY (or pass --live)'); process.exit(1); }
}

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

// already present in this mode?
const list = await api('GET', '/webhook_endpoints?limit=100');
const existing = (list.json?.data ?? []).find((e) => e.url === URL_TARGET);
if (existing) {
  console.log(`webhook endpoint already exists (${LIVE ? 'live' : 'test'}): ${existing.id}`);
  console.log(`  url: ${existing.url}`);
  console.log(`  events: ${existing.enabled_events?.join(', ')}`);
  console.log('  NOTE: signing secret is only returned at creation. Reveal it in the Stripe');
  console.log(`        Dashboard (${LIVE ? 'LIVE' : 'TEST'} mode) > Developers > Webhooks if you need it.`);
  process.exit(0);
}

const body = [['url', URL_TARGET], ['api_version', '2024-06-20'], ...EVENTS.map((e) => ['enabled_events[]', e])];
const made = await api('POST', '/webhook_endpoints', body);
if (made.status >= 300) { console.error('create failed:', JSON.stringify(made.json.error)); process.exit(1); }

console.log(`\nwebhook endpoint created (${LIVE ? 'LIVE' : 'test'}): ${made.json.id}`);
console.log(`  url: ${made.json.url}`);
console.log(`  events: ${made.json.enabled_events?.join(', ')}`);
console.log('  status:', made.json.status);

if (LIVE) {
  // Do NOT write .env.local in live mode — the live secret belongs in Vercel Prod.
  console.log('\n>>> LIVE signing secret: Stripe Dashboard (LIVE mode) > Developers > Webhooks >');
  console.log(`    [${made.json.id}] > "Signing secret" > Reveal, then add it to Vercel as`);
  console.log('    STRIPE_WEBHOOK_SECRET in the PRODUCTION environment (not Dev/Preview).');
} else {
  const secret = made.json.secret; // whsec_... — write it, never print it
  if (!envText.match(/^STRIPE_WEBHOOK_SECRET=/m)) {
    appendFileSync(ENV_PATH, `\nSTRIPE_WEBHOOK_SECRET=${secret}\n`);
    console.log('\nSTRIPE_WEBHOOK_SECRET written to .env.local (value NOT printed).');
  } else {
    console.log('\nSTRIPE_WEBHOOK_SECRET already present in .env.local — left as-is.');
  }
}

// scripts/stripe-setup.mjs — idempotent Stripe object setup (products, prices,
// 100%-off forever coupon, promotion code). Prints the resulting price IDs
// (non-secret). Never prints a secret key.
//
// TEST (default): reads STRIPE_SECRET_KEY (must be sk_test_); promo code defaults
//   to SPORTSVYN-FULL.
//     node scripts/stripe-setup.mjs
// LIVE (--live): reads STRIPE_LIVE_SECRET_KEY (must be sk_live_); prints a LIVE
//   banner + 5s delay; --promo-code <CODE> is REQUIRED (no default in live), and
//   --max-redemptions <N> is optional. Uses the SAME lookup_keys as test —
//   critical, because runtime price resolution (lib/stripe.js resolvePriceId)
//   keys on them.
//     node scripts/stripe-setup.mjs --live --promo-code FOUNDER100 --max-redemptions 1000
//
// Idempotent in both modes: products via metadata search, prices via lookup_keys,
// coupon via fixed id, promo via code lookup — reuse if present.
import { readFileSync } from 'node:fs';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const readEnv = (name) => (envText.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const promoCodeArg = argVal('--promo-code');
const maxRedemptions = argVal('--max-redemptions');

let KEY;
let PROMO_CODE;
if (LIVE) {
  KEY = readEnv('STRIPE_LIVE_SECRET_KEY');
  if (!KEY) { console.error('REFUSE: STRIPE_LIVE_SECRET_KEY missing in .env.local'); process.exit(1); }
  if (!KEY.startsWith('sk_live_')) { console.error('REFUSE: STRIPE_LIVE_SECRET_KEY is not a live key (sk_live_)'); process.exit(1); }
  if (!promoCodeArg) { console.error('REFUSE: --live requires --promo-code <CODE> (no default in live mode)'); process.exit(1); }
  PROMO_CODE = promoCodeArg;
  console.log('\n============================================================');
  console.log('  !!  LIVE MODE — creating objects in the LIVE Stripe account');
  console.log(`  promo code: ${PROMO_CODE}${maxRedemptions ? `   max_redemptions: ${maxRedemptions}` : '   (unlimited redemptions)'}`);
  console.log('  Ctrl-C now to abort. Continuing in 5s...');
  console.log('============================================================\n');
  await new Promise((r) => setTimeout(r, 5000));
} else {
  KEY = readEnv('STRIPE_SECRET_KEY');
  if (!KEY) { console.error('REFUSE: STRIPE_SECRET_KEY missing in .env.local'); process.exit(1); }
  if (!KEY.startsWith('sk_test_')) { console.error('REFUSE: STRIPE_SECRET_KEY is not a test key (sk_test_)'); process.exit(1); }
  PROMO_CODE = promoCodeArg ?? 'SPORTSVYN-FULL';
  console.log('mode: TEST (sk_test_)');
}

const BASE = 'https://api.stripe.com/v1';
// form-encode nested params: {a:{b:1}} -> a[b]=1
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(method, path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20', // pin a stable API version
    },
    body: params ? form(params) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function ensureProduct(metaPlan, name) {
  const q = encodeURIComponent(`metadata['sportsvyn_plan']:'${metaPlan}'`);
  const found = await stripe('GET', `/products/search?query=${q}&limit=1`);
  if (found.json?.data?.length) return found.json.data[0];
  const made = await stripe('POST', '/products', { name, metadata: { sportsvyn_plan: metaPlan } });
  if (made.status >= 300) throw new Error(`product ${metaPlan}: ${JSON.stringify(made.json.error)}`);
  return made.json;
}

// interval null -> a ONE-TIME price (no recurring), for the Draft Pass.
async function ensurePrice({ lookupKey, product, unit_amount, interval }) {
  const found = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  if (found.json?.data?.length) return found.json.data[0];
  const params = {
    product, unit_amount, currency: 'usd',
    lookup_key: lookupKey, transfer_lookup_key: 'true', nickname: lookupKey,
  };
  if (interval) params.recurring = { interval };
  const made = await stripe('POST', '/prices', params);
  if (made.status >= 300) throw new Error(`price ${lookupKey}: ${JSON.stringify(made.json.error)}`);
  return made.json;
}

// Archive (never delete) a retired price by its lookup_key: set active=false.
// Idempotent — a missing or already-archived price is a no-op.
async function archivePriceByLookupKey(lookupKey) {
  const found = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  const price = found.json?.data?.[0];
  if (!price) return { lookup_key: lookupKey, archived: false, note: 'no active price' };
  const upd = await stripe('POST', `/prices/${price.id}`, { active: 'false' });
  if (upd.status >= 300) throw new Error(`archive ${lookupKey}: ${JSON.stringify(upd.json.error)}`);
  return { lookup_key: lookupKey, archived: true, id: price.id };
}

async function ensureCoupon() {
  const id = 'SPORTSVYN_FULL_FOREVER';
  const got = await stripe('GET', `/coupons/${id}`);
  if (got.status < 300) return got.json;
  const made = await stripe('POST', '/coupons', {
    id, percent_off: 100, duration: 'forever', name: 'Sportsvyn Full Access',
  });
  if (made.status >= 300) throw new Error(`coupon: ${JSON.stringify(made.json.error)}`);
  return made.json;
}

async function ensurePromoCode(couponId, code, maxRedeem) {
  const found = await stripe('GET', `/promotion_codes?code=${encodeURIComponent(code)}&limit=1`);
  if (found.json?.data?.length) return found.json.data[0];
  const params = { coupon: couponId, code };
  if (maxRedeem) params.max_redemptions = maxRedeem;
  const made = await stripe('POST', '/promotion_codes', params);
  if (made.status >= 300) throw new Error(`promo ${code}: ${JSON.stringify(made.json.error)}`);
  return made.json;
}

// --- products + prices (IDENTICAL lookup_keys across test/live) ---
// The 2026 ladder: Draft Pass (one-time) + Football Suite (annual) + Founding
// (annual, unchanged). Monthly + the old $190 annual are archived, never deleted.
const passProduct = await ensureProduct('pass', 'Sportsvyn Draft Pass');
const suiteProduct = await ensureProduct('suite', 'Sportsvyn Football Suite');
const foundingProduct = await ensureProduct('founding', 'Sportsvyn Founding Member');

const draftPass = await ensurePrice({ lookupKey: 'sportsvyn_draft_pass_2026', product: passProduct.id, unit_amount: 999, interval: null }); // one-time
const suite = await ensurePrice({ lookupKey: 'sportsvyn_suite', product: suiteProduct.id, unit_amount: 5900, interval: 'year' });
const founding = await ensurePrice({ lookupKey: 'sportsvyn_founding', product: foundingProduct.id, unit_amount: 9900, interval: 'year' });

// --- archive retired monthly + the old $190 annual (never delete) ---
const archived = [];
for (const lk of ['sportsvyn_monthly', 'sportsvyn_annual']) {
  archived.push(await archivePriceByLookupKey(lk));
}

// --- coupon + promo code ---
const coupon = await ensureCoupon();
const promo = await ensurePromoCode(coupon.id, PROMO_CODE, maxRedemptions);

console.log(`\n=== RESULT (${LIVE ? 'LIVE' : 'TEST'} — price IDs are non-secret) ===`);
console.log(JSON.stringify({
  mode: LIVE ? 'live' : 'test',
  products: { pass: passProduct.id, suite: suiteProduct.id, founding: foundingProduct.id },
  prices: {
    draft_pass: { id: draftPass.id, lookup_key: 'sportsvyn_draft_pass_2026', amount: '$9.99 one-time' },
    suite: { id: suite.id, lookup_key: 'sportsvyn_suite', amount: '$59/yr' },
    founding: { id: founding.id, lookup_key: 'sportsvyn_founding', amount: '$99/yr' },
  },
  archived,
  coupon: { id: coupon.id, percent_off: coupon.percent_off, duration: coupon.duration },
  promotion_code: { code: promo.code, id: promo.id, active: promo.active, max_redemptions: promo.max_redemptions ?? null },
}, null, 2));
console.log('\n>>> Runtime resolves prices by lookup_key (lib/stripe.js), so no code edit is');
console.log('    needed — just ensure these lookup_keys exist in whichever mode is deployed.');

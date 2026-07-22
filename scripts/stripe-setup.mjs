// scripts/stripe-setup.mjs — idempotent Stripe TEST-MODE object setup.
// Creates/reuses: products + prices (monthly $19, annual $190, founding $99/yr),
// a 100%-off forever coupon, and promotion code SPORTSVYN-FULL. Prints the
// resulting price IDs (non-secret) so they can land in lib/stripe/plans.js.
// Idempotent via price lookup_keys + a fixed coupon id + promo-code lookup.
// Never prints the secret key. Re-runnable (test AND, later, live).
//
// Run: node scripts/stripe-setup.mjs
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const KEY = (env.match(/^STRIPE_SECRET_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('STRIPE_SECRET_KEY missing in .env.local'); process.exit(1); }
if (!KEY.startsWith('sk_test_')) { console.error('REFUSE: STRIPE_SECRET_KEY is not a test key (sk_test_)'); process.exit(1); }
console.log('mode: TEST (sk_test_)');

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

async function ensurePrice({ lookupKey, product, unit_amount, interval }) {
  const found = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  if (found.json?.data?.length) return found.json.data[0];
  const made = await stripe('POST', '/prices', {
    product, unit_amount, currency: 'usd', recurring: { interval },
    lookup_key: lookupKey, transfer_lookup_key: 'true', nickname: lookupKey,
  });
  if (made.status >= 300) throw new Error(`price ${lookupKey}: ${JSON.stringify(made.json.error)}`);
  return made.json;
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

async function ensurePromoCode(couponId, code) {
  const found = await stripe('GET', `/promotion_codes?code=${encodeURIComponent(code)}&limit=1`);
  if (found.json?.data?.length) return found.json.data[0];
  const made = await stripe('POST', '/promotion_codes', { coupon: couponId, code });
  if (made.status >= 300) throw new Error(`promo ${code}: ${JSON.stringify(made.json.error)}`);
  return made.json;
}

// --- products + prices ---
const memberProduct = await ensureProduct('membership', 'Sportsvyn Membership');
const foundingProduct = await ensureProduct('founding', 'Sportsvyn Founding Member');

const monthly = await ensurePrice({ lookupKey: 'sportsvyn_monthly', product: memberProduct.id, unit_amount: 1900, interval: 'month' });
const annual = await ensurePrice({ lookupKey: 'sportsvyn_annual', product: memberProduct.id, unit_amount: 19000, interval: 'year' });
const founding = await ensurePrice({ lookupKey: 'sportsvyn_founding', product: foundingProduct.id, unit_amount: 9900, interval: 'year' });

// --- coupon + promo code ---
const coupon = await ensureCoupon();
const promo = await ensurePromoCode(coupon.id, 'SPORTSVYN-FULL');

console.log('\n=== RESULT (price IDs are non-secret) ===');
console.log(JSON.stringify({
  products: { membership: memberProduct.id, founding: foundingProduct.id },
  prices: {
    monthly: { id: monthly.id, lookup_key: 'sportsvyn_monthly', amount: '$19/mo' },
    annual: { id: annual.id, lookup_key: 'sportsvyn_annual', amount: '$190/yr' },
    founding: { id: founding.id, lookup_key: 'sportsvyn_founding', amount: '$99/yr' },
  },
  coupon: { id: coupon.id, percent_off: coupon.percent_off, duration: coupon.duration },
  promotion_code: { code: promo.code, id: promo.id, active: promo.active },
}, null, 2));
console.log('\n>>> paste these price IDs into lib/stripe/plans.js');

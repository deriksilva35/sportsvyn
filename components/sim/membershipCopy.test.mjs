// Tests for the MembershipCard content + the member-never-sees gate invariant.
// The card copy is pure data (membershipCopy.js); the gate invariant is exercised
// through canStartDraft (drafts.js), which needs DATABASE_URL at import — so we
// load .env.local first (repo test convention) and dynamic-import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMBERSHIP_PRICE_LINE, MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_TIERS } from './membershipCopy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

// ---- Variant A (draft gate) — leads with the Pass, weekly rhythm ----
test('draft variant: weekly rhythm headline, leads with the Draft Pass', () => {
  const v = MEMBERSHIP_CARD_VARIANTS.draft;
  assert.equal(v.headline, 'Three free drafts a week.');
  assert.match(v.body, /reset Monday/);
  assert.match(v.body, /Draft Pass unlocks/);
  assert.match(v.body, /Exposure Report/);
  assert.deepEqual(v.secondary, { label: 'Your drafts', href: '/sim/history' });
});

// ---- Variant B (custom config lock) — leads with the Pass (custom is sim) ----
test('custom variant: leads with the Draft Pass, secondary Back to presets (no href)', () => {
  const v = MEMBERSHIP_CARD_VARIANTS.custom;
  assert.equal(v.headline, 'Custom needs the Draft Pass.');
  assert.match(v.body, /Set your own roster slots, league size, superflex, and scoring/);
  assert.match(v.body, /Draft Pass unlocks the full console/);
  assert.equal(v.secondary.label, 'Back to presets');
  assert.equal(v.secondary.href, undefined); // uses onBackToPresets callback
});

test('price line is the three-tier ladder, hyphen-separated', () => {
  assert.equal(MEMBERSHIP_PRICE_LINE, '$9.99 Draft Pass - $59/yr Suite - $99/yr Founding');
});

test('tiers cover pass/suite/founding with taglines + features', () => {
  for (const key of ['draft_pass', 'suite', 'founding']) {
    const t = MEMBERSHIP_TIERS[key];
    assert.ok(t.tagline && t.tagline.length > 0, `${key} tagline`);
    assert.ok(Array.isArray(t.features) && t.features.length > 0, `${key} features`);
  }
  assert.match(MEMBERSHIP_TIERS.suite.features.join(' '), /Waiver Read.*Usage Board.*Watch Score/s);
});

test('no em or en dashes anywhere in the funnel copy (hyphens only)', () => {
  const strings = [MEMBERSHIP_PRICE_LINE];
  for (const v of Object.values(MEMBERSHIP_CARD_VARIANTS)) {
    strings.push(v.headline, v.body, v.secondary.label);
  }
  for (const t of Object.values(MEMBERSHIP_TIERS)) {
    strings.push(t.tagline, t.footnote, ...t.features);
  }
  for (const s of strings) {
    assert.ok(!/[—–]/.test(s), `em/en dash found in: ${s}`);
  }
});

// ---- member never sees a gate (so the card never renders for members) ----
test('members bypass the draft gate — canStartDraft(member=true) is always ok', async () => {
  const { canStartDraft } = await import('../../lib/fantasy/drafts.js');
  const gate = await canStartDraft(999999, true); // member; no DB hit on the member path
  assert.deepEqual(gate, { ok: true, member: true });
  // memberBlocked in StartForm is `isCustom && !member`, so member => never blocked;
  // freeGated derives from canStart (above) => never true for a member. Both card
  // triggers require a non-member. Server-side entitlement stays the source of truth.
});

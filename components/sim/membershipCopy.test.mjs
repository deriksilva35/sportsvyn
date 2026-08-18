// Tests for the MembershipCard content + the member-never-sees gate invariant.
// The card copy is pure data (membershipCopy.js); the gate invariant is exercised
// through canStartDraft (drafts.js), which needs DATABASE_URL at import — so we
// load .env.local first (repo test convention) and dynamic-import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEMBERSHIP_PRICE_LINE, MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_TIERS,
  MEMBERSHIP_CARD_SHELL, SHELL_LOCKED_NOTE,
} from './membershipCopy.js';

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
test('draft variant: sells what is STILL paid, not the wall that went away', () => {
  // This asserted 'Three free drafts a week.' and /reset Monday/. Both described
  // a limit that no longer exists - mocks are free and unlimited - so the card
  // has to lead with what membership actually prices instead.
  const v = MEMBERSHIP_CARD_VARIANTS.draft;
  assert.equal(v.headline, 'Custom rooms, tracker mode.');
  assert.match(v.body, /free and unlimited/);
  assert.equal(/reset Monday/.test(v.body), false, 'no weekly wall to reset');
  assert.equal(/three/i.test(v.body), false, 'and no three of anything');
  assert.match(v.body, /Draft Pass unlocks/);
  assert.match(v.body, /Exposure Report/);
  assert.deepEqual(v.secondary, { label: 'Your drafts', href: '/sim/history' });
  // The Tracker is the Pass's anchor feature and has to be named wherever the
  // Pass is pitched - this body listed six sim features without it.
  assert.match(v.body, /Draft Tracker/);
  assert.ok(v.body.indexOf('Draft Tracker') < v.body.indexOf('custom rosters'),
    'the Tracker should lead the unlock list, as it does on the /membership card');
});

// ---- Variant B (custom config lock) — leads with the Pass (custom is sim) ----
test('custom variant: leads with the Draft Pass, secondary Back to presets (no href)', () => {
  const v = MEMBERSHIP_CARD_VARIANTS.custom;
  assert.equal(v.headline, 'Custom needs the Draft Pass.');
  assert.match(v.body, /Set your own roster slots, league size, superflex, and scoring/);
  assert.match(v.body, /Draft Pass unlocks the full console/);
  assert.equal(v.secondary.label, 'Back to presets');
  assert.equal(v.secondary.href, undefined); // uses onBackToPresets callback
  // The custom lock was the worst place for the Tracker to be missing: the reader
  // is told what the Pass buys, in a sentence that never mentioned the one
  // feature they would use away from the sim.
  assert.match(v.body, /Draft Tracker/);
});

test('the Pass is never pitched without naming the Tracker', () => {
  // Applies to every variant that sells the Pass, so a fourth variant added later
  // cannot reintroduce the omission this commit fixes.
  for (const [key, v] of Object.entries(MEMBERSHIP_CARD_VARIANTS)) {
    if (!/Draft Pass/.test(v.body)) continue;
    assert.match(v.body, /Draft Tracker|Tracker mode|logs a real draft/,
      `variant "${key}" pitches the Draft Pass without naming the Tracker`);
  }
});

// ---- Variant C (tracker lock) — the room, not the feature list ----
test('tracker variant: pitches the draft table, leads with the Draft Pass', () => {
  const v = MEMBERSHIP_CARD_VARIANTS.tracker;
  assert.equal(v.headline, 'Bring it to your draft.');
  assert.match(v.body, /logs a real draft as it happens/);
  assert.match(v.body, /every team, every pick/);
  assert.match(v.body, /live ADP/);
  assert.match(v.body, /Draft Pass unlocks it/);
  assert.equal(v.secondary.label, 'Back to the sim');
  assert.equal(v.secondary.href, undefined);
});

test('tracker copy states what it does and stops - no urgency, no fear', () => {
  const { headline, body } = MEMBERSHIP_CARD_VARIANTS.tracker;
  const text = `${headline} ${body}`;
  for (const re of [
    /\bdon['\u2019]?t (get|miss|be)\b/i, /\bbefore (it|they)\b/i, /\bhurry\b/i,
    /\blast chance\b/i, /\bonly \d+\b/i, /\bnever again\b/i, /!/,
  ]) {
    assert.ok(!re.test(text), `urgency/fear pattern ${re} in tracker copy`);
  }
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

test('DRAFT PASS card: exact bullets, in order, Tracker first', () => {
  // Pinned verbatim and in sequence. Order carries the argument - the Tracker is
  // the anchor feature and the only one that leaves the house - so a reshuffle
  // should have to be deliberate, not a merge artifact.
  assert.deepEqual(MEMBERSHIP_TIERS.draft_pass.features, [
    'Draft Tracker - log your real draft live at the table',
    'Unlimited drafts',
    'Superflex and 2QB',
    '14 to 16 teams',
    'Custom rosters and scoring',
    'Full draft history',
    'The Exposure Report',
  ]);
});

test('DRAFT PASS card: the sub-line and footnote are unchanged', () => {
  assert.equal(MEMBERSHIP_TIERS.draft_pass.tagline, "For people prepping like it's a second job.");
  assert.equal(MEMBERSHIP_TIERS.draft_pass.footnote, 'Through the Super Bowl.');
});

// ---- SHELL GUARD ----------------------------------------------------------
// The gate cards have shell-suppressed variants (App Store 3.1.1, commit
// 76e18e0). Web copy and shell copy live in the same file, one export apart, so
// the realistic failure is a web edit drifting into the shell object - which
// would put a plan name or a feature pitch back inside the app. The bodies below
// are pinned verbatim: this commit changed web copy only, and shell output is
// byte-identical to what shipped.
test('SHELL copy is byte-identical - a web copy edit must not reach the app', () => {
  assert.deepEqual(MEMBERSHIP_CARD_SHELL, {
    draft: {
      // DELIBERATELY CHANGED. This test exists so a web copy edit cannot reach
      // the app by accident; the app's copy moved here on purpose, because the
      // three-a-week wall it described is gone.
      headline: 'Custom rooms, tracker mode.',
      body: 'Mock drafts are free and unlimited. Custom rosters, 14 to 16 teams, superflex and tracker mode are part of the Sportsvyn membership. Members sign in and it unlocks.',
    },
    custom: {
      headline: 'Custom is a membership feature.',
      body: 'Your own roster slots, league size, superflex, and scoring are part of the Sportsvyn membership. Members sign in and it unlocks. Free accounts draft the presets.',
    },
    tracker: {
      headline: 'Tracker mode is a membership feature.',
      body: 'Tracker mode logs a real draft as it happens - every team, every pick, on your phone at the table. It is part of the Sportsvyn membership. Members sign in and it unlocks.',
    },
  });
  assert.equal(SHELL_LOCKED_NOTE, 'Part of the Sportsvyn membership. Members sign in and it unlocks.');
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

// ---------------------------------------------------------------------------
// NO "THREE FREE DRAFTS" ANYWHERE
// ---------------------------------------------------------------------------
// The wall is gone for the 2026 season and the copy has to go with it. A
// surface still promising three a week is worse than one promising nothing:
// it caps a product that is not capped, and it is the first thing a new user
// reads on the sim's own pitch.

test('NO SHIPPED SURFACE STILL SELLS A THREE-DRAFT LIMIT', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  const walk = (dir, out = []) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f === 'node_modules' || f === '.next' || f === '.git') continue;
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(js|jsx|md)$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
  };

  const BANNED = [
    /three free drafts/i,
    /3 free drafts/i,
    /free drafts for the week/i,
    /\bof 3 free\b/i,
  ];
  const hits = [];
  for (const dir of ['app', 'components', 'lib']) {
    for (const file of walk(path.join(REPO, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const re of BANNED) {
        if (re.test(text)) hits.push(`${path.relative(REPO, file)} :: ${re}`);
      }
    }
  }
  assert.deepEqual(hits, [], `copy still sells a limit that no longer exists:\n${hits.join('\n')}`);
});

test('the constant says unlimited, and the gate agrees', async () => {
  const { FREE_DRAFT_LIMIT, canStartDraft } = await import('../../lib/fantasy/drafts.js');
  assert.equal(FREE_DRAFT_LIMIT, 0, '0 = no limit');
  const gate = await canStartDraft(999999, true);
  assert.equal(gate.ok, true);
});

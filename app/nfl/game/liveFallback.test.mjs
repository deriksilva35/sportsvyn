// app/nfl/game/liveFallback.test.mjs - a LIVE game with nothing behind a tab
// yet prints no pre-game copy, on both gridiron game pages. RENDERED, with the
// real reader against DEV sentinels (no plays, no line), so what is asserted
// is the page a reader would get in the minutes before the first plays land.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

install();
const S = {
  link: stubPath('__lf_link.mjs'), nav: stubPath('__lf_nav.mjs'), css: stubPath('__lf_css.mjs'),
  header: stubPath('__lf_header.mjs'), auth: stubPath('__lf_auth.mjs'), follows: stubPath('__lf_follows.mjs'),
  shell: stubPath('__lf_shell.mjs'), bell: stubPath('__lf_bell.mjs'), actions: stubPath('__lf_actions.mjs'),
};
writeFileSync(S.link, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
writeFileSync(S.nav, "export function notFound() { throw new Error('notFound'); } export function redirect(u) { throw new Error('redirect ' + u); } export function useRouter() { return { refresh() {}, push() {} }; } export function usePathname() { return '/'; } export function useSearchParams() { return new URLSearchParams(); }\n");
writeFileSync(S.css, 'export default {};\n');
writeFileSync(S.header, 'export default function GlobalHeaderServer() { return null; }\n');
writeFileSync(S.auth, 'export async function auth() { return null; }\n');
writeFileSync(S.follows, 'export async function getFollowedTeamIds() { return new Set(); }\n');
writeFileSync(S.shell, "export async function resolveShellMode() { return { isShell: false }; } export function isShellRequest() { return false; }\n");
writeFileSync(S.bell, 'export default function AlertBell() { return null; }\n');
writeFileSync(S.actions, 'export async function followTeam() { return { ok: true }; } export async function unfollowTeam() { return { ok: true }; }\n');
registerHooks({ resolve(spec, ctx, next) {
  const to = (p) => ({ url: pathToFileURL(p).href, shortCircuit: true });
  if (spec === 'next/link') return to(S.link);
  if (spec === 'next/navigation') return to(S.nav);
  if (spec.endsWith('.css')) return to(S.css);
  if (spec.endsWith('components/GlobalHeaderServer')) return to(S.header);
  if (spec === '@/auth') return to(S.auth);
  if (spec.endsWith('lib/follows')) return to(S.follows);
  if (spec.endsWith('lib/shell/shell')) return to(S.shell);
  if (spec.endsWith('components/alerts/AlertBell')) return to(S.bell);
  if (spec === '@/app/actions/follows') return to(S.actions);
  return next(spec, ctx);
} });

const { sql } = await import('../../../lib/db.js');
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const NS = `sentinel-live-fallback-${process.pid}-${Date.now()}`;
const ids = [];

async function seed(league, status) {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = ${league}`;
  const t = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} AND name IS NOT NULL ORDER BY id LIMIT 2`;
  const slug = `${NS}-${league}-${status}`;
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${slug}, ${status}, ${t[0].id}, ${t[1].id}, now() - interval '6 minutes',
            ${status === 'scheduled' ? null : 0}, ${status === 'scheduled' ? null : 0}, 2026, 'REG', 4, '{}'::jsonb,
            ${JSON.stringify(status === 'live' ? { live_state: { period: 1, clock: '13:40' } } : {})}::jsonb)
    RETURNING id`;
  ids.push(m.id);
  return slug;
}

const page = async (league) => (await import(`../../../app/${league}/game/[slug]/page.js`)).default;
const render = async (league, slug) =>
  renderToStaticMarkup(await (await page(league))({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));

const slugs = {};
before(async () => {
  slugs.nflLive = await seed('nfl', 'live');
  slugs.nflPre = await seed('nfl', 'scheduled');
  slugs.cfbLive = await seed('cfb', 'live');
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${ids})`;
  const [left] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${NS}%`}`;
  assert.equal(left.n, 0, 'the sentinels are gone');
  for (const f of Object.values(S)) { try { unlinkSync(f); } catch { /* gone */ } }
});

test('NFL, LIVE, no panels yet: one muted line, and no pre-game copy', async () => {
  const h = await render('nfl', slugs.nflLive);
  assert.match(h, /<p class="gg-note gg-note-live" data-fallback="live">Drives and scoring appear as plays arrive\.<\/p>/);
  assert.doesNotMatch(h, /KICKOFF/, 'no pre-game facts heading');
  assert.doesNotMatch(h, /land once the game is played/);
});

test('NFL, SCHEDULED: the pre-game facts, as before', async () => {
  const h = await render('nfl', slugs.nflPre);
  assert.match(h, /<h2>KICKOFF<\/h2>/);
  assert.match(h, /Scoring summary and player lines land once the game is played\./);
  assert.doesNotMatch(h, /data-fallback="live"/);
});

test('CFB, LIVE, no plays yet: the same line in the drives panel, and the facts are DETAILS, not KICKOFF', async () => {
  const h = await render('cfb', slugs.cfbLive);
  assert.match(h, /Drives and scoring appear as plays arrive\./);
  assert.doesNotMatch(h, /Drive chart appears once the game kicks off/);
  assert.doesNotMatch(h, /<h2>KICKOFF<\/h2>/);
  assert.match(h, /<h2>DETAILS<\/h2>/);
});

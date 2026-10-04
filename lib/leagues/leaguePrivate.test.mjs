// lib/leagues/leaguePrivate.test.mjs - private leagues show NOTHING to a
// non-member, not even the name (ruling sun-12 item 8). RENDERED, on DEV.
//
// The page, its metadata and its 404 boundary run for real against a real
// league; only auth, the shell cookie, the header/footer and the member board
// are stubbed. Four readers:
//   signed out       -> notFound(); metadata generic; the 404 body has no name
//   signed-in outsider -> the same, with "This league is private"
//   a member         -> the board and a titled tab
//   an invite holder -> /j/<code> names the league (holding it IS the invite)
// and an id that was never issued must be indistinguishable from "not yours".
//
// Fixture: two SENTINEL users (@example.invalid, swept by
// scripts/dev-orphan-sweep.mjs if a killed run leaves them) and the owner's
// one league. after() removes all of it and asserts it did.
//
// IT LIVES IN lib/, NOT NEXT TO THE PAGE, ON PURPOSE: the suite is
// `node --test $(git ls-files '*.test.mjs')`, and node --test reads each
// argument as a GLOB - a path through app/leagues/[id]/ matches nothing, so a
// test there would pass by never running.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../testing/nextResolve.mjs';
import { stubPath } from '../testing/stubDir.mjs';

install();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const F = (n) => stubPath(`__lgpriv_${n}.mjs`);
const NAMES = ['link', 'auth', 'hdr', 'foot', 'shell', 'signedOut', 'nav', 'table', 'board', 'actions', 'inviteJoin'];
const MAP = {
  'next/link': 'link', '@/auth': 'auth',
  '@/components/GlobalHeaderServer': 'hdr', '@/components/SiteFooter': 'foot',
  '@/lib/shell/shell': 'shell', '@/lib/shell/signedOut': 'signedOut',
  'next/navigation': 'nav', '@/lib/leagues/table': 'table',
  '@/components/leagues/LeagueBoard': 'board', '@/app/actions/leagues': 'actions',
  '@/components/leagues/InviteJoin': 'inviteJoin',
};
registerHooks({ resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: pathToFileURL(F(MAP[spec])).href, shortCircuit: true };
  return next(spec, ctx);
} });

const NS = `lgpriv-${process.pid}-${Date.now()}`;
// Distinctive enough that finding it in HTML can only mean the league leaked.
const NAME = `Sealed ${process.pid % 100000}x${Date.now() % 100000}`;
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';

let sql, core, owner, outsider, league, authStub, navStub;
let renderToStaticMarkup, Page, generateMetadata, NotFound, inviteMeta;

before(async () => {
  writeFileSync(F('link'), "import React from 'react'; export default function Link({href,children,...r}){return React.createElement('a',{...r,href:String(href)},children);}\n");
  writeFileSync(F('auth'), 'export let uid = null;\nexport function setUid(v){uid=v;}\nexport async function auth(){return uid==null?null:{user:{id:String(uid)}};}\n');
  writeFileSync(F('hdr'), 'export default function H(){return null;}\n');
  writeFileSync(F('foot'), 'export default function F(){return null;}\n');
  writeFileSync(F('shell'), 'export async function resolveShellMode(){return false;}\nexport function simViewport(){return {};}\n');
  writeFileSync(F('signedOut'), 'export function requireSignInInShell(){}\n');
  writeFileSync(F('nav'), [
    `export function notFound(){ const e = new Error(${JSON.stringify(NOT_FOUND)}); e.digest = ${JSON.stringify(NOT_FOUND)}; throw e; }`,
    'export let path = "/leagues";', 'export function setPath(p){ path = p; }',
    'export function usePathname(){ return path; }',
    'export function useSearchParams(){ return new URLSearchParams(); }',
    'export function useRouter(){ return { push(){}, replace(){}, refresh(){} }; }',
    'export function redirect(u){ throw new Error("redirect " + u); }',
  ].join('\n') + '\n');
  writeFileSync(F('table'), 'export async function leagueTable(){ return { rows: [] }; }\n');
  writeFileSync(F('board'), "import React from 'react'; export default function B({league}){ return React.createElement('section',{'data-member-board':'1'}, league.name); }\n");
  writeFileSync(F('actions'), 'export async function joinLeagueAction(){ return { ok: false }; }\nexport async function joinInviteAction(){ return { ok: false }; }\n');
  writeFileSync(F('inviteJoin'), "import React from 'react'; export default function I(){ return React.createElement('button',null,'Join'); }\n");

  ({ sql } = await import('../db.js'));
  core = await import('./core.js');
  [owner] = await sql`INSERT INTO users (email) VALUES (${`${NS}-owner@example.invalid`}) RETURNING id`;
  [outsider] = await sql`INSERT INTO users (email) VALUES (${`${NS}-outsider@example.invalid`}) RETURNING id`;
  league = await core.createLeague(owner.id, NAME);
  assert.equal(league.ok, true, 'fixture league created');

  ({ renderToStaticMarkup } = await import('react-dom/server'));
  authStub = await import(pathToFileURL(F('auth')).href);
  navStub = await import(pathToFileURL(F('nav')).href);
  const page = await import('../../app/leagues/[id]/page.js');
  Page = page.default; generateMetadata = page.generateMetadata;
  NotFound = (await import('../../app/leagues/[id]/not-found.js')).default;
  inviteMeta = (await import('../../app/j/[code]/page.js')).generateMetadata;
});

after(async () => {
  for (const n of NAMES) { try { unlinkSync(F(n)); } catch { /* gone */ } }
  if (!sql) return;
  if (league?.leagueId) {
    await sql`DELETE FROM player_league_games WHERE league_id = ${league.leagueId}`;
    await sql`DELETE FROM league_members WHERE league_id = ${league.leagueId}`;
    await sql`DELETE FROM player_leagues WHERE id = ${league.leagueId}`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM player_leagues WHERE id = ${league?.leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

const P = (id) => ({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) });
const as = (uid) => authStub.setUid(uid == null ? null : uid);
const GHOST = 2_000_000_000; // an id that was never issued

async function pageOutcome(id) {
  try {
    return { html: renderToStaticMarkup(await Page(P(id))) };
  } catch (e) {
    if (e?.digest === NOT_FOUND) return { notFound: true };
    throw e;
  }
}
async function notFoundHtml(id) {
  navStub.setPath(`/leagues/${id}`);
  return renderToStaticMarkup(await NotFound());
}

test('SIGNED OUT: a 404 with a sign-in prompt - no name in the HTML or the metadata', async () => {
  as(null);
  assert.deepEqual(await pageOutcome(league.leagueId), { notFound: true }, 'the page must call notFound()');
  const meta = await generateMetadata(P(league.leagueId));
  assert.equal(meta.title, 'Leagues - Sportsvyn');
  assert.deepEqual(meta.robots, { index: false, follow: false });
  assert.ok(!JSON.stringify(meta).includes(NAME), 'metadata names the league');
  const html = await notFoundHtml(league.leagueId);
  assert.ok(!html.includes(NAME), 'the 404 body names the league');
  assert.match(html, /Sign in to see this league/);
  assert.match(html, new RegExp(`href="/signin\\?callbackUrl=${encodeURIComponent(`/leagues/${league.leagueId}`)}"`),
    'sign-in comes back to this league');
  assert.doesNotMatch(html, /This league is private/);
});

test('SIGNED-IN NON-MEMBER: "This league is private" + the invite hint, and nothing else', async () => {
  as(outsider.id);
  assert.deepEqual(await pageOutcome(league.leagueId), { notFound: true });
  const meta = await generateMetadata(P(league.leagueId));
  assert.equal(meta.title, 'Leagues - Sportsvyn');
  assert.ok(!JSON.stringify(meta).includes(NAME));
  const html = await notFoundHtml(league.leagueId);
  assert.ok(!html.includes(NAME));
  assert.match(html, /This league is private/);
  assert.match(html, /Got an invite\? Open the link a member sent you, or enter its code here\./);
  assert.match(html, /aria-label="Invite code"/, 'the code field is the way in');
  assert.doesNotMatch(html, /member(s)? &middot;|\d+ members?/, 'no member count');
});

test('A NON-MEMBER CANNOT TELL "not yours" FROM "no such league" - same 404, same body', async () => {
  for (const uid of [null, outsider.id]) {
    as(uid);
    assert.deepEqual(await pageOutcome(GHOST), { notFound: true });
    assert.equal((await generateMetadata(P(GHOST))).title, (await generateMetadata(P(league.leagueId))).title);
    const real = (await notFoundHtml(league.leagueId)).replaceAll(String(league.leagueId), 'ID');
    const ghost = (await notFoundHtml(GHOST)).replaceAll(String(GHOST), 'ID');
    assert.equal(ghost, real, `uid=${uid}: the 404 body differs between a real and an unissued id`);
  }
});

test('A MEMBER sees the league, and the tab carries its name', async () => {
  as(owner.id);
  const out = await pageOutcome(league.leagueId);
  assert.ok(out.html, 'a member is not 404d');
  assert.match(out.html, /data-member-board="1"/);
  assert.ok(out.html.includes(NAME));
  const meta = await generateMetadata(P(league.leagueId));
  assert.equal(meta.title, `${NAME} - Leagues - Sportsvyn`);
});

test('AN INVITE CODE shows the name - /j/<code> is the invitation, signed out or not', async () => {
  for (const uid of [null, outsider.id]) {
    as(uid);
    const meta = await inviteMeta({ params: Promise.resolve({ code: league.joinCode }) });
    assert.equal(meta.title, `Join ${NAME} - Sportsvyn`);
    assert.equal(meta.openGraph.title, `Join ${NAME}`);
  }
  const { invitePreview } = await import('./invite.js');
  assert.equal((await invitePreview(league.joinCode)).league.name, NAME);
  assert.equal((await invitePreview('ZZZZZZ')).league, null, 'a wrong code names nothing');
});

test('nothing reads a league for a non-member: no leaguePreview, and the 404 boundary takes no data', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = (rel) => strip(readFileSync(path.join(REPO, rel), 'utf8'));
  for (const rel of ['lib/leagues/core.js', 'app/leagues/[id]/page.js', 'app/leagues/[id]/not-found.js']) {
    assert.doesNotMatch(src(rel), /leaguePreview/, `${rel} must not read a league for a non-member`);
  }
  const nf = src('app/leagues/[id]/not-found.js');
  assert.doesNotMatch(nf, /@\/lib\/leagues\/core|sql`|params/, 'the 404 body reads no league');
  const page = src('app/leagues/[id]/page.js');
  assert.match(page, /if \(!league\) notFound\(\);/);
  assert.doesNotMatch(page, /opengraph|openGraph/);
});

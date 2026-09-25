// components/rankings/rankings.test.mjs - the Rankings tab, pressed.
// Every view signed in and out, the follow cap, the you row, the CFB
// sub-line's threshold, the search, and the two source guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const L = stubPath('__l_rk.mjs');
const N = stubPath('__n_rk.mjs');
const C = stubPath('__c_rk.mjs');
const A = stubPath('__a_rk.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(L).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(N).href, shortCircuit: true };
  if (spec === '@/app/actions/follows') return { url: pathToFileURL(A).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(C).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, Rankings, AllTeams;
before(async () => {
  writeFileSync(L, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(N, "export function usePathname(){ return '/rankings'; } export function useRouter(){ return { refresh(){}, push(){} }; }\n");
  writeFileSync(C, 'export default {};\n');
  writeFileSync(A, "export const calls = []; export async function followTeam(id){ calls.push(['follow', id]); return globalThis.__followReply ?? { ok: true }; } export async function unfollowTeam(id){ calls.push(['unfollow', id]); return { ok: true }; }\n");
  React = await import('react');
  ({ renderToStaticMarkup: render } = await import('react-dom/server'));
  Rankings = (await import('./Rankings.js')).default;
  AllTeams = (await import('./AllTeams.js')).default;
});
after(() => { for (const f of [L, N, C, A]) { try { unlinkSync(f); } catch { /* gone */ } } });

const team = (id, ab, name = ab) => ({ teamId: id, abbreviation: ab, name, fullName: name, colors: { primary: '#111', secondary: '#eee' } });
const base = (over = {}) => ({
  league: 'nfl', view: 'teams', stat: 'pass', game: 'all', week: 2, phase: 'REG',
  seasonYear: 2026, signedIn: true, followed: new Set([3]),
  eyebrow: 'Sunday · Week 2',
  teams: {
    kind: 'nfl',
    power: [{ ...team(1, 'PHI', 'Eagles'), rank: 1, score: 92.4 }, { ...team(3, 'DET', 'Lions'), rank: 2, score: 89.7 }],
    division: { group: 'AFC EAST', isCfb: false, rows: [{ teamId: 9, name: 'Bills', abbreviation: 'BUF', colors: {}, overall: '1-0', conf: null }], groups: ['AFC EAST'] },
  },
  ...over,
});
const cfb = (over = {}) => base({
  league: 'cfb',
  teams: {
    kind: 'cfb',
    ap: { season: 2026, week: 3, rows: [{ ...team(1, 'OSU', 'Ohio State'), rank: 1, points: 1512, firstPlaceVotes: 40 }] },
    ours: [
      { ...team(4, 'MISS', 'Ole Miss'), rank: 4, score: 88.2, vsAp: { apRank: 9, higher: true, text: 'AP 9 · we have them higher' } },
      { ...team(1, 'OSU', 'Ohio State'), rank: 1, score: 94.1, vsAp: null },
    ],
    conference: { group: 'SEC', isCfb: true, rows: [{ teamId: 4, name: 'Ole Miss', abbreviation: 'MISS', colors: {}, overall: '2-0', conf: '1-0' }], groups: ['SEC'] },
  },
  ...over,
});
const html = (v) => render(React.createElement(Rankings, { v }));
const mods = (h) => [...h.matchAll(/data-module="([a-z]+)"/g)].map((m) => m[1]);

test('TEAMS / NFL renders signed in and out; the ring is the only difference', () => {
  const inn = html(base());
  assert.deepEqual(mods(inn), ['power', 'group', 'yours']);
  assert.match(inn, /<a class="rk-pill on" href="\/rankings">NFL<\/a>/);
  assert.match(inn, /rk-mark fol/, 'a followed team wears the ring');
  const out = html(base({ signedIn: false, followed: new Set() }));
  assert.deepEqual(mods(out), ['power', 'group'], 'no your-teams module signed out');
  assert.equal(/rk-mark fol/.test(out), false, 'and no ring');
  // R3: no movement column anywhere.
  for (const h of [inn, out]) assert.equal(/▲|▼/.test(h), false, 'no movement glyph');
});

test('TEAMS / CFB: AP, OUR TOP 25 and the conference, with CONF and OVR', () => {
  const h = html(cfb());
  assert.deepEqual(mods(h), ['ap', 'ours', 'group', 'yours']);
  assert.match(h, /AP Top 25 · Week 3/);
  assert.match(h, /1,512/, 'points, formatted');
  // THE BOARD IS COMPUTED NOW, and it says so where it used to say editorial.
  assert.match(h, /SPORTSVYN POWER/); assert.match(h, /computed/);
  assert.equal(/Our Top 25|editorial, not the poll/.test(h), false, 'the editorial label is gone with the editorial board');
  assert.match(h, /<div class="rk-cols"><span>CONF<\/span><span>OVR<\/span><\/div>/);
  // R1 STILL HOLDS FOR THE AP MODULE: one poll week, so no movement on it and
  // no NEW badge or dropped-out line anywhere.
  // THE BADGE IS MATCHED AS RENDERED TEXT, not as the word anywhere in the
  // markup - a movement cell for a row with no previous edition carries
  // class="rk-mv new", which a case-insensitive /NEW/ matched and which is
  // not a NEW badge at all.
  assert.equal(/>NEW</.test(h), false, 'no NEW badge');
  assert.equal(/dropped out/i.test(h), false);
  const ap = h.slice(h.indexOf('data-module="ap"'), h.indexOf('data-module="ours"'));
  assert.equal(/▲|▼/.test(ap), false, 'the AP module has no movement column');
  // The All-138 link hangs off the conference module, NOT off Our Top 25.
  const ours = h.slice(h.indexOf('data-module="ours"'), h.indexOf('data-module="group"'));
  assert.equal(/All 138/.test(ours), false, 'Our Top 25 is a ranking, not a directory');
  assert.match(h.slice(h.indexOf('data-module="group"')), /\/rankings\/teams\?league=cfb/);
});

test('the CFB sub-line appears only at a three-or-more gap', () => {
  const h = html(cfb());
  assert.match(h, /AP 9 · we have them higher/);
  assert.equal((h.match(/we have them/g) ?? []).length, 1, 'the row with no gap carries no sub-line');
});

test('PLAYERS renders both codes; CFB gets TD leaders and no fantasy module', () => {
  const p = (over) => html(base({ view: 'players', players: { stat: 'pass', season: [{ name: 'Brock Purdy', abbreviation: 'SF', games: 1, value: 205, colors: {} }], week: [{ key: 'pass', label: 'PASSING', name: 'Purdy', abbr: 'SF', yards: 205 }], td: null, fantasy: [{ name: 'Puka Nacua', abbreviation: 'LAR', games: 1, value: 12.4, colors: {}, mine: true }] }, ...over }));
  const nfl = p({});
  assert.deepEqual(mods(nfl), ['season', 'fantasy', 'week']);
  assert.match(nfl, /in your six/); assert.match(nfl, /rk-mark fol/);
  assert.match(nfl, /data-toggle="stat"/);
  const c = html(base({ league: 'cfb', view: 'players', players: { stat: 'pass', season: [{ name: 'Carson Beck', abbreviation: 'MIA', games: 2, value: 644, colors: {} }], week: [], td: [{ name: 'CJ Baxter', abbreviation: 'TEX', games: 2, value: 5, colors: {} }], fantasy: null } }));
  assert.deepEqual(mods(c), ['season', 'td']);
  assert.match(c, /TD leaders/);
  // R5, and the note the mock carried for Derik is not shipped to a reader.
  assert.equal(/Golden Boot/i.test(c), false);
  assert.equal(/No fantasy module/i.test(c), false);
});

test('PEOPLE: the you row appears for a user with any entry, with the distance', () => {
  const v = base({
    view: 'people',
    people: {
      game: 'all',
      mods: [{
        key: 'pickem', title: "Pick'em · correct %", sub: 'NFL + CFB · min 3 boards',
        rows: [{ rank: 1, name: '@packerAJ01', sub: '3 boards · 41-14', value: '74.5%', you: false }],
        self: { rank: null, name: '@sportsvyn_og', sub: '2 boards · 8-1 · ranks after 1 more', value: '88.9%', you: true },
        href: '/games?pane=boards',
      }],
      seat: { seats: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, drafters: 0, avg: null, you: i === 6 })), mySeat: 7, minDrafters: 3, note: 'No settled drafts yet.' },
    },
  });
  const h = html(v);
  assert.deepEqual(mods(h), ['pickem', 'seat']);
  assert.match(h, /data-pills="games"/, 'People swaps leagues for games');
  const you = h.match(/<div class="rk-row you"[\s\S]*?<\/div>(?=<|$)/);
  assert.ok(you, 'the you row renders');
  assert.match(h, /<b class="rk-you">YOU<\/b>/);
  assert.match(h, /ranks after 1 more/);
  assert.match(h, /<span class="rnk-n">–<\/span>/, 'an unranked you row shows a dash');
  // The seat grid: twelve cells, dashes, the caller's outlined.
  assert.equal((h.match(/data-seat="\d+"/g) ?? []).length, 12);
  assert.match(h, /class="you none" data-seat="7"/);
});

test('THE YOU ROW IS ONE COMPONENT, used on every view', () => {
  const s = src('components/rankings/RankRow.js');
  assert.match(s, /you \? ' you' : ''/);
  assert.match(s, /<b className="rk-you">YOU<\/b>/);
  assert.match(s, /rank \?\? '–'/, 'the rank column is a dash when it is unknown');
  // AND IT IS .rnk-n, NEVER .rk - gridiron.css owns a bare .rk (the AP badge)
  // and every page under /rankings loads it.
  assert.match(s, /className="rnk-n"/);
  assert.equal(/className="rk"/.test(s), false);
  const css = src('components/rankings/rankings.css');
  assert.match(css, /\.rk-row\.you \{[^}]*border-left: 3px solid var\(--volt\)/);
  // Nothing else draws a you row.
  const others = ['components/rankings/Rankings.js', 'components/rankings/AllTeams.js'];
  for (const f of others) assert.equal(/rk-you/.test(src(f)), false, `${f} must not redraw the you pill`);
});

// ---------------------------------------------------------------- the list

const T = (id, name, group, ap = null, power = null) => ({ id, name, fullName: name, abbreviation: name.slice(0, 3).toUpperCase(), colors: {}, group, record: '2-0', apRank: ap, powerRank: power });
const TEAMS = [T(1, 'Ole Miss', 'SEC', 9, 6), T(2, 'Toledo', 'MAC'), T(3, 'Old Dominion', 'Sun Belt'), T(4, 'Miami', 'ACC', 7, 2)];
const list = (over = {}) => render(React.createElement(AllTeams, {
  league: 'cfb', label: 'CFB', teams: TEAMS, initialFollowed: [1], signedIn: true, signinHref: '/signin', ...over,
}));

test('the list groups by conference, ranks by POWER where one exists, and offers Follow on every row', () => {
  const h = list();
  assert.match(h, /<h1 class="rk-h1">All 4<\/h1>/);
  assert.match(h, /data-module="groups"/);
  assert.match(h, /ACC · 1/); assert.match(h, /SEC · 1/);
  assert.equal((h.match(/class="rk-fol/g) ?? []).length, 4, 'a button on every row');
  assert.match(h, /<button type="button" class="rk-fol on" aria-pressed="true"/, 'a followed team reads Following');
  // THE LEFT COLUMN IS THE POWER RANK NOW. R2 put the AP rank there because
  // no 138-team power ranking existed; one does, so the poll moves to the
  // sub-line and the spine of the list is our own order.
  assert.match(h, /<span class="rnk-n">6<\/span>/, 'Ole Miss is power 6');
  assert.match(h, /<span class="rnk-n">2<\/span>/, 'Miami is power 2');
  assert.match(h, /<span class="rnk-n">–<\/span>/, 'an unrated team still shows a dash');
  // AND THE AP RANK IS IN THE SUB-LINE, only where the poll ranks the team.
  assert.match(h, /SEC · 2-0 · AP 9/);
  assert.match(h, /ACC · 2-0 · AP 7/);
  assert.match(h, /MAC · 2-0</, 'an unranked team\'s sub-line does not mention a poll at all');
  assert.equal((h.match(/AP \d/g) ?? []).length, 2, 'two ranked teams, two AP mentions');
});

test('signed out, the button is a sign-in link and never a button', () => {
  const h = list({ signedIn: false, initialFollowed: [] });
  assert.equal(/<button[^>]*class="rk-fol/.test(h), false);
  assert.equal((h.match(/<a class="rk-fol" href="\/signin">Follow<\/a>/g) ?? []).length, 4);
});

test('THE FOLLOW CAP IS THE SERVER\'S, and the refusal names it', () => {
  const s = src('app/actions/follows.js');
  // THE CONSTANT MAY NOT LIVE IN THE ACTION FILE. A 'use server' module may
  // export only async functions; a plain export there drops every export in
  // the file and fails the production build. This pins the split that bug
  // cost.
  assert.match(src('lib/follows.js'), /export const FOLLOW_CAP_PER_LEAGUE = 5;/);
  assert.equal(/export const /.test(s), false, "'use server' exports async functions only");
  assert.match(s, /import \{ FOLLOW_CAP_PER_LEAGUE \} from '@\/lib\/follows'/);
  assert.match(s, /reason: 'cap_reached'/);
  assert.match(s, /cap: FOLLOW_CAP_PER_LEAGUE, league: team\.league_slug/);
  // Counted per league, and never against a team already followed.
  assert.match(s, /AND t\.league_id = \$\{team\.league_id\}/);
  assert.match(s, /AND f\.team_id <> \$\{teamId\}/);
  // The list sends the sixth and reports what comes back; it does not
  // pre-empt the server with a client-side count.
  const c = src('components/rankings/AllTeams.js');
  assert.match(c, /r\?\.reason === 'cap_reached'/);
  assert.match(c, /You can follow \$\{r\.cap\} \$\{label\} teams/);
  assert.equal(/followed\.size >= 5|length >= 5/.test(c), false, 'no client-side cap');
});

test('the search filters on name AND abbreviation', () => {
  const c = src('components/rankings/AllTeams.js');
  assert.match(c, /const hay = \(t\) => `\$\{t\.name\} \$\{t\.fullName \?\? ''\} \$\{t\.abbreviation \?\? ''\}`\.toLowerCase\(\)/);
  assert.match(c, /teams\.filter\(\(t\) => hay\(t\)\.includes\(needle\)\)/);
  assert.match(c, /type="search"/);
});

// --------------------------------------------------------------- guards

test('SOURCE GUARD: the AP module is the only 25-row module', () => {
  const s = src('components/rankings/Rankings.js');
  // Our Top 25 is asked for five rows by the reader, not twenty-five.
  assert.match(src('lib/rankings/view.js'), /ourTop25\(\{ limit: 5 \}\)/);
  assert.match(src('lib/rankings/view.js'), /nflPower\(\{ limit: 8 \}\)/);
  // and the AP module maps its rows whole
  assert.match(s, /t\.ap\.rows\.map/);
  assert.match(src('lib/rankings/reads.js'), /export async function apTop25\(\{ limit = 25 \} = \{\}\)/);
});

test('A MOVEMENT GLYPH IFF previous_rank IS SET - both directions, rendered', () => {
  // THE GUARD THAT REPLACED "NO MOVEMENT ANYWHERE". The old rule was right for
  // a board with one edition and is wrong for one with two; what has to stay
  // true is that a glyph is drawn from previous_rank and never from anything
  // else - a row that was not on the last edition has no arrow to draw.
  const power = (over) => ({ ...team(1, 'PHI', 'Eagles'), rank: 1, score: 8.5, ...over });

  // NEW: previousRank null. No arrow, whatever rankMovement says.
  const isNew = html(base({ teams: { ...base().teams, power: [power({ previousRank: null, rankMovement: 3 })] } }));
  assert.equal(/▲|▼/.test(isNew), false, 'a row with no previous rank draws no arrow');
  assert.match(isNew, /class="rk-mv new"/);

  // UP, DOWN and HOLD all require previousRank, and all render distinctly.
  const up = html(base({ teams: { ...base().teams, power: [power({ previousRank: 4, rankMovement: 3 })] } }));
  assert.match(up, /class="rk-mv up"[^>]*aria-label="up 3"[^>]*>▲3</);
  const down = html(base({ teams: { ...base().teams, power: [power({ rank: 5, previousRank: 2, rankMovement: -3 })] } }));
  assert.match(down, /class="rk-mv dn"[^>]*aria-label="down 3"[^>]*>▼3</);
  // A HOLD IS NOT A NEW ROW. previousRank 1, movement 0 - the distinction the
  // reader loses if only rank_movement is read.
  const hold = html(base({ teams: { ...base().teams, power: [power({ previousRank: 1, rankMovement: 0 })] } }));
  assert.match(hold, /class="rk-mv hold"[^>]*aria-label="unchanged"/);
  assert.equal(/rk-mv new/.test(hold), false);

  // AND THE COLUMN IS PRESENT EVEN WHEN EVERY ROW IS NEW - edition 1 shows a
  // blank column rather than no column, so edition 2 does not change the shape
  // of the list.
  assert.match(isNew, /class="rk-mv/);
});

test('SOURCE GUARD: movement is read from previous_rank, in exactly one place', () => {
  const walk = (rel) => readdirSync(path.join(REPO, rel)).flatMap((e) => {
    const p = path.join(rel, e);
    return statSync(path.join(REPO, p)).isDirectory() ? walk(p) : /\.(js|css)$/.test(e) ? [p] : [];
  });
  // COMMENTS ARE STRIPPED FIRST, for the same reason as before: a comment
  // about movement is not a movement column.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [...walk('components/rankings'), 'lib/rankings/reads.js', 'lib/rankings/view.js'];
  const drawers = files.filter((f) => /[▲▼]/.test(strip(src(f))));
  assert.deepEqual(drawers, ['components/rankings/RowInputs.js'],
    'exactly one component draws the glyph, so the threshold cannot be reinvented per module');
  // The column is SELECTED once, in the one query that serves both boards.
  const reads = strip(src('lib/rankings/reads.js'));
  assert.match(reads, /re\.previous_rank, re\.rank_movement/);
  assert.ok(files.length >= 5, 'the guard covers the rankings tree');
});

test('SIGNED OUT, THE GROUP DEFAULT IS THE BEST TEAM\'S, not the first row', () => {
  // It used to fall to label(rows[0]) - whoever sorted first by wins - which
  // put a stranger on Mountain West while Ohio State sat at the top of the
  // poll two modules above. CFB takes the AP number one's conference and the
  // NFL takes the power number one's division.
  const s = src('lib/rankings/reads.js');
  assert.match(s, /export async function groupTable\(leagueSlug, season, group, \{ defaultTeamId = null \} = \{\}\)/);
  assert.match(s, /const want = group \?\? fromTop \?\? label\(rows\[0\]\);/,
    'a followed group still wins, and the first row is only the last resort');
  const v = src('lib/rankings/view.js');
  assert.match(v, /defaultTeamId: power\[0\]\?\.teamId \?\? null/, 'NFL from the power number one');
  assert.match(v, /defaultTeamId: ap\?\.rows\?\.\[0\]\?\.teamId \?\? null/, 'CFB from the AP number one');
  // The ranking has to be READ before the group can be chosen from it, so
  // neither pair may be fired off in one Promise.all.
  assert.equal(/Promise\.all\(\[\s*empty\(\[\]\)\(nflPower/.test(v), false,
    'the NFL power read is awaited before the division is chosen');
});

test('a followed group still beats the default', () => {
  // pickGroup's rule is unchanged: followedGroup wins when this season's rows
  // contain it. Only the fallback moved.
  const s = src('lib/rankings/reads.js');
  const fn = s.slice(s.indexOf('export async function groupTable'));
  assert.ok(fn.indexOf('group ??') < fn.indexOf('fromTop ??'), 'the follow is tried first');
});

test('NO RANKINGS CLASS COLLIDES WITH gridiron.css', () => {
  // THE BUG THIS EXISTS FOR. The page container and the rank column were both
  // `.rk`, and gridiron.css - loaded by every route under /rankings - already
  // owns a bare `.rk`: the AP rank badge, volt fill, black text,
  // display:inline-flex. The whole screen rendered as one giant volt badge
  // with the layout collapsed inside it.
  // Comments are stripped first: the note explaining WHY .rk is avoided
  // names the class, and matching that would fail the file for saying so.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const classesIn = (css) => new Set(
    [...strip(css).matchAll(/(?:^|[\s,{}>+~])\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]),
  );
  const mine = classesIn(src('components/rankings/rankings.css'));
  const gridiron = classesIn(src('components/gridiron/gridiron.css'));
  const clash = [...mine].filter((c) => gridiron.has(c));
  assert.deepEqual(clash, [], `rankings.css reuses gridiron.css selectors: ${clash}`);
  // And the two that did collide are gone from the markup for good.
  for (const f of ['components/rankings/RankRow.js', 'components/rankings/Rankings.js',
    'components/rankings/AllTeams.js']) {
    assert.equal(/className="rk"/.test(src(f)), false, `${f} still uses the colliding bare .rk`);
  }
});

// HEADGEAR-WEB. A rankings row is a single team, so it falls back on its own;
// the row is told its league by the view, never by the letters.
test('HEADGEAR on a rankings row: NFL rows wear helmets facing right, CFB rows keep the disc', () => {
  const h = render(React.createElement(Rankings, { v: base() }));
  assert.match(h, /<img class="teammark teammark--headgear rk-mark" data-teammark="headgear" data-facing="right" src="\/headgear\/nfl\/PHI@1x\.webp"[^>]*width="22" height="22"/);
  assert.match(h, /class="teammark teammark--headgear rk-mark fol"[^>]*src="\/headgear\/nfl\/DET@1x\.webp"/, 'the follow ring class rides on the helmet');
  assert.doesNotMatch(h, /scaleX/);
  const c = render(React.createElement(Rankings, { v: cfb() }));
  assert.doesNotMatch(c, /data-teammark="headgear"/, 'cfb: no cutouts yet');
  assert.match(c, /data-teammark="circle"/);
});

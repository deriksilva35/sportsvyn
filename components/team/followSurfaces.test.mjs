// components/team/followSurfaces.test.mjs - the follow control's reach
// (TEAM FOLLOWING relay). The CSS lift, the shell marker, the extracted game
// row, the rail, and the account list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('THE STAR CSS IS ONE SHEET NOW, and it was two', () => {
  // It existed twice: components/follow-star.css for the player star and a
  // byte-identical copy inside app/team/[slug]/team.css for the team star.
  // The team copy was route-scoped, so the component rendered unstyled
  // anywhere else - which is what spreading it would have done.
  const team = src('app/team/[slug]/team.css');
  assert.equal(/\.follow-star/.test(team), false, 'no star rule left in the route stylesheet');
  assert.match(team, /\.team-name-and-star \{/, 'but the hero flex cluster stayed - that is layout, not the star');
  const sheet = src('components/follow-star.css');
  for (const rule of ['.follow-star-wrap', '.follow-star-btn', '.follow-star-btn.is-following',
    '.follow-star-icon', '.follow-star-label', '.follow-star-prompt',
    '.follow-star-prompt-msg', '.follow-star-prompt-cta', '.follow-star-prompt-dismiss']) {
    assert.ok(sheet.includes(rule), `the shared sheet kept ${rule}`);
  }
  assert.match(sheet, /@keyframes follow-star-slide-in/);
  assert.match(sheet, /prefers-reduced-motion/, 'and the motion opt-out came with it');
  assert.equal(existsSync(path.join(REPO, 'components/team/follow.css')), false, 'no third copy');
  // Both stars import the one sheet.
  assert.match(src('components/team/FollowStar.js'), /import '@\/components\/follow-star\.css'/);
  assert.match(src('components/player/PlayerFollowStar.js'), /import '@\/components\/follow-star\.css'/);
  // The 44px touch target the component promises survived the lift.
  assert.match(sheet, /min-height: 44px/);
});

test('THE TEAM PAGE IS UNCHANGED BY THE LIFT', () => {
  // Same component, same props, same place in the hero - the only difference
  // is which file the rules live in, plus the shell prop that does not show.
  const hero = strip(src('components/team/TeamHero.js'));
  assert.match(hero, /<FollowStar/);
  assert.match(hero, /teamId=\{team\.id\}/);
  assert.match(hero, /teamName=\{team\.name\}/);
  assert.match(hero, /initialFollowing=\{initialFollowing\}/);
  assert.match(hero, /<div className="team-name-and-star">/, 'still inside the name cluster');
  assert.match(hero, /<h1 className="team-hero-name">\{team\.name\}<\/h1>/, 'still after the H1');
  const page = strip(src('app/team/[slug]/page.js'));
  assert.match(page, /isFollowingTeam\(/, 'still seeded server-side, so no hydration flash');
  assert.match(page, /<TeamHero team=\{team\}/);
});

test('THE SIGNED-OUT LINK CARRIES THE SHELL MARKER (R4)', () => {
  const star = src('components/team/FollowStar.js');
  // It built the URL by hand, which carries no marker - so an Apple signup
  // from inside the container was labelled apple:web.
  assert.equal(/`\/signin\?callbackUrl=\$\{encodeURIComponent\(pathname\)\}`/.test(star), false,
    'the hand-rolled href is gone');
  assert.match(star, /import \{ shellSigninHref \} from '@\/lib\/shell\/signinHref'/);
  assert.match(star, /const signinHref = shellSigninHref\(dest, isShell\)/);
  assert.match(star, /isShell = false/, 'and the mode arrives as a prop - a client cannot read the cookie');
  // The helper puts the marker in both places, which is the whole point.
  const helper = src('lib/shell/signinHref.js');
  assert.match(helper, /callbackUrl=\$\{encodeURIComponent\(callback\)\}&\$\{SHELL_PARAM\}=\$\{SHELL_VALUE\}/);
  // Every server caller resolves the mode and hands it down.
  assert.match(strip(src('app/team/[slug]/page.js')), /resolveShellMode\(\)/);
  assert.match(strip(src('components/team/TeamHero.js')), /isShell=\{isShell\}/);
  for (const p of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    assert.match(strip(src(p)), /resolveShellMode\(\)/, `${p} resolves the mode`);
    assert.match(strip(src(p)), /isShell=\{isShell\}/, `${p} passes it down`);
  }
});

test('THE GAME TEAM ROW IS EXTRACTED, and both pages route through it (R3)', () => {
  const row = strip(src('components/gridiron/GameTeamRow.js'));
  // Everything the two copies drew, in the order they drew it.
  for (const part of ['<RankBadge rank={rank} size="big" />', '<Helmet', 'className="abbr"',
    'className="tname"', 'className="gg-rec"', 'className="score"']) {
    assert.ok(row.includes(part), `the extracted row kept ${part}`);
  }
  assert.match(row, /gg-teamrow\$\{loser \? ' loser' : ''\}/, 'and the loser modifier');
  assert.match(row, /\{show \? score : ''\}/, 'and the no-score-before-kickoff rule');
  for (const p of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    const s = strip(src(p));
    assert.match(s, /import GameTeamRow from '@\/components\/gridiron\/GameTeamRow'/, `${p} imports it`);
    assert.match(s, /<GameTeamRow/, `${p} renders it`);
    assert.equal(/function TeamRow\(/.test(s), false, `${p} kept no local copy`);
  }
  // THE CFB RANK BADGE SURVIVED THE EXTRACT. This is the one thing the two
  // rows did not share, and losing it would be silent.
  assert.match(strip(src('app/cfb/game/[slug]/page.js')), /rank=\{apRanks\.get\(t\?\.id\) \?\? null\}/);
  assert.equal(/rank=\{/.test(strip(src('app/nfl/game/[slug]/page.js'))), false,
    'and the NFL page passes none, because it has no poll');
  // The imports the pages no longer use went with the copies.
  for (const p of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    assert.equal(/^import Helmet /m.test(src(p)), false, `${p} dropped the now-unused Helmet import`);
  }
});

test('the game-header star is signed-in only, and needs an id', () => {
  const row = strip(src('components/gridiron/GameTeamRow.js'));
  assert.match(row, /const canFollow = signedIn && t\?\.id != null;/);
  assert.match(row, /\{canFollow \? \(/, 'a stranger gets the row exactly as it was');
  assert.match(row, /isAuthed\n/, 'and the star is never handed a false isAuthed here');
  // The label is hidden on this surface, so the aria-label is the name.
  const css = src('app/nfl/game/[slug]/game.css');
  assert.match(css, /\.gg-teamrow \.gg-follow \.follow-star-label \{/);
  assert.match(css, /clip-path: inset\(50%\)/, 'hidden visually, still in the tree');
  assert.match(src('components/team/FollowStar.js'), /aria-label=\{following \? `Unfollow/, 'which the button has always carried');
});

test('THE RAIL READS THE teamId IT ALREADY RECEIVED', () => {
  // railChip() has set teamId since the rail was written and nothing read it.
  assert.match(strip(src('lib/gridiron/leagueLanding.js')), /teamId: r\.team_id \?\? null/);
  const rail = strip(src('components/league/RankRail.js'));
  assert.match(rail, /followed = null/);
  assert.match(rail, /followed\?\.has\?\.\(id\) === true/, 'and a signed-out reader passes no set');
  assert.match(rail, /mine\(c\.teamId\) \? ' mine' : ''/);
  assert.match(src('components/league/league.css'), /\.lgr-chip\.mine \{ border-color: var\(--volt\); \}/,
    'outlined, not filled - the rail is a ranking first');
  const today = strip(src('components/gridiron/TodayPage.js'));
  assert.match(today, /getFollowedTeamIds\(userId\)/);
  assert.match(today, /followed=\{followed\}/);
  assert.match(today, /userId == null \? \[\] :/, 'no read at all for a stranger');
});

test('THE ACCOUNT LIST USES THE SAME TWO WRITERS, and reverts on failure', () => {
  const c = strip(src('components/account/FollowedTeams.js'));
  assert.match(c, /^'use client';/m);
  assert.match(c, /import \{ followTeam, unfollowTeam \} from '@\/app\/actions\/follows'/,
    'the same actions the star calls - no account-only endpoint');
  assert.match(c, /const before = teams;/, 'the pre-change list is the revert target');
  assert.match(c, /if \(!r\?\.ok\) setTeams\(before\);/);
  assert.match(c, /useTransition/);
  assert.match(c, /data-section="followed-teams"/);
  // Removable, and a way to add: a league filter plus a search.
  assert.match(c, /aria-label=\{`Unfollow \$\{/);
  assert.match(c, /type="search"/);
  assert.match(c, /className={`ft-lg-pill/);
  // Nothing until narrowed - every team at once is a directory, not a control.
  assert.match(c, /if \(!needle && league === 'all'\) return \[\];/);
  assert.match(c, /\.slice\(0, 40\)/);
  const page = strip(src('app/account/page.js'));
  assert.match(page, /<FollowedTeams initialTeams=\{followedTeams\} allTeams=\{allTeams\} \/>/);
  assert.match(page, /getFollowedTeams\(userId\)\.catch\(\(\) => \[\]\)/, 'caught - this page holds sign-out');
  assert.match(page, /followableTeams\(\)\.catch\(\(\) => \[\]\)/);
});

test('a follow is a stake, stated once', () => {
  const shape = strip(src('lib/gridiron/scoresV2Shape.js'));
  assert.match(shape, /s\.alerts \|\| s\.follow/, 'hasStake is the one definition of mine');
  assert.match(shape, /mineCount = \(games, stake\) => games\.filter\(\(g\) => hasStake\(stake\?\.get\(g\.id\)\)\)/,
    'and the count reads it, so the two cannot disagree');
  const reader = strip(src('lib/gridiron/scoresV2.js'));
  assert.match(reader, /getFollowedTeamIds\(uid\)\.catch\(\(\) => \[\]\)/);
  assert.match(reader, /followed\.has\(g\.home\?\.id\) \? 'home' : followed\.has\(g\.away\?\.id\) \? 'away' : null/);
  assert.match(reader, /if \(pick \|\| w\.length \|\| al \|\| follow\)/);
  // No second pill: nothing in the Scores UI branches on follow.
  assert.equal(/follow/.test(strip(src('components/scores/ScoresV2.js'))), false,
    'the tab draws no follow-specific control - Mine is one answer to one question');
});

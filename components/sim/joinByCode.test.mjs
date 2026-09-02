// components/sim/joinByCode.test.mjs - JOIN BY CODE, IN-APP.
//
// The pins, each the thing that could quietly break the feature:
//   ONE REDEEM PATH  the code field never joins; it previews (the /join page's
//                    own invitePreview) and navigates to joinPath(code), and
//                    JoinClaim is the only caller of redeemInvite.
//   NORMALIZATION    one alphabet, one normalizer, one input cleaner - case,
//                    whitespace, hyphens, the confusables.
//   CARRY-THROUGH    signed out, /join/{code} sends the code into sign-in and
//                    /signin says so; codeFromCallback reads it back out.
//   IN THE SHELL     nothing in the join/claim components depends on web
//                    chrome, opens a window, or names an origin.
//   SHARE            the owner's sheet shows the CODE first, the link second,
//                    a copy each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const walk = (dir, out = []) => {
  for (const e of readdirSyncSafe(path.join(REPO, dir))) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(rel, out); }
    else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(rel);
  }
  return out;
};
import { readdirSync } from 'node:fs';
function readdirSyncSafe(p) { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } }

const ic = await import('../../lib/fantasy/inviteCode.js');
const field = stripComments(src('components/sim/JoinByCode.js'));
const claim = stripComments(src('components/sim/JoinClaim.js'));
const actions = stripComments(src('app/actions/league.js'));
const share = stripComments(src('components/sim/LeagueShare.js'));
const joinPage = stripComments(src('app/join/[code]/page.js'));
const signin = stripComments(src('app/signin/page.js'));
const lobby = stripComments(src('app/sim/page.js'));
const myLeagues = stripComments(src('components/sim/MyLeagues.js'));

test('NORMALIZATION: one alphabet (no 0/O/1/I/L), one normalizer, one input cleaner; core.js mints from the same constant', async () => {
  assert.equal(ic.CODE_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  for (const bad of '0OIL1') assert.ok(!ic.CODE_ALPHABET.includes(bad), `${bad} must not be in the alphabet`);
  assert.equal(ic.INVITE_CODE_LENGTH, 8);
  // normalize: case, whitespace, hyphens forgiven; nothing else
  assert.equal(ic.normalizeInviteCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(ic.normalizeInviteCode('ab cd\tef\ngh'), 'ABCDEFGH');
  assert.equal(ic.normalizeInviteCode('ABCDEFG'), null, 'seven');
  assert.equal(ic.normalizeInviteCode('ABCDEFGHJ'), null, 'nine');
  for (const bad of ['ABCDEFG0', 'ABCDEFGO', 'ABCDEFG1', 'ABCDEFGI', 'ABCDEFGL']) assert.equal(ic.normalizeInviteCode(bad), null, `${bad} carries a confusable`);
  assert.equal(ic.normalizeInviteCode('ABCD.EFGH'), null, 'punctuation is not forgiven');
  assert.equal(ic.normalizeInviteCode(null), null);
  // the field's keystroke cleaner: upper, alphabet-only, capped; a pasted code with junk reads clean
  assert.equal(ic.cleanInviteInput('abcd-efgh '), 'ABCDEFGH');
  assert.equal(ic.cleanInviteInput('a b c d e f g h i j'), 'ABCDEFGH', 'capped at eight');
  assert.equal(ic.cleanInviteInput('o0i1l abc'), 'ABC', 'confusables dropped at the keystroke');
  assert.equal(ic.cleanInviteInput(''), '');
  // the server side is the SAME function, re-exported, not a copy
  const ls = stripComments(src('lib/fantasy/leagueShare.js'));
  assert.match(ls, /export \{ CODE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode, joinPath, REFUSALS \} from '\.\/inviteCode\.js';/);
  assert.doesNotMatch(ls, /export function normalizeInviteCode/, 'no second normalizer');
  const core = stripComments(src('lib/leagues/core.js'));
  assert.match(core, /import \{ CODE_ALPHABET \} from '\.\.\/fantasy\/inviteCode\.js';/, 'core.js mints from the same alphabet');
  assert.doesNotMatch(core, /CODE_ALPHABET = '/, 'no second alphabet literal');
  // the pure module is pure: no DB, no request, no server-only import
  const pure = stripComments(src('lib/fantasy/inviteCode.js'));
  assert.doesNotMatch(pure, /from '\.\.\/db|neon|next\/headers|@\/auth|node:crypto/, 'client-safe');
  const { CODE_ALPHABET: coreAlphabet, makeJoinCode } = await import('../../lib/leagues/core.js');
  assert.equal(coreAlphabet, ic.CODE_ALPHABET);
  assert.match(makeJoinCode(), new RegExp(`^[${ic.CODE_ALPHABET}]+$`));
});

test('ONE REDEEM PATH: the field previews with the /join page\'s invitePreview and navigates to joinPath(code); JoinClaim is the only caller of redeemInvite', () => {
  // the field: preview (a read) + relative navigation, no redeem, no second action
  assert.match(field, /import \{ previewInvite \} from '@\/app\/actions\/league';/);
  assert.match(field, /const res = await previewInvite\(code\);/);
  assert.match(field, /router\.push\(joinPath\(code\)\);/);
  assert.doesNotMatch(field, /redeemInvite|claimFranchise|createInvite/, 'the field never joins or claims');
  assert.match(field, /const code = normalizeInviteCode\(value\);\s*if \(!code\) \{ setErr\(REFUSALS\.not_a_code\); return; \}/, 'format refused before any request');
  assert.match(field, /setValue\(cleanInviteInput\(e\.target\.value\)\)/, 'keystrokes go through the cleaner');
  assert.match(field, /onPaste=/, 'paste-friendly');
  assert.match(field, /autoCapitalize="characters"/);
  // the preview action is the same function the /join page renders from
  assert.match(actions, /export async function previewInvite\(code\) \{[\s\S]*?const p = await invitePreview\(String\(code \?\? ''\), userId\);/);
  assert.match(joinPage, /const preview = await invitePreview\(code, userId\);/);
  assert.doesNotMatch(actions.slice(actions.indexOf('export async function previewInvite'), actions.indexOf('export async function redeemInvite')), /INSERT|UPDATE|redeemInviteFor|claimFranchiseFor/, 'the preview action writes nothing');
  // the redeem has exactly one caller in the app: JoinClaim
  const callers = walk('app').concat(walk('components'), walk('lib'))
    .filter((f) => /\bredeemInvite\(/.test(stripComments(src(f))) && !/app\/actions\/league\.js$/.test(f) && !/lib\/fantasy\/leagueShare\.js$/.test(f));
  assert.deepEqual(callers, ['components/sim/JoinClaim.js'], `redeemInvite callers: ${callers.join(', ')}`);
  assert.match(claim, /import \{ redeemInvite \} from '@\/app\/actions\/league';/);
  // one wording: JoinClaim reads the refusal words from the same object the field uses
  assert.match(claim, /import \{ REFUSALS \} from '@\/lib\/fantasy\/inviteCode';/);
  assert.doesNotMatch(claim, /const REFUSALS = \{/, 'no second copy of the refusal words');
  assert.match(field, /REFUSALS\[res\.reason\] \?\? REFUSALS\.invalid_code/);
  for (const r of ['invalid_code', 'revoked', 'expired', 'full', 'franchise_taken', 'no_such_franchise', 'unauthenticated', 'not_a_code']) assert.ok(typeof ic.REFUSALS[r] === 'string' && ic.REFUSALS[r].length > 10, r);
  // one path builder: the Share sheet's link and the field's navigation are the same joinPath
  assert.match(share, /export const joinHref = \(code\) => `\$\{SITE\}\$\{joinPath\(code\)\}`;/);
  assert.equal(ic.joinPath('ABCDEFGH'), '/join/ABCDEFGH');
});

test('CARRY-THROUGH, signed out: /join/{code} goes to sign-in with the code in callbackUrl; /signin names the carried code; codeFromCallback reads it back', async () => {
  assert.match(joinPage, /if \(userId == null\) redirect\(shellSigninHref\(`\/join\/\$\{encodeURIComponent\(code\)\}`, isShell\)\);/);
  const { shellSigninHref } = await import('../../lib/shell/signinHref.js');
  const shell = shellSigninHref('/join/ABCDEFGH', true);
  const cb = new URL('https://x' + shell).searchParams.get('callbackUrl');
  assert.equal(ic.codeFromCallback(cb), 'ABCDEFGH', `the code survives the shell callback: ${cb}`);
  assert.equal(ic.codeFromCallback(new URL('https://x' + shellSigninHref('/join/ABCDEFGH', false)).searchParams.get('callbackUrl')), 'ABCDEFGH', 'and the web one');
  assert.equal(ic.codeFromCallback('/join/abcd-efgh?shell=sim-app'), 'ABCDEFGH', 'normalised on the way back');
  assert.equal(ic.codeFromCallback('/sim'), null);
  assert.equal(ic.codeFromCallback('/join/'), null);
  assert.equal(ic.codeFromCallback('/join/NOTACODE0'), null, 'junk is not a code');
  assert.equal(ic.codeFromCallback(null), null);
  // the sign-in page says the code is coming along, and only then hides its own field
  assert.match(signin, /const joinCode = codeFromCallback\(callbackUrl\);/);
  assert.match(signin, /data-join-code=\{joinCode\}/);
  assert.match(signin, /League code \{joinCode\} comes with you/);
  assert.match(signin, /\{isShell && !joinCode && <JoinByCode variant="signin" \/>\}/, 'the shell\'s signed-out surface carries the field');
  // the email-code path navigates to callbackUrl in-app; the Apple path rides the relaxed cookie (pinned in auth.js)
  const form = stripComments(src('app/signin/SignInForm.js'));
  assert.match(form, /router\.push\(callbackUrl\)/);
  const authSrc = src('auth.js');
  assert.match(authSrc, /callbackUrl: \{\s*options: \{ sameSite: 'none', secure: true \}/);
  // a NEW account lands on /join with the onboarding sheet OVER it, refreshing in place - the code is never dropped
  assert.match(joinPage, /<OnboardingGate \/>/);
  const sheet = stripComments(src('components/onboarding/OnboardingSheet.js'));
  assert.doesNotMatch(sheet, /router\.push\(|router\.replace\(|redirect\(/, 'the handle sheet does not navigate away from the join page');
});

test('IN THE SHELL: the join/claim components have no web-chrome dependency, open no window, name no origin; the field is on the lobby (empty + row) and the hero', () => {
  for (const [name, s] of [['JoinByCode', field], ['JoinClaim', claim]]) {
    assert.doesNotMatch(s, /HideInShell|isShell|sv_shell|resolveShellMode|GlobalHeader|Wordmark/, `${name}: no chrome gate`);
    assert.doesNotMatch(s, /window\.open|target="_blank"|location\.href|https?:\/\//, `${name}: nothing leaves the origin`);
  }
  assert.match(field, /import \{ cleanInviteInput, normalizeInviteCode, joinPath, INVITE_CODE_LENGTH, REFUSALS \} from '@\/lib\/fantasy\/inviteCode';/);
  assert.match(joinPage, /<HideInShell>\s*<header className="sim-head"><Wordmark href="\/sim" \/><\/header>\s*<\/HideInShell>/, 'the only shell gate on /join is the web wordmark');
  assert.match(joinPage, /<JoinClaim code=\{code\} preview=\{preview\} \/>/);
  assert.doesNotMatch(src('proxy.js'), /\/join/, 'the join route is not behind the proxy matcher');
  // lobby: the empty state takes the leagues slot; with leagues the row sits under the cards; the signed-out hero has it
  assert.match(lobby, /\{myLeagues\.length === 0 && <JoinByCode variant="empty" \/>\}/);
  assert.match(myLeagues, /<JoinByCode variant="row" \/>/);
  assert.match(lobby, /<JoinByCode variant="signin" \/>/, 'signed-out web hero');
  assert.ok(existsSync(path.join(REPO, 'components/sim/joinByCode.css')));
  assert.match(field, /import '\.\/joinByCode\.css';/, 'the field carries its own styles, so /signin needs no sim.css');
  const css = src('components/sim/joinByCode.css');
  for (const c of ['.jbc--empty', '.jbc--row', '.jbc--signin', '.jbc-in', '.jbc-go', '.jbc-err']) assert.ok(css.includes(c), c);
});

test('SHARE: the owner\'s sheet shows the CODE first, then "or share the link", a Copy each', () => {
  const codeAt = share.indexOf('LEAGUE CODE'), linkAt = share.indexOf('OR SHARE THE LINK');
  assert.ok(codeAt > 0 && linkAt > codeAt, 'code before link');
  assert.match(share, /<code className="lgs-code lgs-code--big">\{invite\.code\}<\/code>/);
  assert.match(share, /copy\('code', invite\.code\)/);
  assert.match(share, /copy\('link', joinHref\(invite\.code\)\)/);
  assert.match(share, /\{copied === 'code' \? 'Copied' : 'Copy code'\}/);
  assert.match(share, /\{copied === 'link' \? 'Copied' : 'Copy link'\}/);
  assert.match(share, /Join a league<\/b> in the app/);
  assert.ok(src('components/sim/sim.css').includes('.lgs-code--big'));
});

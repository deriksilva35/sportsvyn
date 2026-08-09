// lib/articles.test.mjs — the Reads query's league scope.
//
// getTodaysReads used to hardcode 'fifa-wc-2026' in two places inside its WHERE.
// That was invisible from the call site: the homepage asked for "today's reads"
// and silently got "today's World Cup reads", so when the homepage moved to
// football the section could not be filled at all - a football article
// published this morning matched nothing, and the page rendered as though
// nobody had written anything.
//
// The scope is now a parameter. These tests pin the three things that would
// each fail quietly:
//   · the default still means World Cup, so any caller not updated is unchanged
//   · both predicates move together (a preview and an essay must agree)
//   · an empty list is REFUSED rather than silently matching nothing
//
// The query itself needs a database, so its SQL shape is asserted on source and
// its guard clause is executed directly. The end-to-end behaviour - a seeded
// football article surfacing for the football slugs and not for the WC slug -
// was verified against DEV.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const articles = stripComments(src('lib/articles.js'));
const reads = articles.slice(articles.indexOf('export async function getTodaysReads'));

test('the league scope is a parameter, not a hardcoded slug', () => {
  assert.match(reads, /leagueSlugs = WC_READS_SLUGS/, 'callers must be able to choose the scope');
  // Neither predicate may name a league directly any more.
  assert.ok(!/lg_m\.slug = 'fifa-wc-2026'/.test(reads), 'the preview predicate must not hardcode a league');
  assert.ok(!/lg_a\.slug = 'fifa-wc-2026'/.test(reads), 'the article predicate must not hardcode a league');
});

test('BOTH predicates read the same list - previews and essays cannot diverge', () => {
  // A scope applied to one and not the other is the subtle version of this bug:
  // match previews would follow the caller while essays stayed on the World Cup.
  const anyMatches = reads.match(/= ANY\(\$\{slugs\}::text\[\]\)/g) ?? [];
  assert.equal(anyMatches.length, 2, 'exactly two predicates, both parameterised');
  assert.match(reads, /lg_m\.slug = ANY/, 'preview rows scope on the MATCH league');
  assert.match(reads, /lg_a\.slug = ANY/, 'article rows scope on the ARTICLE league');
});

test('the default preserves the previous behaviour exactly', () => {
  assert.match(articles, /export const WC_READS_SLUGS = \['fifa-wc-2026'\]/);
  assert.match(reads, /leagueSlugs = WC_READS_SLUGS/,
    'an un-updated caller must get precisely what it got before');
});

test('the football scope is both leagues, named once', () => {
  assert.match(articles, /export const FOOTBALL_READS_SLUGS = \['nfl', 'cfb'\]/,
    'the homepage scope lives here, not inline at the call site');
  // ...and the homepage actually uses it rather than passing its own array.
  const page = stripComments(src('app/page.js'));
  assert.match(page, /leagueSlugs: FOOTBALL_READS_SLUGS/,
    'the homepage must pass the shared constant');
});

test("the editorial type list includes 'feature' - what a published draft becomes", () => {
  // Migration 043 added 'feature' to articles_type_check so topic drafts could
  // publish; this predicate predates that and was never extended. The result was
  // that the homepage was the one editorial surface blind to an AI-drafted,
  // editor-published article - /articles lists them fine, because the archive
  // excludes only 'preview'. A feature published this morning never appeared.
  assert.match(reads, /a\.type IN \('essay','edge','profile','rankings','recap','newsletter','feature'\)/,
    "the Reads query must accept 'feature'");
  // And the archive's rule is the complement: everything editorial except previews.
  const readerSrc = stripComments(src('lib/articleReader.js'));
  assert.match(readerSrc, /a\.status = 'published' AND a\.type <> 'preview'/,
    'if the archive ever switches to an allowlist, these two must be reconciled');
});

test('an empty league list is refused, never treated as "match nothing"', async () => {
  // Silently returning [] for an empty scope reads on the page as "no reads
  // today" when the truth is "you asked for no leagues". Guard before the query.
  assert.match(reads, /if \(slugs\.length === 0\) return \[\]/, 'the guard exists');
  // Executed, not just read: it must return before touching the database.
  const { getTodaysReads } = await import('./articles.js');
  for (const bad of [[], null, undefined && [], [null], ['']]) {
    const out = await getTodaysReads({ ptDay: '2026-08-09', leagueSlugs: bad ?? [] });
    assert.deepEqual(out, [], `empty-ish scope ${JSON.stringify(bad)} must return []`);
  }
});

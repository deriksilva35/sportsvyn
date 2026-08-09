// lib/topicDraftWiring.test.mjs - the four places the league has to travel.
//
// The envelope work is useless if the league gets dropped on the way out. It
// has to survive: the admin form -> runTopicDraft -> the topic_drafts row ->
// the league_id stamped at publish. Each of those is a separate file, and three
// of them cannot be exercised without a live Anthropic key or a browser, so
// they are asserted on source.
//
// Also here: the generate-briefs allowlist, which is a different kind of guard.
// It is the one item in this build with a date on it - CFB Week 0 is Aug 29,
// and until then the absence of a league filter costs nothing and looks fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPIC_DRAFT_LEAGUE_SLUGS } from './topicDraftLeagues.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const runner = stripComments(src('lib/topicDraft.js'));
const admin = stripComments(src('app/admin/topic-drafts/page.js'));
const route = stripComments(src('app/api/admin/topic-draft/route.js'));
const cron = stripComments(src('app/api/cron/generate-briefs/route.js'));
const reader = stripComments(src('lib/articleReader.js'));
const migration = src('migrations/060_topic_drafts_league.sql');

// Route handlers cannot be imported under node --test - the @/ alias is a Next
// build concern (see lib/pollers/cronWiring.test.mjs, same constraint). So the
// allowlist is parsed out of the source, strictly: an unparseable or empty list
// THROWS here rather than yielding [] and letting every assertion below pass
// vacuously, which is exactly how a guard test stops guarding.
const BRIEF_LEAGUE_SLUGS = (() => {
  const m = cron.match(/export const BRIEF_LEAGUE_SLUGS = \[([\s\S]*?)\];/);
  assert.ok(m, 'BRIEF_LEAGUE_SLUGS must be an exported array literal');
  const slugs = [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  assert.ok(slugs.length > 0, 'parsed an empty allowlist - the regex or the source has drifted');
  return slugs;
})();

// ---------------------------------------------------------------------------
// The league travels
// ---------------------------------------------------------------------------

test('the runner takes a league and defaults to the World Cup', () => {
  // The default is what keeps every pre-060 caller producing the same draft.
  assert.match(runner, /export async function runTopicDraft\(promptText, \{ leagueSlug = WC_LEAGUE_SLUG \} = \{\}\)/);
  assert.match(runner, /leagueConfig\(leagueSlug\);/, 'and validates it up front, which throws on an unknown slug');
});

test('the league reaches all three stages, not just one', () => {
  // Any one of these left league-blind produces a draft that reads as football
  // and was built from soccer readers, or vice versa.
  assert.match(runner, /planStage\(promptText, leagueSlug\)/, 'planner');
  assert.match(runner, /resolveEntities\(plan\.entities, leagueSlug\)/, 'entity resolution');
  assert.match(runner, /buildInternalEnvelope\(resolved, leagueSlug\)/, 'envelope');
});

test('the resolved prompt is what gets sent AND what gets ledgered', () => {
  // ai_generations must record the prompt the model actually saw. Logging the
  // unresolved template would leave {{grounding_inputs}} in the audit trail.
  assert.match(runner, /const systemPrompt = resolvePrompt\(template\.system_prompt, leagueSlug\)/);
  assert.match(runner, /system: systemPrompt, user: userPrompt, schema: WRITE_SCHEMA/, 'sent');
  assert.ok(!/systemPrompt: template\.system_prompt/.test(runner), 'the raw template must not be ledgered');
});

test('the draft row stores its league', () => {
  assert.match(runner, /INSERT INTO topic_drafts \(\s*prompt_text, league_slug,/,
    'league_slug is written with the row, not patched on afterwards');
});

test('the admin form makes the league an explicit, whitelisted choice', () => {
  assert.match(admin, /<select[\s\S]{0,200}name="league"/, 'a picker exists');
  assert.match(admin, /defaultValue=\{WC_LEAGUE_SLUG\}/, 'defaulting to the prior behaviour');
  assert.match(admin, /if \(!TOPIC_DRAFT_LEAGUE_SLUGS\.includes\(league\)\) return;/,
    'the server action re-checks - a hand-posted slug must not reach the FK');
  assert.match(admin, /runTopicDraft\(prompt, \{ leagueSlug: league \}\)/);
});

test('the API route accepts a league, defaults to WC, and 400s on nonsense', () => {
  assert.match(route, /body\?\.league \?\? WC_LEAGUE_SLUG/, 'a pre-060 script is unchanged');
  assert.match(route, /if \(!TOPIC_DRAFT_LEAGUE_SLUGS\.includes\(league\)\)/);
  assert.match(route, /status: 400/, 'an unknown league is refused, not silently rewritten');
});

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

test('PUBLISH: the hardcoded World Cup lookup is gone', () => {
  // This was the concrete blocker. A football feature published through the old
  // path got the World Cup league_id, and the homepage Reads query - scoped to
  // nfl and cfb - would never have found it. Live at its URL, invisible.
  for (const [name, code] of [['admin page', admin], ['articleReader', reader]]) {
    assert.ok(!/WHERE slug = 'fifa-wc-2026'/.test(code),
      `the literal must not survive in ${name}`);
  }
  assert.match(reader, /SELECT id FROM leagues WHERE slug = \$\{d\.league_slug\}/,
    'the league comes off the draft');
  assert.match(reader, /SELECT id, status, current_content, league_slug FROM topic_drafts/,
    'and the draft read must fetch it');
});

test('PUBLISH: the action is a thin caller, so the path is testable at all', () => {
  // A Server Action cannot be invoked from a script or a test. With the body
  // inline, the most consequential step in the pipeline was the only one nothing
  // could exercise - which is why the WC hardcode survived unnoticed for a month.
  assert.match(reader, /export async function publishTopicDraft\(id\)/);
  assert.match(admin, /const r = await publishTopicDraft\(Number\(formData\.get\('id'\)\)\)/);
  assert.match(admin, /assertAdminEnv\(\);\s*\n\s*const r = await publishTopicDraft/,
    'the admin gate still runs first');
  assert.ok(!/INSERT INTO articles/.test(admin), 'no DB work left in the action');
});

test('PUBLISH: an unresolvable league refuses rather than writing a null league_id', () => {
  // A null league_id renders perfectly and is invisible to every league-scoped
  // surface - the failure that looks like success.
  assert.match(reader, /if \(!lg\) return \{ ok: false, reason: `unknown_league/);
  assert.match(reader, /'published', 'Sportsvyn', \$\{lg\.id\}/,
    'the insert uses the resolved id, with no ?? null fallback');
  assert.ok(!/\$\{wc\?\.id \?\? null\}/.test(reader), 'the old nullable stamp is gone');
  // The publish gate moved with the body; it must still be there.
  assert.match(reader, /d\.status !== 'pending_review' && d\.status !== 'in_editing'/);
});

test('PUBLISH: revalidates the homepage, not just the queue', () => {
  // The homepage is force-dynamic, but Today's Reads is exactly where a newly
  // published feature is supposed to appear, so the action says so explicitly.
  assert.match(admin, /revalidatePath\('\/'\)/);
});

test('PUBLISH: World Cup drafts still publish as World Cup', () => {
  // Migration 060 backfills every pre-existing row to fifa-wc-2026, so the same
  // seven pending World Cup drafts publish exactly where they always would have.
  assert.match(migration, /UPDATE topic_drafts SET league_slug = 'fifa-wc-2026' WHERE league_slug IS NULL/);
  assert.match(migration, /ALTER COLUMN league_slug SET NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(league_slug\) REFERENCES leagues\(slug\)/,
    'the FK is what lets the publish path assume the lookup succeeds');
  assert.ok(!/DEFAULT '/.test(migration.split('-- ---- 2.')[0]),
    'NO default on league_slug - a caller that forgets must fail loudly, not mislabel');
});

test('MIGRATION: v1.2 supersedes v1.1 and exactly one stays active', () => {
  assert.match(migration, /'topic_draft', '1\.2'/);
  assert.match(migration, /SET is_active = false, deprecated_at = now\(\)/, 'v1.1 is stood down');
  assert.match(migration, /SET superseded_by = \(SELECT id FROM ai_prompt_templates WHERE slug = 'topic_draft' AND version = '1\.2'\)/,
    'and pointed at its successor');
  // ORDER IS LOAD-BEARING. idx_ai_prompt_templates_one_active is a partial
  // UNIQUE index on (slug, coalesce(sport,'_universal')) WHERE is_active, so
  // inserting v1.2 active before standing v1.1 down fails the index and rolls
  // the whole migration back. Confirmed on DEV the hard way.
  const standDown = migration.indexOf('SET is_active = false');
  const insert = migration.indexOf("'topic_draft', '1.2'");
  assert.ok(standDown > -1 && insert > standDown,
    'v1.1 must be deactivated BEFORE v1.2 is inserted');
  // v1.1 is retired, not deleted: ai_generations rows point at prompt_template_id
  // and the drafts written under it stay explicable.
  assert.ok(!/DELETE FROM ai_prompt_templates/.test(migration));
  // The runner picks WHERE is_active = true LIMIT 1, so two active rows would be
  // a coin flip over which prompt the model gets.
  assert.match(runner, /WHERE slug = 'topic_draft' AND is_active = true LIMIT 1/);
});

// ---------------------------------------------------------------------------
// The cron guard
// ---------------------------------------------------------------------------

test('generate-briefs is restricted to leagues whose event data exists', () => {
  // Tier 1 reads match_events, match_lineups and match_statistics. Those have
  // ZERO gridiron rows, so a football game inside the 6-hour window would be
  // briefed from a score, two names, and three empty arrays.
  assert.ok(Array.isArray(BRIEF_LEAGUE_SLUGS) && BRIEF_LEAGUE_SLUGS.length > 0);
  for (const gridiron of ['nfl', 'cfb']) {
    assert.ok(!BRIEF_LEAGUE_SLUGS.includes(gridiron),
      `${gridiron} must not be briefed until it has play data`);
  }
  assert.ok(BRIEF_LEAGUE_SLUGS.includes('fifa-wc-2026'), 'soccer keeps working');
  assert.ok(BRIEF_LEAGUE_SLUGS.includes('international-friendlies'),
    'friendlies produced 62 of the 176 briefs - dropping them would be a silent regression');
});

test('the allowlist is applied in the candidate query, not filtered afterwards', () => {
  // Filtering in JS after the LIMIT would let five gridiron rows fill the
  // per-sweep cap and starve a real soccer candidate.
  assert.match(cron, /JOIN leagues l ON l\.id = m\.league_id/);
  assert.match(cron, /WHERE l\.slug = ANY\(\$\{BRIEF_LEAGUE_SLUGS\}::text\[\]\)/);
  const where = cron.indexOf('WHERE l.slug = ANY');
  const limit = cron.indexOf(`LIMIT ${'${PER_SWEEP_CAP}'}`);
  assert.ok(where > -1 && limit > where, 'the league predicate precedes the cap');
});

test('the allowlist is positive - a new league is OUT until someone says otherwise', () => {
  // A "not nfl, not cfb" exclusion would silently admit the next sport added.
  assert.ok(!/!=\s*'nfl'|NOT IN \('nfl'/.test(cron), 'no exclusion list');
  assert.match(cron, /export const BRIEF_LEAGUE_SLUGS/, 'exported so this test binds to the real value');
});

// ---------------------------------------------------------------------------
// The two allowlists are different things
// ---------------------------------------------------------------------------

test('drafting football is allowed; briefing it is not - and that is deliberate', () => {
  // Easy to read as a contradiction later. Topic drafts run off rankings,
  // season records and research, all of which exist for gridiron. Tier 1 briefs
  // run off play-by-play events, which do not.
  for (const g of ['nfl', 'cfb']) {
    assert.ok(TOPIC_DRAFT_LEAGUE_SLUGS.includes(g), `${g} can be written about`);
    assert.ok(!BRIEF_LEAGUE_SLUGS.includes(g), `${g} cannot be auto-briefed`);
  }
});

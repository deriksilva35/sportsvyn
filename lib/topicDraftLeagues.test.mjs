// lib/topicDraftLeagues.test.mjs - the league config, and the promise that
// teaching this pipeline football did not change how it writes about soccer.
//
// THE PIN THAT MATTERS. The stored prompt v1.2 is v1.1 with three phrases
// replaced by placeholders. Resolving v1.2 for 'fifa-wc-2026' must reproduce
// v1.1 exactly - not "close enough", byte for byte - because the World Cup
// prompt is a tuned artefact that took several drafts to settle, and the
// football work has no business editing it in passing. The three World Cup
// values below ARE the v1.1 phrases; if anyone edits one, this file fails and
// names it.
//
// The migration's own text is read off disk rather than restated here, so the
// test checks what will actually be applied to the database. No DB required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOPIC_DRAFT_LEAGUES, TOPIC_DRAFT_LEAGUE_SLUGS, PROMPT_PLACEHOLDERS,
  WC_LEAGUE_SLUG, leagueConfig, isGridiron, resolvePrompt,
} from './topicDraftLeagues.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(path.join(REPO, 'migrations/060_topic_drafts_league.sql'), 'utf8');

// The v1.2 system prompt as the migration will store it. It is a single quoted
// SQL literal; '' inside it is an escaped apostrophe.
function storedSystemPrompt() {
  const start = migration.indexOf("  'You are a Sportsvyn editor");
  assert.ok(start > -1, 'the migration must insert a system prompt');
  const end = migration.indexOf("',\n  t.user_prompt_template", start);
  assert.ok(end > start, 'the system prompt literal must terminate');
  return migration.slice(start + 3, end).replace(/''/g, "'");
}

// The three phrases v1.1 shipped with, restated as the pin. Kept verbatim and
// separate from the config so that "the config matches v1.1" is an assertion
// and not a tautology.
const V11_PHRASES = {
  grounding_inputs: 'a ranking number, a tournament stat, a per-match number, a named fixture, a Watch Score, or a named research source',
  envelope_inventory: 'rankings, Watch Scores, match records, player statistics',
  closing_horizon: 'the tournament itself will answer',
};

// ---------------------------------------------------------------------------
// The World Cup is untouched
// ---------------------------------------------------------------------------

test('the World Cup prompt values are v1.1 verbatim', () => {
  for (const key of PROMPT_PLACEHOLDERS) {
    assert.equal(
      TOPIC_DRAFT_LEAGUES[WC_LEAGUE_SLUG].prompt[key], V11_PHRASES[key],
      `{{${key}}} for the World Cup must be exactly what v1.1 said`,
    );
  }
});

test('resolving the stored v1.2 for the World Cup reproduces the v1.1 sentences', () => {
  const resolved = resolvePrompt(storedSystemPrompt(), WC_LEAGUE_SLUG);
  // The three full v1.1 sentences, each reconstructed around its phrase. If the
  // migration mangled the surrounding text, a phrase would survive but its
  // sentence would not.
  const sentences = [
    `GROUNDED: every evaluative claim must trace to a concrete input - ${V11_PHRASES.grounding_inputs}. If you cannot point at the row that supports it, do not write it. Observation, not opinion.`,
    `It is Sportsvyn's own data: ${V11_PHRASES.envelope_inventory}. Lead evaluative sections with envelope numbers wherever they exist`,
    `Close by naming the unresolved question ${V11_PHRASES.closing_horizon} - an observable, not a prediction.`,
  ];
  for (const s of sentences) {
    assert.ok(resolved.includes(s), `v1.1 sentence missing after resolution:\n${s}`);
  }
});

test('the ONLY difference between leagues is inside the three placeholders', () => {
  // The real "nothing else in the prompt changes" guarantee. Blank the three
  // spans in both resolutions; what is left must be identical strings.
  const stored = storedSystemPrompt();
  const blanked = (slug) => {
    let out = resolvePrompt(stored, slug);
    for (const key of PROMPT_PLACEHOLDERS) {
      const v = TOPIC_DRAFT_LEAGUES[slug].prompt[key];
      out = out.split(v).join(`<<${key}>>`);
    }
    return out;
  };
  const wc = blanked(WC_LEAGUE_SLUG);
  for (const slug of TOPIC_DRAFT_LEAGUE_SLUGS) {
    assert.equal(blanked(slug), wc,
      `${slug} differs from the World Cup outside the three placeholders`);
  }
});

test('every placeholder resolves - a hole in the grounding rules is not cosmetic', () => {
  const stored = storedSystemPrompt();
  for (const key of PROMPT_PLACEHOLDERS) {
    assert.ok(stored.includes(`{{${key}}}`), `the stored prompt must carry {{${key}}}`);
  }
  for (const slug of TOPIC_DRAFT_LEAGUE_SLUGS) {
    const out = resolvePrompt(stored, slug);
    assert.ok(!/\{\{/.test(out), `${slug} left a placeholder unresolved`);
  }
});

test('a league missing a prompt value throws rather than shipping a gap', () => {
  const broken = '{{grounding_inputs}} and {{envelope_inventory}} and {{closing_horizon}}';
  assert.throws(() => resolvePrompt(broken, 'not-a-league'), /unknown topic-draft league/);
  // An unknown placeholder in the template is caught too.
  assert.throws(() => resolvePrompt('{{mystery_field}}', WC_LEAGUE_SLUG), /unresolved prompt placeholders/);
});

// ---------------------------------------------------------------------------
// What gridiron says instead
// ---------------------------------------------------------------------------

test('gridiron never mentions a Watch Score or a tournament', () => {
  // Both are absences with a reason: match_watch_score_history is soccer-only,
  // and a season is not a tournament. Inviting either would invite invention.
  for (const slug of ['nfl', 'cfb']) {
    const text = Object.values(TOPIC_DRAFT_LEAGUES[slug].prompt).join(' ');
    assert.ok(!/watch score/i.test(text), `${slug} must not mention a Watch Score`);
    assert.ok(!/tournament/i.test(text), `${slug} must not call a season a tournament`);
    assert.match(text, /season/, `${slug} should say season`);
  }
});

test('the World Cup DOES keep both, because it has both', () => {
  const text = Object.values(TOPIC_DRAFT_LEAGUES[WC_LEAGUE_SLUG].prompt).join(' ');
  assert.match(text, /Watch Score/);
  assert.match(text, /tournament/);
});

// ---------------------------------------------------------------------------
// The config itself
// ---------------------------------------------------------------------------

test('three leagues, each complete', () => {
  assert.deepEqual(TOPIC_DRAFT_LEAGUE_SLUGS.sort(), ['cfb', 'fifa-wc-2026', 'nfl']);
  for (const slug of TOPIC_DRAFT_LEAGUE_SLUGS) {
    const cfg = leagueConfig(slug);
    assert.equal(cfg.slug, slug, 'the key and the slug must agree');
    assert.ok(cfg.label, 'every league needs a label for the picker');
    assert.ok(['soccer', 'gridiron'].includes(cfg.kind));
    for (const key of PROMPT_PLACEHOLDERS) {
      assert.equal(typeof cfg.prompt[key], 'string');
      assert.ok(cfg.prompt[key].length > 0);
    }
  }
});

test('an unknown league throws instead of defaulting to the World Cup', () => {
  // A silent default is how a football draft gets published under the World Cup
  // and then never appears on the football homepage.
  for (const bad of ['epl', '', null, undefined, 'NFL', 'fifa-wc-2030']) {
    assert.throws(() => leagueConfig(bad), /unknown topic-draft league/, `${JSON.stringify(bad)} must throw`);
  }
});

test('gridiron leagues declare their boards, and only real ones', () => {
  // getTopN / getPlayerTopN INNER JOIN teams/players on the entry id, and every
  // gridiron ranking_entry has NULL team_id and NULL player_id - so the boards
  // must be read through getEditorialBoard, which reads the label.
  assert.deepEqual(TOPIC_DRAFT_LEAGUES.nfl.boards.map((b) => b.list),
    ['nfl-power', 'nfl-mvp-offense', 'nfl-mvp-defense']);
  assert.deepEqual(TOPIC_DRAFT_LEAGUES.cfb.boards.map((b) => b.list),
    ['cfb-top25', 'cfb-heisman']);
  assert.equal(TOPIC_DRAFT_LEAGUES[WC_LEAGUE_SLUG].boards, undefined,
    'the World Cup path does not use the board reader');
});

test('CFB declares it has no player table', () => {
  // There is no college player row anywhere. Reaching into nfl_players for a
  // college name would resolve a different human with the same name.
  assert.equal(TOPIC_DRAFT_LEAGUES.nfl.hasPlayers, true);
  assert.equal(TOPIC_DRAFT_LEAGUES.cfb.hasPlayers, false);
});

test('isGridiron splits the two paths', () => {
  assert.equal(isGridiron('nfl'), true);
  assert.equal(isGridiron('cfb'), true);
  assert.equal(isGridiron(WC_LEAGUE_SLUG), false);
  assert.equal(isGridiron('nonsense'), false, 'must not throw - it is a predicate');
});

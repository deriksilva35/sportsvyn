/**
 * lib/topicDraftLeagues.js - which league a topic draft is being written for,
 * and everything about the pipeline that changes because of it.
 *
 * WHY A CONFIG AND NOT A BRANCH. The topic-draft pipeline was World Cup only:
 * 'fifa-wc-2026' was a module constant in lib/topicDraft.js used in ten places,
 * and three sentences of the stored prompt named soccer directly. Adding
 * football by threading `if (league === 'nfl')` through the runner would put the
 * sport in ten decisions instead of one, and the eleventh would be the one
 * somebody forgets.
 *
 * Everything sport-dependent lives here, in one object per league, and nothing
 * in this file touches the database - which is what makes the guarantees below
 * testable without one.
 *
 * THE GUARANTEE THAT MATTERS: WORLD CUP GENERATION IS UNCHANGED. The stored
 * prompt v1.2 is v1.1 with three phrases replaced by placeholders; the World Cup
 * entry below carries those three phrases verbatim, so resolving v1.2 for
 * 'fifa-wc-2026' reproduces v1.1 byte for byte. That is not a claim, it is a
 * test (topicDraftLeagues.test.mjs) - and it is why the football work could not
 * quietly reword the World Cup prompt on its way past.
 *
 * WHAT IS DELIBERATELY ABSENT FOR GRIDIRON:
 *   · No Watch Score. match_watch_score_history is populated for soccer only,
 *     so a gridiron prompt that invited the model to cite one would be inviting
 *     it to invent one.
 *   · No "tournament". A season is not a tournament, and a piece that closes by
 *     pointing at what "the tournament will answer" reads as a category error
 *     in week 3 of a 18-week season.
 *   · No confederation, FIFA rank, or group. Those columns exist on `teams` and
 *     are NULL for every gridiron row; selecting them would hand the model a
 *     wall of nulls to reason around.
 */

export const WC_LEAGUE_SLUG = 'fifa-wc-2026';

/**
 * The three prompt placeholders, named once so the migration, the runner, and
 * the tests cannot disagree about the set.
 */
export const PROMPT_PLACEHOLDERS = ['grounding_inputs', 'envelope_inventory', 'closing_horizon'];

export const TOPIC_DRAFT_LEAGUES = {
  [WC_LEAGUE_SLUG]: {
    slug: WC_LEAGUE_SLUG,
    kind: 'soccer',
    label: '2026 FIFA World Cup',
    // The scope word the planner and the envelope both use when a prompt is
    // about the competition as a whole rather than a named team or player.
    scopeKind: 'tournament',
    // VERBATIM v1.1. Changing any of these three strings changes the World Cup
    // prompt, and the byte-identical test will say so.
    prompt: {
      grounding_inputs: 'a ranking number, a tournament stat, a per-match number, a named fixture, a Watch Score, or a named research source',
      envelope_inventory: 'rankings, Watch Scores, match records, player statistics',
      closing_horizon: 'the tournament itself will answer',
    },
  },

  nfl: {
    slug: 'nfl',
    kind: 'gridiron',
    label: 'National Football League',
    scopeKind: 'season',
    prompt: {
      grounding_inputs: 'a ranking number, a season stat, a per-game number, a named game, or a named research source',
      envelope_inventory: 'rankings, season records, game results, player statistics',
      closing_horizon: 'the season itself will answer',
    },
    // The editorial boards that actually exist for this league. getTopN and
    // getPlayerTopN cannot be used here: gridiron ranking_entries carry a
    // selection_label with NULL team_id and NULL player_id, and both of those
    // readers INNER JOIN on the id. getEditorialBoard reads the label directly.
    boards: [
      { list: 'nfl-power', label: 'Power Rankings' },
      { list: 'nfl-mvp-offense', label: 'MVP (offense)' },
      { list: 'nfl-mvp-defense', label: 'Defensive Player' },
    ],
    // nfl_players + nfl_player_game_stats back the player envelope.
    hasPlayers: true,
  },

  cfb: {
    slug: 'cfb',
    kind: 'gridiron',
    label: 'College Football',
    scopeKind: 'season',
    prompt: {
      grounding_inputs: 'a ranking number, a season stat, a per-game number, a named game, or a named research source',
      envelope_inventory: 'rankings, season records, game results, player statistics',
      closing_horizon: 'the season itself will answer',
    },
    boards: [
      { list: 'cfb-top25', label: 'The Sportsvyn 25' },
      { list: 'cfb-heisman', label: 'Heisman' },
    ],
    // There is no college player table. A CFB prompt naming a player resolves
    // it to `unresolved` rather than reaching into nfl_players for a name
    // collision, and the editor sees the gap on the draft.
    hasPlayers: false,
  },
};

export const TOPIC_DRAFT_LEAGUE_SLUGS = Object.keys(TOPIC_DRAFT_LEAGUES);

/**
 * The league for a slug. Unknown or missing input THROWS rather than falling
 * back to the World Cup: a mislabelled draft publishes under the wrong league
 * and shows up on the wrong homepage, which is worse than a failed generation
 * the editor can see and retry.
 */
export function leagueConfig(slug) {
  const cfg = TOPIC_DRAFT_LEAGUES[slug];
  if (!cfg) {
    throw new Error(`unknown topic-draft league: ${JSON.stringify(slug)} (expected one of ${TOPIC_DRAFT_LEAGUE_SLUGS.join(', ')})`);
  }
  return cfg;
}

export function isGridiron(slug) {
  return TOPIC_DRAFT_LEAGUES[slug]?.kind === 'gridiron';
}

/**
 * Fill the stored prompt's league placeholders.
 *
 * Every placeholder must resolve. An unresolved `{{...}}` reaching the model is
 * not a cosmetic defect - it is a sentence with a hole in it in the middle of
 * the grounding rules, so this throws rather than shipping one.
 */
export function resolvePrompt(template, slug) {
  const cfg = leagueConfig(slug);
  let out = String(template ?? '');
  for (const key of PROMPT_PLACEHOLDERS) {
    const value = cfg.prompt[key];
    if (typeof value !== 'string' || !value) {
      throw new Error(`league ${slug} has no prompt value for {{${key}}}`);
    }
    out = out.split(`{{${key}}}`).join(value);
  }
  const leftover = out.match(/\{\{[a-z_]+\}\}/g);
  if (leftover) throw new Error(`unresolved prompt placeholders: ${[...new Set(leftover)].join(', ')}`);
  return out;
}

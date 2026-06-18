// lib/liveWatchScore.js — Live Watch Score formula (v4).
//
// Server-computed, DETERMINISTIC, no AI per tick. Distinct from the
// pre-match editorial Watch Score in lib/aiWatchScore.js, which is a
// model-generated forecast across 5 dimensions (STAKES/QUALITY/
// NARRATIVE/DRAMA/MOMENT). The live score is derived from match state
// (score, events, minute) plus per-match stakes and expectation context,
// and reflects what is unfolding on the pitch.
//
// Locked label: "Live · derived from match state".
//
// Inputs to computeLiveWatchScore (all derivable per match from
// match_events + match_statistics + ranking_entries + odds_markets,
// gathered by lib/captureLiveWatchScore at each tick):
//
//   v2 terms (state from accumulated events):
//     home_score, away_score, goals_count, lead_changes,
//     yellow_cards, red_cards, minute
//
//   v3 attacking_pts inputs (latest match_statistics snapshot):
//     home_total_shots, home_shots_on_goal,
//     away_total_shots, away_shots_on_goal
//
//   v4 stakes_pts inputs (per-team power score from team-power
//   ranking_entries on the is_current edition):
//     home_power_score, away_power_score
//
//   v4 expectation_gap_pts inputs (devigged pre-match win prob from
//   odds_markets WHERE market_type='match_winner' AND is_current=true;
//   stored as percentages 0-100, summing to 100 across home/draw/away):
//     home_win_pct, away_win_pct
//
// Output: { composite: number (0.0-10.0, one decimal), components: {...} }
//
// The components object is forensic detail of how the composite was
// assembled. Persisted alongside composite_score in
// match_watch_score_history so a future formula_version can be
// re-derived without re-querying source tables.
//
// ============================================================================
// v4 (2026-06-15) — stakes + expectation-gap added to v3 baseline
// ============================================================================
//
// v2 (2026-06-07) lowered BASE to 2.0 and trimmed lead_change/cards/
// late_drama weights to fix v1 saturation (46% of friendlies clipped at
// 10.0).
//
// v3 added attacking_pts: cap +2.0 driven by tempo (shots + 2*SOG, both
// sides), floor at tempo=20 (quiet halves get nothing), cap at tempo=70.
// Validated against a 41-match corpus + live-tick replay across 11
// matches (no early spikes, monotone non-decreasing modulo upstream API
// jitter, dullness guard holds at Russia-Trinidad max v3 = 4.0).
//
// v4 adds two new terms driven by per-match context that v3 cannot see:
//
//   stakes_pts (cap +1.5, decays from full at kickoff to 25% at FT):
//     max_power = MAX(home_power_score, away_power_score) from the
//     team-power ranking_entries edition. Spain playing is high stakes
//     regardless of opponent — that is what "WHO plays" means in the
//     brand model. Decays so a marquee blowout cannot stay inflated by
//     reputation as the match itself becomes the evidence.
//       raw = clip(0, 1.5, (max_power - 5) / 4 * 1.5)
//       weight(min) = max(0.25, 1 - 0.75 * min/90)
//       stakes_pts = raw * weight
//     Null power on either side -> stakes_pts = 0 (non-WC matches,
//     pre-tournament friendlies between off-list teams).
//
//   expectation_gap_pts (cap +2.2, intensifies late):
//     F = max(home_win_pct, away_win_pct) / 100 -- pre-match devigged
//     consensus from odds_markets. Below F=0.55 the match is too even
//     for "expectation" to be defined; the term is gated off. Otherwise
//     the term measures distance between pre-match expectation and
//     current state, with state_score = 0 (favorite ahead, script
//     unfolding), 1.0 (tied, favorite held), or 1.5 (favorite behind,
//     script flipped). Late minutes intensify the effect via
//     time_intensity ramping 0->1.0 between minute 30 and 90.
//       margin = F - 0.5
//       time_intensity = clip(0, 1.0, (minute - 30) / 60)
//       raw = margin * 2 * state_score * (1 + 1.5 * time_intensity)
//       expectation_gap_pts = clip(0, 2.2, raw)
//     Null win_pct -> expectation_gap_pts = 0 (older friendlies without
//     odds; degrades to v3 cleanly).
//
// Reference: design validated by /tmp/v3-dryrun/compute-v4-r2.mjs (n=44,
// 13 WC matches) with these locked knobs. Four-corner check passed
// (Germany-Curacao 8.7, Spain-Cape Verde 7.8, Russia-Trinidad 4.0,
// Romania-Wales 9.6).
//
// v2/v3 history rows STAY tagged formula_version='v2' for forensic. New
// live ticks score under v4. Phase 2 of the v4 ship backfills existing
// v2 rows under v4 (rewriting composite_score + formula_version='v4').
//
// ============================================================================
// v5 STAR-TERM LOGIC (landed 2026-06-18, dormant): match-level additive
// bonus computed from goal events. INERT BY DEFAULT: when the caller
// does not supply state.star_bump the new code path is byte-identical
// to v4. FORMULA_VERSION stays 'v4' on disk while a match is live and
// the writer (lib/captureLiveWatchScore.js) has not yet been wired to
// compute and pass the bump. The version + writer wiring + PROD
// backfill ship together in a separate, gated step during the
// no-live window after canada-vs-qatar (kickoff 2026-06-18 15:00 PT).
//
// computeStarBump(goalEvents):
//   Pure helper. Aggregates Goal events by player_api_id, excluding
//   own goals, missed penalties, and cancelled goals. Returns:
//     { bump: number, detail: [{player_api_id, player_name, goals, feat, bump}] }
//   Per-scorer scoring (additive across scorers):
//     2 goals      -> +0.3 (brace)
//     3+ goals     -> +0.8 (hat trick or more)
//     else         -> 0
//   v5 REPLAY (n=24, 2026-06-18) validated this term's effect: lifts
//   the three Case #4 inversion matches (Messi, Mbappe, Ayari) by
//   exactly their expected bumps while the soft ceiling absorbs the
//   bump on already-9.4+ matches (Havertz, Just) so nothing breaks 9.5.
//
// Star bump is applied to raw_total AFTER all v4 per-tick terms sum
// and BEFORE the soft ceiling, so the ceiling still binds and nothing
// exceeds 9.5. Star bump is MATCH-LEVEL: same constant on every tick.
//
// ============================================================================

export const FORMULA_VERSION = 'v4';

// v2 (and the v2 portion of v4)
const BASE = 2.0;

// v3 attacking
const ATTACKING_CAP    = 2.0;
const ATTACKING_FLOOR  = 20;   // tempo at which the term begins
const ATTACKING_RANGE  = 25;   // tempo range from floor to cap

// v4 stakes
const STAKES_CAP            = 1.5;
const STAKES_INPUT_FLOOR    = 5.0;  // power score at which raw = 0
const STAKES_INPUT_RANGE    = 4.0;  // power range to reach cap (floor + range = cap power)
const STAKES_DECAY_FLOOR    = 0.25; // weight at minute 90
const STAKES_DECAY_SPAN     = 0.75; // 1 - STAKES_DECAY_FLOOR

// v4 expectation gap
const GAP_CAP            = 2.2;
const GAP_F_THRESHOLD    = 0.55; // below this F, gap term is undefined
const GAP_INTENSITY_K    = 2.0;
const GAP_TIME_RAMP_START = 30;
const GAP_TIME_RAMP_FULL  = 90;

// v4 soft ceiling (Option B): a tanh-shaped knee at 8.5 with asymptote
// at 9.5. Below the knee, raw_total passes through unchanged so v2
// reproduction holds on the bottom 8.5 of the scale. Above the knee
// the curve saturates; 10 is unreachable. "No 10s, top around 9.5,
// 10 reserved for historic / never" per the locked brand spec.
//
//   raw <= 8.5         -> raw
//   raw  > 8.5         -> 8.5 + 1.0 * tanh(raw - 8.5)
//   asymptote          -> 9.5
//   continuous at knee -> slope 1 on both sides (tanh'(0) = 1)
//
// The [0,10] clip after this is now a floor-only safety net: nothing
// the formula produces ever exceeds 9.5, but the clip stays as belt-
// and-suspenders against future formula changes (and the lower bound
// 0 is still meaningful for malformed inputs).
const CEILING_KNEE           = 8.5;
const CEILING_SOFTMAX_EXCESS = 1.0;

// v5 star term constants (dormant until the writer wires star_bump).
const STAR_BUMP_BRACE     = 0.3;  // 2 goals by the same scorer
const STAR_BUMP_HAT_TRICK = 0.8;  // 3+ goals by the same scorer

function round1(n) {
  return Math.round(n * 10) / 10;
}

// v5 helper: pure aggregation of goal events into a match-level star
// bump. Excludes own goals, missed penalties, and cancelled goals from
// the per-scorer count. Multiple qualifying scorers add (two braces =
// +0.6; brace + hat trick = +1.1; etc). Returns {bump, detail} where
// detail is a deterministic-order array suitable for jsonb storage.
//
// Inputs are match_events rows (the same shape lib/captureLiveWatchScore.js
// already pulls per tick). Expected fields per event:
//   event_type, detail, team_side, player_api_id, player_name
//
// Returns { bump: 0, detail: [] } for empty / null input.
export function computeStarBump(goalEvents) {
  if (!Array.isArray(goalEvents) || goalEvents.length === 0) {
    return { bump: 0, detail: [] };
  }
  const counts = new Map();
  for (const e of goalEvents) {
    if (!e || e.event_type !== 'Goal') continue;
    if (e.detail === 'Missed Penalty') continue;
    if (e.detail === 'Own Goal')       continue;
    if (e.detail === 'Goal cancelled') continue;
    const pid = e.player_api_id;
    if (pid == null) continue;
    const existing = counts.get(pid) ?? { goals: 0, player_name: e.player_name ?? null };
    existing.goals++;
    if (existing.player_name == null && e.player_name) {
      existing.player_name = e.player_name;
    }
    counts.set(pid, existing);
  }
  let totalBump = 0;
  const detail = [];
  for (const [pid, info] of counts.entries()) {
    if (info.goals >= 3) {
      totalBump += STAR_BUMP_HAT_TRICK;
      detail.push({
        player_api_id: pid,
        player_name:   info.player_name,
        goals:         info.goals,
        feat:          'hat_trick',
        bump:          STAR_BUMP_HAT_TRICK,
      });
    } else if (info.goals === 2) {
      totalBump += STAR_BUMP_BRACE;
      detail.push({
        player_api_id: pid,
        player_name:   info.player_name,
        goals:         info.goals,
        feat:          'brace',
        bump:          STAR_BUMP_BRACE,
      });
    }
  }
  // Deterministic order: bump desc, then goals desc, then player_name asc.
  detail.sort((a, b) =>
    (b.bump - a.bump) ||
    (b.goals - a.goals) ||
    String(a.player_name ?? '').localeCompare(String(b.player_name ?? '')),
  );
  return { bump: round1(totalBump), detail };
}

// v5 helper: pure application of the star bump + soft ceiling pipeline
// to a v4-style pre-ceiling raw total. The full per-tick formula and
// the backfill share this single code path so on-disk validation
// exercises the same arithmetic both will run in production.
//
// Returns the fields downstream consumers (components blob + composite)
// derive from the post-bump raw_total. Pure; no I/O.
export function applyStarBumpAndCeiling(rawV4PreStar, starBump) {
  const bump = Number(starBump ?? 0) || 0;
  const raw_total = rawV4PreStar + bump;
  const ceiling_applied = raw_total > CEILING_KNEE;
  const post_ceiling = ceiling_applied
    ? CEILING_KNEE + CEILING_SOFTMAX_EXCESS * Math.tanh((raw_total - CEILING_KNEE) / CEILING_SOFTMAX_EXCESS)
    : raw_total;
  const clipped = Math.max(0.0, Math.min(10.0, post_ceiling));
  return {
    raw_total:       round1(raw_total),
    ceiling_applied,
    post_ceiling:    round1(post_ceiling),
    clipped:         round1(clipped),
    composite:       round1(clipped),
  };
}

// v3 attacking_pts. Returns 0 if either side's shot data is missing
// (older friendlies; pre-tournament fixtures where stats lag).
function attackingPtsRaw(state) {
  const hs = state.home_total_shots;
  const as = state.away_total_shots;
  if (hs == null || as == null) return 0;
  const hg = state.home_shots_on_goal ?? 0;
  const ag = state.away_shots_on_goal ?? 0;
  const tempo = (hs + as) + 2 * (hg + ag);
  const raw = (tempo - ATTACKING_FLOOR) / ATTACKING_RANGE;
  return Math.max(0, Math.min(ATTACKING_CAP, raw));
}

// v4 stakes_pts. Decays linearly from full at kickoff to 25% at FT.
// Null on either side falls back to whichever side has a value;
// both null returns 0.
function stakesPtsRaw(state) {
  let maxPower = -Infinity;
  if (state.home_power_score != null) maxPower = Math.max(maxPower, state.home_power_score);
  if (state.away_power_score != null) maxPower = Math.max(maxPower, state.away_power_score);
  if (maxPower === -Infinity) return 0;
  const minute = state.minute ?? 0;
  const raw_uncapped = Math.max(0, (maxPower - STAKES_INPUT_FLOOR) / STAKES_INPUT_RANGE) * STAKES_CAP;
  const raw_clipped = Math.min(STAKES_CAP, raw_uncapped);
  const weight = Math.max(STAKES_DECAY_FLOOR, 1 - STAKES_DECAY_SPAN * (minute / 90));
  return raw_clipped * weight;
}

// v4 expectation_gap_pts. Null win-prob on either side -> 0.
function expectationGapPtsRaw(state) {
  if (state.home_win_pct == null || state.away_win_pct == null) return 0;
  const homeF = state.home_win_pct / 100;
  const awayF = state.away_win_pct / 100;
  const F = Math.max(homeF, awayF);
  if (F < GAP_F_THRESHOLD) return 0;
  const favoriteIsHome = homeF >= awayF;
  const margin = F - 0.5;
  const home = state.home_score ?? 0;
  const away = state.away_score ?? 0;
  let stateScore;
  if (home === away) {
    stateScore = 1.0;
  } else {
    const favoriteAhead = favoriteIsHome ? home > away : away > home;
    stateScore = favoriteAhead ? 0 : 1.5;
  }
  const minute = state.minute ?? 0;
  const timeIntensity = Math.max(
    0,
    Math.min(1, (minute - GAP_TIME_RAMP_START) / (GAP_TIME_RAMP_FULL - GAP_TIME_RAMP_START)),
  );
  const raw = margin * 2 * stateScore * (1 + GAP_INTENSITY_K * timeIntensity);
  return Math.max(0, Math.min(GAP_CAP, raw));
}

export function computeLiveWatchScore(state) {
  const home         = state.home_score   ?? 0;
  const away         = state.away_score   ?? 0;
  const goalsCount   = state.goals_count  ?? 0;
  const leadChanges  = state.lead_changes ?? 0;
  const yellows      = state.yellow_cards ?? 0;
  const reds         = state.red_cards    ?? 0;
  const minute       = state.minute       ?? 0;

  const diff = Math.abs(home - away);

  // v2 terms (unchanged from v2 ship)
  const goals_pts = Math.min(2.0, goalsCount * 0.5);

  const closeness_raw  = diff === 0 ? 2.0 : diff === 1 ? 1.0 : 0.0;
  const closeness_ramp = Math.min(1.0, Math.max(0, minute / 30));
  const closeness_pts  = round1(closeness_raw * closeness_ramp);

  const lead_change_pts = Math.min(1.8, leadChanges * 0.6);
  const card_pts        = Math.min(2.0, yellows * 0.15 + reds * 1.5);
  const late_drama_pts  = (minute >= 75 && diff <= 1 && goalsCount > 0) ? 1.0 : 0.0;

  // v3 attacking (added in v4 ship; never shipped at v3-only)
  const attacking_pts = round1(attackingPtsRaw(state));

  // v4 stakes and expectation gap
  const stakes_pts          = round1(stakesPtsRaw(state));
  const expectation_gap_pts = round1(expectationGapPtsRaw(state));

  const raw_pre_star =
    BASE +
    goals_pts +
    closeness_pts +
    lead_change_pts +
    card_pts +
    late_drama_pts +
    attacking_pts +
    stakes_pts +
    expectation_gap_pts;

  // v5 star term (dormant by default). When state.star_bump is absent
  // or 0, this path is byte-identical to v4: bump = 0, raw_total =
  // raw_pre_star, post_ceiling/clipped/composite all match v4 exactly,
  // and the components blob omits the star_bump / star_detail keys so
  // its shape matches v4 byte-for-byte. The caller (the future
  // writer-wiring step) computes the bump from match_events via
  // computeStarBump and threads it into state; until then this
  // function continues to write v4 output for every tick.
  const starBumpRaw = Number(state.star_bump ?? 0) || 0;
  const starFires   = starBumpRaw > 0;
  const ceil = applyStarBumpAndCeiling(raw_pre_star, starBumpRaw);

  if (starFires) {
    return {
      composite: ceil.composite,
      components: {
        base:            BASE,
        goals:           round1(goals_pts),
        closeness:       round1(closeness_pts),
        lead_changes:    round1(lead_change_pts),
        cards:           round1(card_pts),
        late_drama:      round1(late_drama_pts),
        attacking:       round1(attacking_pts),
        stakes:          round1(stakes_pts),
        expectation_gap: round1(expectation_gap_pts),
        star_bump:       round1(starBumpRaw),
        star_detail:     Array.isArray(state.star_detail) ? state.star_detail : [],
        raw_total:       ceil.raw_total,
        ceiling_applied: ceil.ceiling_applied,
        post_ceiling:    ceil.post_ceiling,
        clipped:         ceil.clipped,
      },
    };
  }

  return {
    composite: ceil.composite,
    components: {
      base:            BASE,
      goals:           round1(goals_pts),
      closeness:       round1(closeness_pts),
      lead_changes:    round1(lead_change_pts),
      cards:           round1(card_pts),
      late_drama:      round1(late_drama_pts),
      attacking:       round1(attacking_pts),
      stakes:          round1(stakes_pts),
      expectation_gap: round1(expectation_gap_pts),
      raw_total:       ceil.raw_total,
      ceiling_applied: ceil.ceiling_applied,
      post_ceiling:    ceil.post_ceiling,
      clipped:         ceil.clipped,
    },
  };
}

// Walk events in chronological order and produce the cumulative state
// at the END of the given event list. Used by the replay script (which
// invokes it with a progressively-growing event slice per minute) and
// by the live capture path (lib/captureLiveWatchScore) to snapshot the
// current state at each poll-live tick.
//
// Event interpretation:
//   - Goal events increment the scoring side's count. Missed Penalty
//     (event_type='Goal', detail='Missed Penalty') is a CHANCE, NOT a
//     goal — does not change score.
//   - Own goals come through with team_side already set to the team
//     receiving credit (API-Sports convention). No special handling.
//   - Card events: Yellow Card increments yellows; Red Card or Second
//     Yellow card increments reds.
//   - Lead change is counted whenever the leading side changes
//     (including going from tied to leading, leading to tied via
//     equalizer, or one side's lead being reversed).
export function accumulateState(events) {
  let homeScore   = 0;
  let awayScore   = 0;
  let goalsCount  = 0;
  let leadChanges = 0;
  let yellows     = 0;
  let reds        = 0;
  let leadState   = 'tied';

  for (const e of events) {
    if (e.event_type === 'Goal' && e.detail !== 'Missed Penalty') {
      if (e.team_side === 'home')      homeScore++;
      else if (e.team_side === 'away') awayScore++;
      goalsCount++;

      const newLead =
        homeScore > awayScore ? 'home' :
        awayScore > homeScore ? 'away' : 'tied';
      if (newLead !== leadState) {
        leadChanges++;
        leadState = newLead;
      }
    } else if (e.event_type === 'Card') {
      if (e.detail === 'Yellow Card') yellows++;
      else if (e.detail === 'Red Card' || e.detail === 'Second Yellow card') reds++;
    }
  }

  return {
    home_score:   homeScore,
    away_score:   awayScore,
    goals_count:  goalsCount,
    lead_changes: leadChanges,
    yellow_cards: yellows,
    red_cards:    reds,
  };
}

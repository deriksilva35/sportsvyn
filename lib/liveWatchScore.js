// lib/liveWatchScore.js — Live Watch Score formula (v1).
//
// Server-computed, DETERMINISTIC, no AI per tick. Distinct from the
// pre-match editorial Watch Score in lib/aiWatchScore.js, which is a
// model-generated forecast across 5 dimensions (STAKES/QUALITY/
// NARRATIVE/DRAMA/MOMENT). The live score is derived from match state
// (score, events, minute) and reflects what's actually unfolding on
// the pitch — not what we predicted before kickoff.
//
// Locked label: "Live · derived from match state".
//
// Inputs to computeLiveWatchScore (all derivable from match_events
// rows where is_current=true plus the matches row):
//   home_score, away_score, goals_count, lead_changes,
//   yellow_cards, red_cards, minute
//
// Output: { composite: number (0.0-10.0, one decimal), components: {...} }
//
// The components object is forensic detail of how the composite was
// assembled (one row per input contribution). Persisted alongside
// the composite_score column in match_watch_score_history so a future
// formula_version can be re-derived without re-querying match_events.
//
// ============================================================================
// v2 CALIBRATION (2026-06-07) — saturation fix
// ============================================================================
//
// Phase 1 of the recalibration. v1 ran a 5.0 BASE which ate half the cap,
// leaving only 5 points of headroom for drama terms. The cap then bit hard:
// 46% of friendlies clipped at exactly 10.0, with no top-end resolution
// (a routine 1-1 friendly and a tournament classic both registered 10.0).
// A 2-1 with one lead change read 9.9. The diagnosis: drama terms had
// nothing to share the budget with, so they reliably overspent.
//
// v2 lowers BASE to 2.0, trims the lead_change and cards weights, and
// gates late_drama on goals_count > 0 (a scoreless match through 90' is
// the opposite of drama). Projected against 39 real matches before ship:
// zero 10.0 clips, zero 9.5+, anchor (denmark-ukraine 2-1, 1 lead change,
// late, 3 yellows) lands at 6.6, dull 0-0s sink to 4.0-4.6 (the bottom
// decile), top of the friendly set is 9.2 (a 1-1 with a red card and late
// drama firing). Full 0-10 range now actually used.
//
// v1 history rows stay tagged formula_version='v1' for forensic — they
// are NOT rewritten. New ticks score under v2 going forward.
//
// PHASE 2 candidates (not in this version):
//   · Stakes / competition_tier term — friendlies should sit lower as a
//     class so drama + stakes share the top half of the cap. Blocked on
//     the competition-tier field (task #109) and only adds discrimination
//     when the dataset has more than one tier — friendlies-only data
//     can't validate it.
//   · Closeness shape — currently caps tied-late at 2.0 closeness +
//     1.0 late_drama = 3.0 above BASE for any close match. Editorially
//     "tied at FT" and "back-and-forth ending 1-2" can score within
//     0.1 of each other (switzerland-australia 8.0 vs usa-germany 7.9
//     in the v2 projection) — defensible but a touch flat at the top.
//
// (Closeness shape locked at v1 levels: a tied or one-goal score at
// minute 5 is trivially close, so closeness_pts *= min(minute/30, 1)
// ramps to full strength by minute 30. Replaces a flawed v0 where every
// match read 7.0 at minute 0.)
//
// ============================================================================

export const FORMULA_VERSION = 'v2';

const BASE = 2.0;

export function computeLiveWatchScore(state) {
  const home         = state.home_score   ?? 0;
  const away         = state.away_score   ?? 0;
  const goalsCount   = state.goals_count  ?? 0;
  const leadChanges  = state.lead_changes ?? 0;
  const yellows      = state.yellow_cards ?? 0;
  const reds         = state.red_cards    ?? 0;
  const minute       = state.minute       ?? 0;

  const diff = Math.abs(home - away);

  // Goals: 0.5 per goal, caps at +2.0 (4+ goals saturates).
  const goals_pts        = Math.min(2.0, goalsCount * 0.5);

  // Closeness: +2.0 tied, +1.0 within one goal, 0 otherwise — RAMPED with
  // minute so the bonus has its full weight only after the match has had
  // time to develop. At kickoff the score is trivially 0-0 (tied) and
  // doesn't reflect any actual drama; by minute 30+ a tied or one-goal
  // game IS meaningfully close. Ramp factor: min(minute/30, 1).
  // Encodes the real truth: tightness matters more the later it persists.
  const closeness_raw    = diff === 0 ? 2.0 : diff === 1 ? 1.0 : 0.0;
  const closeness_ramp   = Math.min(1.0, Math.max(0, minute / 30));
  const closeness_pts    = round1(closeness_raw * closeness_ramp);

  // Lead changes: +0.6 per lead change (taking lead from tied,
  // equalizing from behind, or reversing the lead), caps at +1.8 (3+
  // changes saturates). v2 trim: per-change 0.8→0.6 and cap 2.0→1.8.
  const lead_change_pts  = Math.min(1.8, leadChanges * 0.6);

  // Cards: yellows mild (0.15 each), reds dramatic (1.5 each), caps at
  // +2.0. v2 trim: yellow 0.2→0.15 (a foul-fest isn't a "good watch")
  // and cap 3.0→2.0 so a card-heavy game can't dominate the drama mix.
  const card_pts         = Math.min(2.0, yellows * 0.15 + reds * 1.5);

  // Late drama: +1.0 if minute >= 75 AND score within one goal AND
  // there has been at least one goal. The goals_count > 0 gate is the
  // Phase 1 fix for scoreless-matches-flooring-too-high — a 0-0 through
  // 90' is the OPPOSITE of drama (closeness already credits "tied"
  // structurally), so the late_drama bonus would double-count nothing
  // happening. With this gate, a tense 0-0 reads as "tense" (via
  // closeness) but not "dramatic late" (no late_drama bump).
  const late_drama_pts   = (minute >= 75 && diff <= 1 && goalsCount > 0) ? 1.0 : 0.0;

  const raw_total = BASE + goals_pts + closeness_pts + lead_change_pts + card_pts + late_drama_pts;
  const clipped   = Math.max(0.0, Math.min(10.0, raw_total));
  const composite = round1(clipped);

  return {
    composite,
    components: {
      base:         BASE,
      goals:        round1(goals_pts),
      closeness:    round1(closeness_pts),
      lead_changes: round1(lead_change_pts),
      cards:        round1(card_pts),
      late_drama:   round1(late_drama_pts),
      raw_total:    round1(raw_total),
      clipped:      round1(clipped),
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Walk events in chronological order and produce the cumulative state
// at the END of the given event list. Used by the replay script (which
// invokes it with a progressively-growing event slice per minute) and
// by the live capture path (lib/captureLiveWatchScore — Slice 2) to
// snapshot the current state at each poll-live tick.
//
// Event interpretation:
//   - Goal events increment the scoring side's count. Missed Penalty
//     (event_type='Goal', detail='Missed Penalty') is a CHANCE, NOT a
//     goal — does not change score.
//   - Own goals come through with team_side already set to the team
//     receiving credit (API-Sports convention). No special handling.
//   - Card events: Yellow Card ↑ yellows; Red Card / Second Yellow
//     card ↑ reds.
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

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
// v1 KNOWN BOUNDARIES (accepted; not blind tuning targets — re-evaluate
// after capturing 20+ matches of real per-minute data in match_watch_score_history)
// ============================================================================
//
// (1) Closeness ramps to full strength by minute 30.
//     `closeness_pts *= min(minute/30, 1)`. Encodes the real truth: a tied
//     or one-goal score at minute 5 is trivially close (the match just
//     started), while at minute 30+ the tightness has been sustained
//     long enough to genuinely register as drama. Replaces a flawed v0
//     where every match read 7.0 at minute 0 because 0-0 = tied = max
//     closeness bonus from kickoff.
//
// (2) Tied 0-0 with cards in mid-1H reads ~7-8 (mild over-read).
//     By the time closeness has fully ramped at minute 30+, a tense 0-0
//     with 3-4 yellows scores around 7.4-7.8. Editorially this is "good
//     not great" — defensible for a tactically tight game, slightly
//     high for a flat one. Differentiation across full match remains
//     correct (USA-Senegal 10.0 > Col-CRC 8.6 > Can-UZB 7.6 in v1 replay).
//     v2 may down-weight cards or minute-gate them — but only with
//     real captured data, not blind tuning now.
//
// (3) Composite clips at 10.0 (ceiling resolution loss accepted).
//     USA-Senegal v1 raw_total reaches 11.2 (2 equalizers + late drama
//     + 5 goals + cards) — clipped to 10.0. Two matches that both clip
//     can't be distinguished at the ceiling. The cap is the point: 10
//     means "as gripping as it gets right now"; differentiation past
//     that is left to memory and pull quotes, not a number.
//
// (4) "Live now" framing — composite drops after the result is locked in.
//     Col-CRC peaks at 10.0 at minute 75 (2-1, close, late drama bonus
//     firing) and drops to 8.6 at FT after the late 3-1 winner — correct
//     by design. The composite reads "how dramatic right now", not "how
//     watchable this match has been overall". The sparkline preserves
//     the peak visually so the dramatic stretch stays legible.
//
// ============================================================================

export const FORMULA_VERSION = 'v1';

const BASE = 5.0;

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

  // Lead changes: +0.8 per lead change (taking lead from tied,
  // equalizing from behind, or reversing the lead), caps at +2.0.
  const lead_change_pts  = Math.min(2.0, leadChanges * 0.8);

  // Cards: yellows mild (0.2 each), reds dramatic (1.5 each), caps at +3.0.
  const card_pts         = Math.min(3.0, yellows * 0.2 + reds * 1.5);

  // Late drama: +1.0 if minute >= 75 AND score within one goal.
  const late_drama_pts   = (minute >= 75 && diff <= 1) ? 1.0 : 0.0;

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

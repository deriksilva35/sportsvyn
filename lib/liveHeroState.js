// lib/liveHeroState.js — pure-data helpers for LiveHero's polling state.
// Kept separate from components/match/LiveHero.js so the merge logic can
// be unit-tested in Node without React/JSX compilation.

// Per-field coalesce of the two transient clock fields (minute,
// status_short) against the prior client state. API-Sports intermittently
// returns null for fixture.status.elapsed and/or fixture.status.short on
// live ticks — especially around substitution clusters and stoppages —
// and syncFixture writes those nulls straight into the /api/sync/fixture
// response. Without this merge, a single null tick would clobber the
// known-good clock value in client state and blank the period line until
// the next non-null poll.
//
// The last-good value already lives in prev (state survives across the
// 60s poll cycle — same component instance, same useState slot).
// Coalescing here is the cheapest fix that touches neither syncFixture
// nor the data layer. A real non-null value from data (e.g. '2H' or a
// real elapsed minute) still overwrites normally — the `??` operator
// only ignores null/undefined (NOT 0, so minute=0 at kickoff is
// preserved correctly).
export function coalesceClock(prev, data) {
  return {
    ...prev,
    ...data,
    minute:       data?.minute       ?? prev?.minute       ?? null,
    status_short: data?.status_short ?? prev?.status_short ?? null,
  };
}

# Next block — Mon/Tue 17-18 Aug 2026

Scheduled work, not deferred work. Post-season debt lives in
`post-season-debt.md`; this is the near-term queue, and items leave it by being
built rather than by being re-argued.

Every item below was ruled on during the 13-15 Aug preseason slates, with the
evidence that produced it. Quiet slate days were chosen deliberately: three of
these touch the poller, and the last two weekends demonstrated what shipping
poller changes into a live slate costs.

---

## 1. Kickoff-derived provider-date targeting

**Why.** `slateDatesForProvider` currently returns `[etDay, etDay+1]` — a
tonight-only measure from 13 Aug, when three of six games were invisible because
the provider indexes by UTC and we asked for the ET day. It works, and it
**doubled the score-sweep cost**: every sweep now spends 2 requests instead of 1.

**What it costs today.** The 22 Aug slate (10 games, 10-hour spread) prices at
2,212 requests against a 2,000 cap. See item 4.

**The fix.** Derive the exact UTC dates from the stored kickoffs of the games
actually in the window, rather than assuming two. Most days that is one date,
which returns the sweep to one request and 22 Aug to ~1,326.

**Spec inputs banked from the slates:** 20-minute lag tolerance between kickoff
and the provider reporting live (Thu 9 min, Fri 16 min — it is not a constant);
the first status transition is noisy and should not be trusted alone.

## 2. Store `startTimeTBD`

**Why.** CFBD publishes an explicit `startTimeTBD` boolean. `sync.js:272` already
reads it and passes it to `mapStatus`, but we do not store it — so at
window-computation time only `kickoff_at` and `status` exist, which is why
`isTbdPlaceholder` infers from a midnight-ET kickoff instead.

**What it costs today.** Nothing measurable: the heuristic finds exactly the
flagged population (week 4: 48 flagged at source, 42 of our 71 FBS rows; the gap
is the FBS filter). CFBD's convention is genuinely midnight Eastern and shifts
04:00Z→05:00Z at the DST boundary, which the heuristic handles.

**The fix.** Store the flag at ingest; have `isTbdPlaceholder` prefer it and keep
the heuristic as fallback for rows already stored. The flag is CFBD's own
statement rather than a convention they can change without telling us.

## 3. Premature-final settling

**Why.** Cleveland at Chicago, 15 Aug: the provider called the game final at
**10-27**, reverted to live, and it finished **10-34**. A touchdown was scored
after the feed said the game was over.

**What it costs today.** `final_seen_at` is set-once so a flap cannot *lose* a
claim — but the same property means a premature final, if a hot sweep catches it,
**locks in a stale score permanently**. On 15 Aug no sweep ran inside that
window. That was sweep timing, not the guard working.

This is the mirror of the TEN-at-SF failure the stamp was built for: that one
lost a real final, this one can capture a fake one.

**The fix (ruled 15 Aug).** Require `final` on **two consecutive hot sweeps**
before the stamp latches. **Vetoed stamps are logged** — a single-sweep final
that reverts should leave a trace, or the settling rule becomes invisible and
nobody can tell it from a feed that never flapped.

## 4. Flip the 22 Aug cap assertion

**Why.** `preseasonWindow.test.mjs` currently carries a deliberately WEAK
assertion — `total > DAILY_REQUEST_CAP` — pinning that we know 22 Aug prices over
the cap at 2,212.

**The fix.** Item 1 returns that day to ~1,326. When it lands, flip the assertion
to `total < DAILY_REQUEST_CAP`. If item 1 slips past Wednesday, the fallback is
raising the cap to ~2,400 (still under the 2,880 runaway line).

---

## Also open, not scheduled

- **Count-claim gate is ADVISORY** (`COUNT_CLAIMS_BLOCKING = false`, flipped
  15 Aug). Its `[brief-gate] count_claims` log lines accumulate the real
  false-positive/true-positive ledger. Revisit blocking with that data — three
  FP classes in one evening (score margin, player line scoped to a team,
  "extra points" as a compound noun) against one known TP.
- **CFB has no detail path.** `gameDetail.js` is API-Sports and NFL-only. Scores
  and status only for college. Post-Week-0, own provider recon.
- **nflverse CC-BY attribution** is on the Daily's reveal page. It is owed
  anywhere else `nfl_player_seasons` data surfaces.

# Page `.catch(() => null)` audit (3 Nov)

Why: the lobby outage was a swallowed throw (`app/page.js`, `app/games/page.js`),
invisible in app_errors and Vercel logs. Searched `app/**/page.js|layout.js` for
`await ... .catch(() => null|[])`.

Fixed in this PR (routed through `pageCatch`, lib/games/lobbySection.js, service
`page:<route>:<read>`): the page's MAIN read in results/[game]/[contest], weekly (currentContest),
leagues (myLeagueCards), leagues/[id] (leagueDetail x2, leagueTable), six, october, run,
epl-weekly-5 (currentGameweek, epl5View), nba/game, mlb/game, market/props (x2),
survivor, mlb/bracket, nfl/standings, ucl/standings, epl/standings, pickem/[sport] (x2).
The lobby itself (app/page.js, app/games/page.js) logs per module and at the page.

Filed, not fixed now (all `.catch` swallow, no log):
- auth() fallbacks, deliberately optional (signed out is the safe default): app/results/[game]/[contest]/page.js:59, app/rankings/page.js:19, app/rankings/teams/page.js:31, app/results/draft/page.js:17, app/nfl/game/[slug]/page.js:99, app/cfb/game/[slug]/page.js:120, app/mlb/game/[slug]/page.js:104, app/leagues/[id]/page.js:62, app/scores/page.js:210
- Small optional side reads (the page renders without them): app/weekly/page.js:156,174,217,375; app/leagues/page.js:54; app/leagues/[id]/page.js:99,100; app/player/[slug]/page.js:112-113; app/nfl|cfb game propsSlate (145 / 167), cfb box score :240; app/mlb/game/[slug]/page.js:129; app/draft/page.js:122,158,162,209,215; app/draft/game/page.js:43; app/draft/game/[id]/page.js:74; app/run/board/page.js:36,40,42; app/october/page.js n/a; app/october/board/page.js:31,33,40,44; app/epl-weekly-5/board/page.js:23,25,26; app/mock/nfl/page.js:36; app/mock/nba/page.js:41; app/j/[code]/page.js:43; app/page.js:422 (AP ranks); app/pickem/[sport]/page.js:105
- Admin-only: app/admin/signups/page.js:184,187; app/admin/morning-email/page.js:25,26
- Should be next: run/board and october/board (currentRunRound / currentOctoberDay :31-36 are main reads, left because two more shaped fallbacks sit beside them) and draft/page.js:122-215. Cheap, same one-line change.
- `.catch` inside `Promise.all([...])` on app/page.js:351-418 (front page modules) are per-module optional reads; not touched. They deserve the same helper in a follow-up.

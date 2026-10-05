# Widget feed v1

The iOS widgets read two endpoints. The droplet repo serves the data and the Mac builds the widgets.

- Shape (pure): `lib/widget/shape.js`
- Schema, as data, with a validator: `lib/widget/schema.js`
- Reads: `lib/widget/reads.js`
- Auth: `lib/widget/session.js`
- Fixtures: `docs/widgets/fixtures/*.json`. They are the real serializer's output on stub inputs (`scripts/widget-fixtures/inputs.mjs`), written by `node scripts/widget-fixtures.mjs`. `lib/widget/feed.test.mjs` fails if they drift from the code or stop validating.

## Endpoints

| | |
|---|---|
| `GET /api/widget/v1` | The feed. Optional `?teams=<id>,<id>,...` (up to 4 team ids from the picker). When `teams` is absent, the teams block shows the reader's follows. |
| `GET /api/widget/v1/teams` | The team picker: followed teams first, then every other team. |

## Auth

```
Authorization: Bearer <session token>
```

The token is the app's existing Auth.js session token, the value of the cookie the web view already holds:

- `__Secure-authjs.session-token` on https (sportsvyn.com)
- `authjs.session-token` on http (local dev only)

There is no new token type. The widget is the same session as the app. It expires when that session expires (the `sessions.expires` column, 30 days rolling by Auth.js default), and signing out deletes it. The cookie also works in place of the header, so the web view can call the endpoint as itself.

### What the Mac does (the contract only; building it is the Mac's job)

1. **Read the token from the web view.** Use `WKWebsiteDataStore.default().httpCookieStore.getAllCookies` and take the cookie named `__Secure-authjs.session-token` for the domain `sportsvyn.com`.
2. **Store it in the shared app group,** readable by the widget extension. Use a Keychain item with an access group shared by the app and the extension (preferred), or the app group's `UserDefaults(suiteName:)`. Store the expiry with it (`HTTPCookie.expiresDate`).
3. **Refresh the stored copy** on every app foreground and whenever the web view finishes a navigation. Auth.js extends the session on use, which can rotate the cookie's expiry. If the cookie is gone, the reader signed out: delete the stored copy and call `WidgetCenter.shared.reloadAllTimelines()`.
4. **The widget sends it** as `Authorization: Bearer <value>`. Do not send the `SportsvynApp/1` User-Agent token from the extension. That token belongs to the web view, and the proxy's shell-cookie rule matches on it. The rule is harmless here (it only adds a cookie to the response), but it has no reason to fire.
5. **Never log the token.** The server never logs it either. The rate limiter keys on a hash of the token, not the token itself.

### States (every one is HTTP 200)

| `state` | When | Data |
|---|---|---|
| `ok` | A live session on an account that has passed the age screen | Filled |
| `signed_out` | No token, a malformed one, an unknown one, an expired session, or a deleted user | Empty, and `cta` is `{ "label": "Sign in", "href": "/signin" }` |
| `age_required` | A live session on an account that has not passed the 13+ age screen (`hasPassed`, lib/auth/ageGateDb.js) | Empty, and `cta` is `{ "label": "Confirm your age", "href": "/age" }` |

The only non-200 response is **429** `{ "v": 1, "state": "rate_limited", "generatedAt", "retryAfter" }` with a `Retry-After` header. It is sent when one token makes more than 20 requests in 60 s (in memory, per server instance). On a 429, keep the last good timeline and try again after `Retry-After`.

"Empty" means the keys are always present: `yourMove: {count: 0, nextLock: null}`, `games: []`, `daily: null`, `teams: []`, `inYourGames: []`. The widget decodes one shape for every state.

## Caching and refresh

- Responses carry `Cache-Control: private, max-age=60` and `Vary: Authorization, Cookie`. The picker uses `max-age=300`. **Nothing is ever public.** The URL is the same for every reader, so a shared cache would hand one reader's answer to another, or serve a stored "sign in" to a signed-in widget.
- The server builds the feed **at most once per 60 s per user** (for each `teams` selection). Asking more often than that returns the same payload, with the same `generatedAt`.
- **Refresh cadence advice.** Ask for a timeline reload about every 15 minutes in general. While anything is live (`teams[].status == "live"` or `inYourGames[].status == "live"`) or urgent (`games[].urgent`), ask every 5 minutes. iOS budgets the reloads anyway, so treat these as requests. Draw countdowns locally from `lockAt` / `closesAt` / `startAt` with `Text(date, style: .relative)` or `.timer`, so the widget never needs a reload just to tick. After a pick in the app, call `WidgetCenter.shared.reloadAllTimelines()`. The server memo can then serve data up to 60 s old, which is fine.

## Conventions

- **Times**: UTC ISO 8601 strings ending in `Z` (`2026-10-04T17:55:00.000Z`) everywhere. The widget formats them in the device's zone.
- **Links** (`href`): site paths (`/pickem/nfl`). Prefix them with `https://sportsvyn.com` (or the app's deep-link scheme). A link is whole or null. The server never clips one.
- **Strings** are short and clipped with `…` at their caps (below).
- **Teams are never nested objects.** A row carries a team's id, abbreviation, short name and two colours as flat fields.
- **Colours** are `#RRGGBB`, or null.
- **Size**: under 8 KB. A test fills every list to its cap and every string to its maximum, and asserts the result (it measures 6,819 bytes, with every optional field present and six `via` kinds on every stake). The busy fixture is 4,471 bytes.
- `v` is the version. A breaking change ships as `/api/widget/v2`. v1 only ever **adds**: optional fields (absent when empty, never null) and new values in enum-like lists such as `via`. So ignore unknown keys, and treat an unknown `via` value as "a game you're in".
- **Optional fields** (marked *opt* below) are absent rather than null when there is nothing to say. Decode them as optionals.

## `GET /api/widget/v1`: field by field

Types: `string(n)` means at most n characters. `?` means the value can be null. Every key is always present.

### Envelope

| Field | Type | |
|---|---|---|
| `v` | `1` | Version |
| `state` | `"ok" \| "signed_out" \| "age_required"` | See States |
| `generatedAt` | ISO Z | When the server built this payload (memo-aware) |
| `cta` | `{label: string(24), href: string(64)}?` | Null when `ok` |
| `yourMove` | object | |
| `games` | array, max 6 | |
| `nextOpening` | object *opt* | Absent when no door is ahead |
| `daily` | object? | |
| `teams` | array, max 4 | |
| `inYourGames` | array, max 4 | |

### `yourMove`

Every game the reader can act on right now: open, with something left for them to do. This is the Play tab's YOUR MOVE (lib/games/playLobby.js `yourMove`), The Daily included.

| Field | Type | |
|---|---|---|
| `count` | int | How many games are waiting on the reader |
| `nextLock` | `{game: string(40), sport: string(12)?, at: ISO Z}?` | The soonest lock among them. `sport` is `"NFL"`, `"MLB"`, ... or `"ALL SPORTS"` for The Daily |

### `games[]`

The YOUR MOVE games first, in lock order. Then the reader's other open or in-play games, in the Play tab's group order. The Daily is left out (it has its own block), and so are settled games and games whose door has not opened.

The list can be empty on a quiet day. The next door is then in the top-level `nextOpening` (below), never a row here.

| Field | Type | Example |
|---|---|---|
| `key` | string(32) | `"nfl-pickem"`: stable per game, so use it to pick an icon |
| `sport` | string(12) | `"NFL"` |
| `name` | string(40) | `"Pick'em"` |
| `title` | string(40)? | `"Week 5"` |
| `line` | string(40)? | `"9 of 14 picked"`: the lobby's status line, with no time in it |
| `count` | int? | Picks or slots still to make (`total - done` from the game's own progress). Null for games that have no count |
| `lockAt` | ISO Z? | The next lock the reader can still beat. Null when nothing is left to beat (in play, grading) |
| `urgent` | bool | **Urgent** = the game is open, the reader still has something to do on it, and `lockAt` is at most **60 minutes** away. A finished card is never urgent |
| `href` | string(64)? | `"/pickem/nfl"` |

### `nextOpening` *opt*

The soonest game door that has not opened yet. The Daily is never included, because it opens every midnight. The key is **present whenever a door is ahead and absent when there is none** (never null). It sits at the top level, not as a `games[]` row (sun-25). Draw it on a quiet day when `games` is empty, e.g. "NBA Pick'em · opens Tue 6:00 AM", with `opensAt` formatted in the device's zone. No word in it carries a time or a zone.

| Field | Type | Example |
|---|---|---|
| `key` | string(32) | `"nba-pickem"` |
| `sport` | string(12) | `"NBA"` |
| `name` | string(40) | `"Pick'em"` |
| `title` | string(40)? | `"Next slate"` |
| `opensAt` | ISO Z | `"2026-10-20T10:00:00.000Z"` |
| `href` | string(64)? | `"/pickem/nba"` |

### `daily`

| Field | Type | |
|---|---|---|
| `state` | `"play" \| "in-progress" \| "done" \| "none"` | `none` = no board today |
| `open` | bool | The board can still be played (`play` or `in-progress`, and before `closesAt`) |
| `closesAt` | ISO Z? | Today's board closes (midnight ET) |
| `streak` | int | The reader's current Daily streak (streakLeaderboard) |
| `href` | string(64) | `"/daily/board"` |

### `teams[]`

The reader's followed teams (or the `?teams=` selection). The order is: live, then a final from the last 18 h, then the soonest kickoff, then teams with no game. Each row is oriented to that team. Covered leagues: nfl, cfb, mlb, nba, epl.

| Field | Type | Example |
|---|---|---|
| `teamId` | int | `4` |
| `team` | string(6) | `"BUF"` |
| `teamName` | string(24)? | `"Bills"` |
| `league` | string(8)? | `"nfl"` |
| `color`, `altColor` | `#RRGGBB`? | Badge colours |
| `gameId` | int? | The focus game. Null when the team has no game in range |
| `home` | bool? | The team is the home side |
| `oppId` | int? | |
| `opp` | string(6)? | `"NYJ"` |
| `oppName` | string(24)? | `"Jets"` |
| `status` | `"pre" \| "live" \| "final" \| "none"` | |
| `score`, `oppScore` | int? | The team's and the opponent's. Null before a game, never 0 |
| `clock` | string(16)? | Live: `"Q3 7:22"`, `"HT"`, `"OT 3:10"`, `"Top 7th"`, `"Q4 5:55"`. Final: `"Final"`, `"F/OT"`, `"F/10"`. Null before |
| `winProb` | int 0-100? | **This team's** live win probability. Shown only while live, only when the stored number is under 5 minutes old, and **only where the phone switch is on for that league**: `lib/winprob/display.js` `PHONE`, which is the same switch the Live Activity obeys. Ruling sun-23: **NFL on, CFB off** until CFB's sealed re-score passes. That map ships on branch `winprob-phone-nfl`. Until it merges, the switch is the old env flag, which is off, so expect null |
| `startAt` | ISO Z? | Kickoff of the focus game |
| `nextAt` | ISO Z? | Kickoff of the team's next game after the focus game |
| `result` | `"W" \| "L" \| "T"`? | Finals only |
| `href` | string(64)? | The game page, or the team page when there is no game |
| `oppColor`, `oppAltColor` | `#RRGGBB` *opt* | The opponent's badge colours (sun-24) |
| `possession` | string(6) *opt* | Live football only: who has the ball, as badge letters (`"BUF"`). It comes from the play feed, using the Scores card's own drive-strip derivation (sun-24) |
| `fieldPos` | string(12) *opt* | Live football only: the ball's spot, `"NYJ 35"` (on the Jets' side) or `"50"`. After a turnover or a score, before the next down is known, it is where the last snap was (sun-24) |

### `inYourGames[]`

Games from the last 12 h, games live now, and games in the next 24 h where the reader has **something riding**. That comes from their picks and lineups only:

| `via` | Source |
|---|---|
| `pickem` | A Pick'em pick on this game: NFL, CFB, NBA daily (stakeForMatches, lib/gridiron/scoresV2.js) |
| `series` | A Series Pick'em pick on the series these two clubs are playing (currentSeriesBoard). `pick` is the club picked |
| `weekly` | Weekly players in this game (stakeForMatches) |
| `draft` | Players from the reader's ranked Draft roster (the best-ball six that count) whose club plays in this game (currentDraftContest + liveEntryRows, sun-24) |
| `october` | An October player whose slot names this game (currentOctoberDay) |
| `run` | A Run player whose club plays in this game (currentRunRound) |
| `six` | A Tonight's Six player whose slot names this game (currentSixNight) |

A follow alone does not count (that is the teams block), and neither does an alert. Live games come first, then games by kickoff.

| Field | Type | Example |
|---|---|---|
| `gameId` | int | |
| `league` | string(8) | `"nfl"` |
| `away`, `home` | string(6) | `"NYJ"`, `"BUF"` |
| `awayColor`, `homeColor` | `#RRGGBB`? | |
| `awayScore`, `homeScore` | int? | Null before kickoff |
| `status` | `"pre" \| "live" \| "final"` | |
| `clock` | string(16)? | Same as `teams[].clock` |
| `startAt` | ISO Z? | |
| `pick` | string(6)? | The abbreviation the reader picked |
| `pickState` | `"pending" \| "winning" \| "losing" \| "tied" \| "won" \| "lost" \| "push"`? | |
| `players` | int | The reader's players in this game, across Weekly, The Draft, October, The Run and Tonight's Six |
| `points` | number? | The Weekly players' fantasy points so far (1 dp). Null when the reader has no Weekly player in this game. The other games score on their own pages |
| `via` | array of `"pickem" \| "series" \| "weekly" \| "draft" \| "october" \| "run" \| "six"` | Why this game is listed, in that fixed order; at least one. New values may be added |
| `topPlayer` | string(24) *opt* | The reader's highest-scoring **Weekly or Draft** player in this game, by points so far. Before kickoff it is the first one listed (sun-24) |
| `href` | string(64)? | The game page |

## `GET /api/widget/v1/teams`

```json
{ "v": 1, "state": "ok", "generatedAt": "…Z", "cta": null,
  "followed": [ { "id": 4, "abbr": "BUF", "name": "Bills", "league": "nfl", "color": "#00338D", "altColor": "#C60C30" } ],
  "teams":    [ … every other team in nfl, cfb, mlb, nba, epl, by league then name … ] }
```

The auth and states are the same as the feed. Signed-out and age-pending readers still get the full `teams` list (it is public), with `followed: []`, so a picker can draw before sign-in. The response is about 30 KB (355 teams today), so cache it in the extension. Pass the chosen ids to the feed as `?teams=`.

## Examples

See `docs/widgets/fixtures/`:

| File | What it shows |
|---|---|
| `signed-in-busy.json` | Every list full, plus every optional field: `nextOpening` (NBA opening night), two urgent games, a live NFL team with a win probability (switch on), a live MLB team, a fresh CFB final, live and final stakes, and PHI@MIL in your games via a series pick, an October bat and a Run arm; BUF carries `possession`, `fieldPos` and `oppColor`/`oppAltColor`, and NYJ@BUF has a Draft player as `topPlayer` |
| `signed-in-quiet.json` | Nothing to do: The Daily done, `games` empty, `nextOpening` = The Weekly, one team with its next game a week out |
| `live-game.json` | One live game, Q3 7:22, followed and picked, with Weekly players in it |
| `signed-out.json` | The sign-in state |
| `age-pending.json` | The age-screen state |
| `teams.json` | The picker |

A trimmed `signed-in-busy`:

```json
{
  "v": 1, "state": "ok", "generatedAt": "2026-10-04T17:30:00.000Z", "cta": null,
  "yourMove": { "count": 6, "nextLock": { "game": "Pick'em", "sport": "NFL", "at": "2026-10-04T17:55:00.000Z" } },
  "games": [ { "key": "nfl-pickem", "sport": "NFL", "name": "Pick'em", "title": "Week 5", "line": "9 of 14 picked",
               "count": 5, "lockAt": "2026-10-04T17:55:00.000Z", "urgent": true, "href": "/pickem/nfl" } ],
  "daily": { "state": "play", "open": true, "closesAt": "2026-10-05T04:00:00.000Z", "streak": 12, "href": "/daily/board" },
  "teams": [ { "teamId": 4, "team": "BUF", "teamName": "Bills", "league": "nfl", "color": "#00338D", "altColor": "#C60C30",
               "gameId": 9101, "home": true, "oppId": 25, "opp": "NYJ", "oppName": "Jets", "status": "live",
               "score": 24, "oppScore": 17, "clock": "Q3 7:22", "winProb": 81, "startAt": "2026-10-04T16:00:00.000Z",
               "nextAt": "2026-10-11T17:30:00.000Z", "result": null, "href": "/nfl/game/nyj-at-buf-2026-10-04" } ],
  "inYourGames": [ { "gameId": 9101, "league": "nfl", "away": "NYJ", "home": "BUF", "awayColor": "#125740", "homeColor": "#00338D",
                     "awayScore": 17, "homeScore": 24, "status": "live", "clock": "Q3 7:22", "startAt": "2026-10-04T16:00:00.000Z",
                     "pick": "BUF", "pickState": "winning", "players": 2, "points": 31.2, "via": ["pickem", "weekly"], "href": "/nfl/game/nyj-at-buf-2026-10-04" } ]
}
```

## Known gaps in v1

- `points` is Weekly-only. Draft, October, The Run and Tonight's Six points are on their own pages (`topPlayer` does rank Draft players by points).
- `winProb` stays null until `winprob-phone-nfl` merges (NFL on, CFB off).

## Web to native: when to reload (sun-24)

The web view tells the native side when the widgets are stale, using the same channel as the shell's haptic and share messages (`lib/shell/bridge.js`): `window.postMessage(msg, '*')`. Messages are sent only in shell mode (the `sv_shell=sim-app` cookie) and only when a native container is present (`window.Capacitor` or `window.webkit.messageHandlers`). The native WKUserScript that already listens for `haptic` / `share` receives these the same way.

```js
{ type: 'picksChanged', game: 'pickem' | 'series' | 'weekly' | 'draft' | 'october' | 'run' | 'six' | 'epl5' | 'daily' }
{ type: 'sessionChanged', signedIn: true | false }
```

- **`picksChanged`** is posted after a save **the server accepted**, never on a refusal or a network failure. The doors:
  - Pick'em (NFL, CFB and NBA boards)
  - Series Pick'em
  - Weekly: a lineup save, a save where one slot was refused at its kickoff but the rest stored, and the confirm button
  - The Draft: when the room completes
  - October, The Run, Tonight's Six and EPL Weekly 5: a slot saved or cleared
  - The Daily: lock-in, both the reveal and the grade

  On receipt: `WidgetCenter.shared.reloadAllTimelines()`. The feed may serve its 60 s memo once, which is fine.
- **`sessionChanged`** is posted when the shell header's account check (`/api/me`, once per page load) differs from the last value this device stored (`localStorage['sv_widget_session']`). That covers sign-in, sign-out and a different account. It is also posted on the very first check after install. On receipt, re-read the session cookie into the app group (or delete the stored token when `signedIn` is false), then reload all timelines.

## Widget to app: "Follow on Lock Screen" (sun-24)

For a live game, the widget can open the game with two extra params:

```
https://sportsvyn.com<href>?sv_la=1&sv_match=<gameId>
```

`lib/shell/laDeepLink.js` `laDeepLinkPath(href, gameId)` builds exactly this. In the app shell, when the game is **live** and `sv_match` is that page's game, the game page opens its alerts sheet so the existing "Live on lock screen" row is in front of the reader. It **does not start** a Live Activity; the row's own tap does. The params are then removed from the address bar. They are ignored outside the shell, on a different game's page, before kickoff, after the final, and for leagues with no Live Activity (NBA).

/**
 * /games/how-it-works - the explainer. STATIC, SIGNED OUT, NO USER DATA.
 *
 * NOTHING ON THIS PAGE READS THE DATABASE OR THE SESSION, deliberately: it
 * is the one Games surface a stranger can be handed cold, and a page that
 * has to resolve a viewer before it can say what the games are is a page
 * that can 500 on a stranger. force-static, not force-dynamic like /games.
 *
 * NO NEW COPY IS INVENTED HERE (relay 5 item 5). Every string is either
 * ratified in this relay, lifted verbatim from an existing surface, or
 * absent - see THE THREE-STEP GAP below.
 *
 * WHERE EACH LINE COMES FROM:
 *   cadence pills, taglines, intro   relay 5, verbatim
 *   the Draft/Weekly/Pick'em steps   relay 5b, verbatim
 *   the Daily's three steps          components/daily/DailyRoom.js's own
 *                                    .dsteps block, word for word
 *   grading lines                    each game's own "How it works" module
 *                                    (app/weekly, app/draft, app/daily) and
 *                                    PickemGrade's mathline
 *   the closing line                 /games' own two ratified phrases -
 *                                    "one handle, every board" (the
 *                                    Today's-boards pill) and "unranked ·
 *                                    nothing here counts" (the Practice row)
 *
 * THE GAME LIST IS GENERATED (sun-16 D). The page used to open on "Three
 * weekly games and one every day" and stop there - true in August, and
 * blind to October, The Run, Series Pick'em, Tonight's Six and EPL Weekly 5
 * once they shipped. The list, the count in the intro and the description
 * now come from lib/games/playRegistry.js (listedGames, each entry's `about`
 * and `season`), so a game added there is a game this page names, and a
 * pulled one (Survivor, behind its flag) is a game it does not. A game whose
 * season is over is still listed, marked SEASONAL. The per-game rules below
 * stay here, where they have always lived.
 *
 * THE STEPS SHIPPED IN TWO PASSES, and it is worth knowing why. Relay 5
 * built the page with only the Daily's three, because the Daily's were the
 * only step copy that existed anywhere in this codebase and writing the
 * other nine would have been inventing them. Relay 5b supplied the nine.
 * They are transcribed here exactly as given and asserted verbatim in the
 * tests, which is the whole point of having waited for them.
 */

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { GAME_NAMES } from '@/lib/games/lobby';
import { DAILY_V2_PATH } from '@/lib/daily/boardShape';
import { listedGames } from '@/lib/games/playRegistry';
import { introLine, gameGroups } from '@/lib/games/howItWorks';
import '../games.css';
import './howItWorks.css';

export const dynamic = 'force-static';
// HOURLY, so the SEASONAL marks turn over with the calendar without a deploy.
// Still static to every reader: a stranger is served the cached page.
export const revalidate = 3600;

export const metadata = {
  title: 'How the games work - Sportsvyn',
  description: introLine(listedGames()),
};

// THE CADENCE PILL, verbatim from the relay. Three of the four share one
// line because they share one clock: Tuesday open, first kickoff locks.
const WEEKLY_CADENCE = 'Weekly · opens Tuesday, locks at first kickoff';
// sat-5 Y4: the board opens at 00:00 ET (seasonBoardEditions.js); "every
// morning" was the 10:00 ET push, not the board.
const DAILY_CADENCE = 'Daily · a new board at midnight ET';

/**
 * THE FOUR SECTIONS, in the order item 2 fixes: Draft, Weekly, Pick'em,
 * Daily. That is deliberately NOT the lobby's own order (Daily first) -
 * this page runs heaviest-commitment to lightest, which is how somebody
 * deciding what to try reads it.
 *
 * Every section carries three steps. `steps` may be null - the component
 * renders nothing rather than a placeholder - but nothing uses that now.
 */
const SECTIONS = [
  {
    key: 'draft',
    name: GAME_NAMES.draft,
    cadence: WEEKLY_CADENCE,
    tagline: 'Pick your seat, draft your team, compete against the field.',
    steps: [
      { n: 1, t: 'Seat', d: 'Take one of twelve. You choose again every week.' },
      { n: 2, t: 'Draft', d: 'Eight rounds against the room, thirty seconds a pick, no bench.' },
      { n: 3, t: 'Score', d: 'Best six of your eight count, against every other drafter that week.' },
    ],
    graded: 'Best ball, PPR. Best six of your eight count.',
    rule: 'A game not final 48 hours after the week settles is void - its players score 0. A stat correction within 7 days of a game re-grades the week.',
    href: '/draft',
    cta: 'Take a seat',
  },
  {
    key: 'weekly',
    name: GAME_NAMES.weekly,
    cadence: WEEKLY_CADENCE,
    tagline:
      'Pick any player at each position. Make your best roster, no draft, '
      + 'no salary, and see where it stacks up against the field that week.',
    steps: [
      { n: 1, t: 'Pick', d: 'Six slots: QB, RB, WR, TE and two flex. Any player, nobody is taken.' },
      { n: 2, t: 'Edit', d: 'No clock. Change it until first kickoff; whatever is saved is your entry.' },
      { n: 3, t: 'Grade', d: 'Tuesday you are graded against the best six that pool could have made.' },
    ],
    graded: 'PPR, worst pick dropped.',
    rule: 'A game not final 48 hours after the week settles is void - its players score 0. A stat correction within 7 days of a game re-grades the week.',
    href: '/weekly',
    cta: 'Set your six',
  },
  {
    key: 'pickem',
    name: GAME_NAMES.pickem,
    cadence: WEEKLY_CADENCE,
    // sun-16 D: "No odds" was untrue - the board shows the line (step 1).
    tagline: 'Pick the winners, straight up.',
    steps: [
      { n: 1, t: 'Call', d: 'Every game on the board, straight up. The spread is shown, never required.' },
      { n: 2, t: 'Lock', d: 'Each game locks at its own kickoff. Change a pick until then.' },
      // sun-16 D: "across both sports" - Pick'em runs in four now.
      { n: 3, t: 'Tally', d: 'One season table, ranked on correct percentage.' },
    ],
    graded: 'Right or wrong. A tie counts for nobody.',
    rule: 'A game not final 48 hours after the board settles is void and counts for nobody. A score correction within 7 days of a game re-grades the board.',
    href: '/pickem',
    cta: 'Make your picks',
  },
  {
    key: 'daily',
    name: GAME_NAMES.daily,
    cadence: DAILY_CADENCE,
    tagline: 'One season from NFL history. Twelve teams. Eight slots. Four regrets.',
    // THESE ARE THE SEASON BOARD'S STEPS, AND THEY ARE THIS PAGE'S OWN.
    // They used to be lifted verbatim from components/daily/DailyRoom.js
    // and pinned against it. That coupling was correct while this section
    // pointed at /daily; it is wrong now that href is DAILY_V2_PATH,
    // because DailyRoom is v1's room and describes a different game.
    // Uncoupled deliberately - see howItWorks.test.mjs, which now asserts
    // these against this file alone and guards DailyRoom's own three
    // separately.
    steps: [
      { n: 1, t: 'Deal', d: 'Twelve teams from one past season' },
      // sat-5 Y3: the old step said opening a team commits you. Opening a
      // team commits nothing; clearing a slot gives the team back
      // (seasonBoardPlay.js), which is what the in-game rules card says.
      { n: 2, t: 'Place', d: 'Open any team and put a player in a slot. Clear it to get the team back' },
      { n: 3, t: 'Skip', d: 'Four teams go unused, and you choose which' },
    ],
    graded: 'Season fantasy points, PPR, against the board. Nothing is dropped.',
    // THE DAILY'S HOUSE RULES (sat-5 Y2-Y8), each one what the code does
    // today: cards from boardGenerator.js (CARD_MIN/CARD_MAX), the window
    // from seasonBoardEditions.js, the clock from boardShape.js
    // (DAILY_ROUND_SECONDS), picks held client-side until /api/daily/board/run,
    // scoring from lib/fantasy/scoring.js (season totals carry no fumbles),
    // ties from seasonBoardLeaderboards.js todayLeaderboard (dense rank on
    // score; ORDER BY matched DESC, completed_at ASC).
    rules: [
      'Each team card holds 4 to 6 players.',
      'A new board opens every day at midnight ET. One attempt per board.',
      'The clock is 3 minutes from Start, kept on the server.',
      'Your picks stay on your device until you lock in. Close the tab and they are lost; a run that never locks in is a DNF.',
      'Kickers score 3 per field goal and 1 per extra point. There is no fumble penalty.',
      'Ties: the same score shares a place, so every perfect board is 1st. Within a tie, the earliest lock-in lists first.',
    ],
    href: DAILY_V2_PATH,
    cta: 'Play now',
  },
];

export default async function HowItWorksPage() {
  const games = listedGames();
  const groups = gameGroups(games);
  return (
    <>
      <GlobalHeaderServer />
      <main className="lob hiw" data-surface="ink">
        <div className="lob-head">
          <h1 className="lob-title">How the games work</h1>
          <p className="lob-sub">{introLine(games)}</p>
        </div>

        {/* EVERY GAME, FROM THE REGISTRY. A game out of season is listed and
            says so - a stranger reading in May should still learn October. */}
        <nav className="hiw-list" aria-label="Every game">
          {groups.map((grp) => (
            <div className="hiw-grp" key={grp.sport} data-sport={grp.sport}>
              <h2 className="hiw-grp-h">{grp.label}</h2>
              {grp.games.map((g) => (
                <Link className="hiw-game" key={g.key} href={g.href} data-game={g.key}
                  data-seasonal={g.seasonal ? '1' : '0'}>
                  <span className="hiw-mk" aria-hidden="true">{g.mark}</span>
                  <span className="hiw-gt">
                    <b>{g.name}</b>
                    <small>{g.about}</small>
                    {g.seasonal ? (
                      <span className="hiw-season">Seasonal{g.seasonWords ? ` · runs ${g.seasonWords}` : ''}</span>
                    ) : null}
                  </span>
                  <span className="hiw-chev" aria-hidden="true">&rsaquo;</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <h2 className="hiw-rules-h">The rules, game by game</h2>

        {SECTIONS.map((s) => (
          <section className="hiw-sec" key={s.key}>
            <span className="hiw-cad">{s.cadence}</span>
            <h2 className="hiw-name">{s.name}</h2>
            <p className="hiw-tag">{s.tagline}</p>

            {s.steps && (
              <div className="dsteps">
                {s.steps.map((st) => (
                  <div className="dstep" key={st.n}>
                    <div className="n">{st.n}</div>
                    <div className="t">{st.t}</div>
                    <div className="d">{st.d}</div>
                  </div>
                ))}
              </div>
            )}

            <p className="hiw-graded"><b>Graded</b> {s.graded}</p>
            {s.rules ? (
              <ul className="hiw-rules">
                {s.rules.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
            {/* THE VOID AND RE-GRADE RULE (sat-5, rulings 2 and 3) - the three
                football games only; the Daily has no live games to wait on. */}
            {s.rule && <p className="hiw-graded"><b>Late games</b> {s.rule}</p>}
            <Link className="hiw-go" href={s.href}>{s.cta} &rarr;</Link>
          </section>
        ))}

        <p className="hiw-foot">
          One handle, every board. Practice is unranked - nothing there counts.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

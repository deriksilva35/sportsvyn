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
import '../games.css';
import './howItWorks.css';

export const dynamic = 'force-static';

export const metadata = {
  title: 'How the games work - Sportsvyn',
  description:
    'Three weekly games and one every morning. All free, an email and a handle.',
};

// THE CADENCE PILL, verbatim from the relay. Three of the four share one
// line because they share one clock: Tuesday open, first kickoff locks.
const WEEKLY_CADENCE = 'Weekly · opens Tuesday, locks at first kickoff';
const DAILY_CADENCE = 'Daily · a new board every morning';

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
      { n: 1, t: 'Seat', d: 'Take one of twelve. It is yours all season.' },
      { n: 2, t: 'Draft', d: 'Eight rounds against the room, thirty seconds a pick, no bench.' },
      { n: 3, t: 'Score', d: 'Best six of your eight count, against every other drafter that week.' },
    ],
    graded: 'Best ball, PPR, drop worst.',
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
    href: '/weekly',
    cta: 'Set your six',
  },
  {
    key: 'pickem',
    name: GAME_NAMES.pickem,
    cadence: WEEKLY_CADENCE,
    tagline: 'Pick the winners. No odds, no problem.',
    steps: [
      { n: 1, t: 'Call', d: 'Every game on the board, straight up. The spread is shown, never required.' },
      { n: 2, t: 'Lock', d: 'Each game locks at its own kickoff. Change a pick until then.' },
      { n: 3, t: 'Tally', d: 'One season table across both sports, ranked on correct percentage.' },
    ],
    graded: 'Right, wrong, push.',
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
      { n: 2, t: 'Commit', d: 'Open a team and you must take somebody' },
      { n: 3, t: 'Skip', d: 'Four teams go unused, and you choose which' },
    ],
    graded: 'Season fantasy points, PPR, against the board.',
    href: DAILY_V2_PATH,
    cta: 'Play now',
  },
];

export default async function HowItWorksPage() {
  return (
    <>
      <GlobalHeaderServer />
      <main className="lob hiw" data-surface="ink">
        <div className="lob-head">
          <h1 className="lob-title">How the games work</h1>
          <p className="lob-sub">
            Three weekly games and one every morning. All free, an email and a handle.
          </p>
        </div>

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

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
 *   cadence pills, taglines, intro   the relay, verbatim
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
 * THE THREE-STEP GAP, stated rather than filled. Item 2 asks each section
 * for three numbered steps "taken from docs/design if present or from the
 * email copy". docs/design has no step copy for the Draft, the Weekly or
 * Pick'em - only the Daily has three numbered steps anywhere in this
 * codebase. Writing the other nine would be inventing copy, which item 5
 * forbids, so those three sections ship without a step block and the Daily
 * ships with its real one. Paste the email copy and they go in as-is.
 */

import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { GAME_NAMES } from '@/lib/games/lobby';
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
 * `steps` is null where the copy does not exist yet. See the file header.
 */
const SECTIONS = [
  {
    key: 'draft',
    name: GAME_NAMES.draft,
    cadence: WEEKLY_CADENCE,
    tagline: 'Pick your seat, draft your team, compete against the field.',
    steps: null,
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
    steps: null,
    graded: 'PPR, worst pick dropped.',
    href: '/weekly',
    cta: 'Set your six',
  },
  {
    key: 'pickem',
    name: GAME_NAMES.pickem,
    cadence: WEEKLY_CADENCE,
    tagline: 'Pick the winners. No odds, no problem.',
    steps: null,
    graded: 'Right, wrong, push.',
    href: '/pickem',
    cta: 'Make your picks',
  },
  {
    key: 'daily',
    name: GAME_NAMES.daily,
    cadence: DAILY_CADENCE,
    tagline: 'One season from NFL history. Twelve teams. Nine slots. Three regrets.',
    // VERBATIM from components/daily/DailyRoom.js's .dsteps block.
    steps: [
      { n: 1, t: 'Draft', d: 'Six players, any position mix' },
      { n: 2, t: 'Reveal', d: 'Sim replays the week at midnight ET' },
      { n: 3, t: 'Guess', d: 'Name the season for a bonus' },
    ],
    graded: 'PPR, worst pick dropped.',
    href: '/daily',
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

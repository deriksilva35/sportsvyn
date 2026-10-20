// app/coins/rules/page.js - THE OFFICIAL RULES (coins-2 B7), from "Sportsvyn
// Weekly Drawing - Official Rules v0.1" (19 Oct 2026; docs/design/coins-drum-spec.md).
// The point table is rendered from lib/coins/rules.js, so the page and the meter
// cannot disagree. Bracketed placeholders are for counsel and stay visible until
// they are filled. Hyphens only. 404 unless COINS=on.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { coinsEnabled } from '@/lib/coins/mint';
import { POINTS, POINTS_PER_COIN, WEEK_CAP, MIN_ENTRANTS } from '@/lib/coins/rules';
import { resolveShellMode } from '@/lib/shell/shell';
import '@/components/coins/coins.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Weekly Drawing - Official Rules - Sportsvyn' };

const TABLE = [
  ['First public game played in a week (any game)', `${POINTS.firstPlay} (one coin on the spot)`],
  ['Each further public contest completed and settled', POINTS.settled],
  ['Finish in the top 25% of a settled contest', POINTS.top25],
  ['Finish in the top 10% of a settled contest', POINTS.top10],
  ['Finish 1st, 2nd or 3rd in a settled contest', POINTS.top3],
  ['Win a settled contest outright', POINTS.win],
  ['Play in 3 consecutive weeks (awarded at the third)', POINTS.streak3],
];

export default async function RulesPage() {
  if (!coinsEnabled()) notFound();
  const isShell = await resolveShellMode().catch(() => false);
  return (
    <div data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <main className="cn cn-rules">
        <div className="cn-top"><Link href="/coins">The Drum</Link><h1 className="cn-mono">OFFICIAL RULES</h1><span /></div>
        <p><b>Sportsvyn Weekly Drawing - Official Rules v0.1</b></p>

        <h2>1. Sponsor, no purchase necessary, eligibility</h2>
        <p>The Sportsvyn Weekly Drawing is a free sweepstakes run by [LEGAL ENTITY NAME] (&quot;Sportsvyn&quot;), [MAILING ADDRESS]. NO PURCHASE OR PAYMENT OF ANY KIND IS NECESSARY TO ENTER OR WIN. A purchase does not improve your chances of winning. Nothing in Sportsvyn is sold that affects the drawing: the Arcade Pass or any other paid feature never grants coins, entries or better odds.</p>
        <p>Open to legal residents of the 50 United States and the District of Columbia who are 18 years of age or older at the time of entry. Players aged 13 to 17 may play Sportsvyn games and earn coins but may not win prizes; coins they hold are not entered. Void in [STATES COUNSEL EXCLUDES, IF ANY] and wherever prohibited by law. Employees of Sportsvyn and their immediate family or household members are not eligible to win.</p>
        <p>Apple Inc. is not a sponsor of, and is not involved in, this drawing in any way. Prizes from Amazon, Visa and other brands are not sponsored by those brands.</p>
        <p>One Sportsvyn account per person. Entries from additional, automated or shared accounts are void.</p>

        <h2>2. Contest period and weekly schedule</h2>
        <p>The program runs in weekly drawing periods. Each week opens Tuesday at 9:00:00 am Pacific Time and closes the following Tuesday at 8:59:59 am Pacific Time (the &quot;Close&quot;). The drawing for a week takes place at the Close, and the next week opens at the same moment.</p>
        <p>The first week opens [START DATE]. Sportsvyn may end the program at any time by posting a notice in the app and on sportsvyn.com at least 7 days before the last drawing. Coins held when the program ends are entered in that final drawing as described in Section 4.</p>
        <p>Sportsvyn&apos;s server clock is the official timekeeper. Times shown in the app are converted to the player&apos;s local time for convenience only.</p>

        <h2>3. How coins are earned (the coin meter)</h2>
        <p>Players earn coins only by playing Sportsvyn&apos;s free public games. Coins are never sold, cannot be bought, transferred, traded or exchanged for cash, and have no monetary value. A coin is one entry in the weekly drawing (Section 4).</p>
        <p>Play fills a coin meter with arcade points. Every {POINTS_PER_COIN} arcade points mints one coin into the player&apos;s hand. The meter&apos;s progress carries from week to week; coins do not (Section 4). Arcade points are awarded as follows for each public contest that settles during a week:</p>
        <table>
          <thead><tr><th scope="col">Event</th><th scope="col">Arcade points</th></tr></thead>
          <tbody>{TABLE.map(([e, p]) => <tr key={e}><td>{e}</td><td>{p}</td></tr>)}</tbody>
        </table>
        <p>Public games that earn arcade points: The Daily, The Weekly, The Draft (weekly), Pick&apos;em, The Run and October (MLB postseason), and each new public game Sportsvyn announces as eligible (for example NBA and EPL games) from the week it is announced. Practice modes, mock drafts, private leagues and any contest with fewer than {MIN_ENTRANTS} entrants do not earn arcade points.</p>
        <p>A player can earn at most {WEEK_CAP} coins in one week; arcade points beyond that still carry in the meter. Sportsvyn may change the point values for future weeks by updating these rules before that week opens; changes never apply to a week already in progress.</p>

        <h2>4. How to enter: dropping coins into drums</h2>
        <p>Each week Sportsvyn posts one or more prize drums in The Drum screen (for example &quot;2 x $25 gift cards&quot;, &quot;5 x $10 gift cards&quot;, &quot;1 x Sportsvyn cap&quot;), each with the number of prizes in it. Every coin a player drops into a drum is one entry in that drum&apos;s drawing.</p>
        <p>Players drop coins themselves, at any time before the Close, in any split: all coins in one drum, or spread across several. Players may drop some coins and keep the rest in hand to drop later in the same week. A coin dropped into a drum cannot be moved or taken back.</p>
        <p>At the Close, any coin still in a player&apos;s hand is dropped automatically into the lowest-value drum of that week, so no earned coin goes unentered. Coins never carry over: every coin is entered in the week it was earned, by the player or by this rule.</p>
        <p>An eligible player (Section 1) needs no other action to enter. There is no mail-in or alternate method of entry because no purchase or payment is ever required to play or to earn coins.</p>

        <h2>5. Prizes, odds, winner selection</h2>
        <p>The prizes for a week are those posted in The Drum when the week opens, and they do not change during the week. A typical week offers 2 x $25 digital gift cards, 5 x $10 digital gift cards and 1 item of Sportsvyn merchandise, with a total approximate retail value of about $120. Sportsvyn may post more, fewer or different prizes for a future week. Gift cards are delivered as digital codes by email; merchandise ships free within the United States.</p>
        <p>Odds of winning a given prize depend on the number of coins dropped into that drum by all players. Each coin is one chance; a player&apos;s odds for a drum are their coins in it divided by all coins in it. The app shows the live coin count for every drum.</p>
        <p>Winners are selected at the Close by a random drawing from the coins in each drum. The drawing uses a published seed (for example the final score of the week&apos;s last NFL game) so that anyone can reproduce the shuffle; Sportsvyn publishes the seed, the coin count and the number of players for each drum with the results. One coin wins one prize; a player can win more than one prize in a drum only if drawn separately for each, and a winning coin is removed before the next prize is drawn.</p>
        <p>Prizes are not transferable and have no cash alternative, except that Sportsvyn may substitute a prize of equal or greater value if a posted prize becomes unavailable.</p>

        <h2>6. Winner notification, verification, fulfilment, taxes</h2>
        <p>Winners are told in the app, by push notification and by email to the address on their Sportsvyn account at the Close. Results for every drum are posted in The Drum for all players to see.</p>
        <p>Before a first prize is delivered, a winner confirms their legal name, email address, state of residence and that they are 18 or older. A merchandise winner also provides a US shipping address. A winner who does not confirm within 14 days, provides false information, or is found ineligible forfeits the prize, and Sportsvyn may redraw it from the same drum.</p>
        <p>Gift cards are sent through a third-party rewards platform within 7 business days of verification, most within minutes. Merchandise ships within 21 days of verification.</p>
        <p>Prizes are taxable income. A winner whose prizes from Sportsvyn total $600 or more in a calendar year must provide a completed IRS Form W-9 before further prizes are delivered, and Sportsvyn will issue a Form 1099 for that year. Winners are responsible for all taxes on prizes.</p>

        <h2>7. Conduct, voids, limits, general conditions, privacy</h2>
        <p>Sportsvyn may void coins and entries earned by cheating, collusion, multiple accounts, bots, scripts or any breach of the Sportsvyn Terms of Service, and may remove the player from the program. Coins earned in a contest that is voided under that game&apos;s rules are not minted.</p>
        <p>If a drawing cannot run at the Close for technical reasons, it runs as soon as the fault is fixed using the coins as they stood at the Close. If a week&apos;s prizes cannot be awarded because of fraud, a technical failure or causes beyond Sportsvyn&apos;s control, Sportsvyn may cancel that week&apos;s drawing and announce it in the app; coins from that week are entered in the next drawing.</p>
        <p>By earning coins a player agrees to these rules and to the decisions of Sportsvyn, which are final. Winners agree that Sportsvyn may post their Sportsvyn handle and state as a winner. Personal information collected for verification and delivery is used only for this program and handled under the Sportsvyn Privacy Policy at [PRIVACY POLICY URL].</p>
        <p>A list of each week&apos;s winners (handles and prizes) is shown in The Drum for 90 days after that drawing. These rules are governed by the laws of the State of California. Questions: [CONTACT EMAIL].</p>
      </main>
      {!isShell && <SiteFooter />}
    </div>
  );
}

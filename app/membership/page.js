/**
 * /membership — now a NOTICE, not a checkout.
 *
 * Everything this page used to price is free for the 2026 season, so the plan
 * grid, the Stripe checkout forms and the tier copy are gone from it.
 *
 * THE ROUTE STAYS, and that was the choice over a 404. It is in sitemap.xml at
 * priority 0.6, linked from six surfaces (nav, /signin, /account, /sim/account,
 * the exposure report, the rail cards), and the App Store listing may reference
 * it. A 404 on a linked, indexed route is a worse signal than an honest page,
 * and this is one file to revert when pricing returns.
 *
 * THE PLUMBING BEHIND IT IS UNTOUCHED: lib/stripe/plans.js, the checkout action,
 * both webhooks and the memberships table all still exist. Two live passes
 * (expiring 2027-02-16) still resolve; deleting purchase code while somebody
 * holds an entitlement is how you break their account, not how you stop
 * charging.
 *
 * SHELL (App Store Guideline 3.1.1): this page IS the purchase mechanism, so it
 * must not exist inside the native container. Suppressing the links that reach it
 * is not sufficient - capacitor.config.ts sets allowNavigation to sportsvyn.com,
 * so a reviewer can type the URL or follow a deep link. The route itself
 * redirects to /sim before rendering anything, which means no price, no plan
 * name, and no checkout form is ever constructed in the shell.
 */

import { redirect } from 'next/navigation';
import Wordmark from '@/components/gridiron/Wordmark';
import { resolveShellMode } from '@/lib/shell/shell';
import '@/components/gridiron/gridiron.css';
import './membership.css';

// The redirect reads the sv_shell cookie, so it must not be statically rendered.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Membership - Sportsvyn',
  description: 'Everything on Sportsvyn is free for the 2026 season.',
};

export default async function MembershipPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  // 3.1.1 STILL APPLIES even with nothing to buy: the rule is about the native
  // container never reaching a purchase surface, and this route is still that
  // route in every reviewer's notes and every deep link. Redirecting costs
  // nothing and keeps the guarantee unconditional.
  if (await resolveShellMode(params)) redirect('/sim');

  return (
    <div className="mbr" data-surface="ink">
      <header className="mbr-head">
        <Wordmark href="/sim" />
        <span className="mbr-tag"><b>Membership</b></span>
      </header>

      <main className="mbr-wrap">
        <div className="mbr-kicker">Membership</div>
        <h1 className="mbr-h1">Everything is free for the 2026 season.</h1>
        <p className="mbr-lede">
          Mock drafts, the custom console, 14 and 16-team rooms, superflex, the Draft
          Tracker and the Exposure Report are all free with an account. So are The
          Daily, The Weekly, Pick &rsquo;em and The Draft. There is nothing to buy
          here right now.
        </p>
        <p className="mbr-lede">
          If you already hold a Draft Pass it keeps working and nothing changes for
          you &mdash; you are simply no longer paying for anything anyone else is not
          also getting.
        </p>
        <div className="mbr-links">
          <a className="mbr-back" href="/sim">Start a mock draft &rarr;</a>
          <a className="mbr-back" href="/games">See the games &rarr;</a>
        </div>
      </main>
    </div>
  );
}

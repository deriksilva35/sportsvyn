/**
 * /membership — the checkout/pitch surface. INK product surface (data-surface=
 * "ink"), house typography. Not a PAPER editorial page. Server component: each
 * plan is a form posting the startCheckout server action (bound to the plan key),
 * which creates a Stripe Checkout Session and redirects. Promo codes are entered
 * on Stripe's checkout page (allow_promotion_codes=true), so here we only note it.
 */

import Wordmark from '@/components/gridiron/Wordmark';
import { startCheckout } from '@/app/actions/membership';
import { PLANS } from '@/lib/stripe/plans';
import { MEMBERSHIP_TIERS } from '@/components/sim/membershipCopy';
import '@/components/gridiron/gridiron.css';
import './membership.css';

export const metadata = {
  title: 'Membership - Sportsvyn',
  description: 'Draft tools now, the Suite from Week 1. Draft Pass, Football Suite, or Founding.',
};

export default async function MembershipPage({ searchParams }) {
  const params = (await searchParams) ?? {};
  const showError = params.error === 'checkout';
  return (
    <div className="mbr" data-surface="ink">
      <header className="mbr-head">
        <Wordmark href="/sim" />
        <span className="mbr-tag"><b>Membership</b></span>
      </header>

      <main className="mbr-wrap">
        <div className="mbr-kicker">Membership</div>
        {showError && (
          <div className="mbr-error" role="alert">
            We couldn&rsquo;t start checkout just now. Please try again in a moment.
          </div>
        )}
        <h1 className="mbr-h1">Draft tools now. The Suite from Week 1.</h1>
        <p className="mbr-lede">
          Start with the Draft Pass for the tools, step up to the Football Suite for
          the season, or lock the Founding rate. Everything the free tier previews,
          unlocked.
        </p>

        <div className="mbr-grid">
          {PLANS.map((p) => {
            const tier = MEMBERSHIP_TIERS[p.key] ?? { tagline: '', features: [], footnote: '' };
            return (
              <form key={p.key} action={startCheckout.bind(null, p.key)} className={`mbr-card${p.featured ? ' mbr-card--feature' : ''}`}>
                {p.featured && <div className="mbr-badge">The Suite</div>}
                <div className="mbr-plan">{p.label}</div>
                <div className="mbr-price">
                  <span className="mbr-amt">{p.price}</span>
                  <span className="mbr-cad">{p.cadence}</span>
                </div>
                <div className="mbr-blurb">{tier.tagline}</div>
                <ul className="mbr-feats">
                  {tier.features.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <button type="submit" className="mbr-cta">Choose {p.label}</button>
                {tier.footnote && <div className="mbr-foot">{tier.footnote}</div>}
              </form>
            );
          })}
        </div>

        <p className="mbr-code">
          Have a full-access code? Enter it at checkout - the code field is on the
          Stripe payment page, and a 100%-off code completes with no card.
        </p>
        <p className="mbr-fine">
          Secure checkout by Stripe. Cancel anytime from your account. By subscribing
          you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
        </p>
      </main>
    </div>
  );
}

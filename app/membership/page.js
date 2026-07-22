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
import '@/components/gridiron/gridiron.css';
import './membership.css';

export const metadata = {
  title: 'Membership — Sportsvyn',
  description: 'Unlimited drafts, custom rosters, and the Sportsvyn board.',
};

export default function MembershipPage() {
  return (
    <div className="mbr" data-surface="ink">
      <header className="mbr-head">
        <Wordmark href="/sim" />
        <span className="mbr-tag"><b>Membership</b></span>
      </header>

      <main className="mbr-wrap">
        <div className="mbr-kicker">Membership</div>
        <h1 className="mbr-h1">Members get more.</h1>
        <p className="mbr-lede">
          Unlimited drafts. Custom rosters. 14+ teams and superflex. The Sportsvyn
          board. Everything the free tier previews, unlocked.
        </p>

        <div className="mbr-grid">
          {PLANS.map((p) => (
            <form key={p.key} action={startCheckout.bind(null, p.key)} className={`mbr-card${p.key === 'founding' ? ' mbr-card--feature' : ''}`}>
              {p.key === 'founding' && <div className="mbr-badge">Founding</div>}
              <div className="mbr-plan">{p.label}</div>
              <div className="mbr-price">
                <span className="mbr-amt">{p.price}</span>
                <span className="mbr-cad">{p.cadence}</span>
              </div>
              <div className="mbr-blurb">{p.blurb}</div>
              <button type="submit" className="mbr-cta">Choose {p.label}</button>
            </form>
          ))}
        </div>

        <p className="mbr-code">
          Have a full-access code? Enter it at checkout — the code field is on the
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

/**
 * /terms — Terms of Service. PAPER-surface prose, server component (no state).
 * Short and honest: editorial/entertainment product, "explain, don't pick"
 * (no picks or betting advice), membership billed via Stripe, cancel anytime,
 * no warranty, California law. Mirrors /privacy chrome + legal.css.
 */

import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import '@/components/legal.css';

export const metadata = {
  title: 'Terms of Service — Sportsvyn',
  description: 'The terms for using Sportsvyn and the Draftvyn iOS app.',
};

export default function TermsPage() {
  return (
    <div data-surface="paper" className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link href="/" className="legal-wordmark" aria-label="Sportsvyn home">
            SPORTSV<span className="lw-y">Y</span>N
          </Link>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-prose">
          <p className="legal-eyebrow">Terms</p>
          <h1>Terms of Service</h1>
          <p className="legal-effective">Effective July 20, 2026</p>
          <p className="legal-lede">
            These terms cover your use of Sportsvyn (sportsvyn.com) and the Draftvyn
            iOS app. By using the product, you agree to them.
          </p>

          <h2>What Sportsvyn is</h2>
          <p>
            Sportsvyn is an <strong>editorial and entertainment product</strong>. We
            explain the game — analysis, context, and coverage. We <strong>explain,
            we don&rsquo;t pick.</strong> Nothing on Sportsvyn is a betting tip, a
            wagering recommendation, a prediction sold as advice, or gambling
            guidance of any kind, and nothing here should be relied on for placing
            bets. Any numbers, rankings, or model outputs are for context and
            entertainment only.
          </p>

          <h2>Your account</h2>
          <p>
            You sign in with a magic link or Sign in with Apple. You are responsible
            for the activity on your account and for keeping access to your email
            secure. Don&rsquo;t misuse the service — no scraping, no attempts to break
            or overload it, and no unlawful use.
          </p>

          <h2>Membership and billing</h2>
          <p>
            Some features require a paid membership. Memberships are{' '}
            <strong>billed through Stripe</strong> on a recurring basis until you
            cancel. You can <strong>cancel anytime</strong>; your membership stays
            active through the end of the period you have already paid for, and it
            does not renew after that. Prices and plan details are shown before you
            purchase.
          </p>

          <h2>No warranty</h2>
          <p>
            The service is provided &ldquo;as is,&rdquo; without warranties of any
            kind. We don&rsquo;t guarantee that content, statistics, or availability
            will be accurate, uninterrupted, or error-free.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the fullest extent allowed by law, Sportsvyn is not liable for
            indirect, incidental, or consequential damages arising from your use of
            the product. Our total liability for any claim is limited to the amount
            you paid us in the twelve months before the claim.
          </p>

          <h2>Governing law</h2>
          <p>
            These terms are governed by the laws of the State of California, without
            regard to its conflict-of-laws rules.
          </p>

          <h2>Changes to these terms</h2>
          <p>
            We may update these terms; when we do, we&rsquo;ll change the effective
            date above. Continuing to use the product after a change means you accept
            the updated terms.
          </p>

          <div className="legal-contact">
            Questions? Email{' '}
            <a href="mailto:hello@sportsvyn.com">hello@sportsvyn.com</a>. See also our{' '}
            <a href="/privacy">Privacy Policy</a>.
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

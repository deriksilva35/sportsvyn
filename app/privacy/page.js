/**
 * /privacy — Privacy Policy. PAPER-surface prose, server component (no state).
 *
 * Written to be ACCURATE to actual practice, not boilerplate:
 *   · We collect an email (magic-link + Sign in with Apple; private-relay ok),
 *     account/product activity, and route payments through Stripe (we never see
 *     card numbers). No ads, no data sales, no third-party tracking pixels.
 *   · PostHog is intentionally NOT listed: the POSTHOG_* env keys are dead
 *     config (no posthog dependency, zero code references in the app as of this
 *     writing). If analytics is ever wired in, disclose it here.
 *   · Deletion requests go to privacy@sportsvyn.com — that alias must exist.
 */

import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import '@/components/legal.css';

export const metadata = {
  title: 'Privacy Policy — Sportsvyn',
  description: 'How Sportsvyn and the Draftvyn iOS app handle your data.',
};

export default function PrivacyPage() {
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
          <p className="legal-eyebrow">Privacy</p>
          <h1>Privacy Policy</h1>
          <p className="legal-effective">Effective July 20, 2026</p>
          <p className="legal-lede">
            This policy explains what Sportsvyn collects, why, and the choices you
            have. It covers the website at sportsvyn.com and the Draftvyn iOS app.
          </p>
          <p>
            Sportsvyn is an editorial sports product. We keep the amount of
            personal data we hold small on purpose, and we do not sell it.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Your email address.</strong> We use a passwordless magic-link
              sign-in and Sign in with Apple. If you sign in with Apple and choose
              to hide your address, we receive an Apple private-relay address and
              that works fine — it is the only email we get, and we treat it the
              same as any other.
            </li>
            <li>
              <strong>Your account activity.</strong> The drafts you run and other
              activity inside the product are tied to your account so we can show
              you your own history and results.
            </li>
            <li>
              <strong>Payment information — handled by Stripe.</strong> If you buy a
              membership, payment is processed by Stripe. <strong>We never see or
              store your card numbers;</strong> Stripe handles card data directly and
              tells us only whether a payment succeeded and what plan you hold.
            </li>
            <li>
              <strong>Basic technical logs.</strong> Like any website, our hosting
              provider records routine request data (such as IP address and browser
              type) needed to run, secure, and debug the service. We do not use this
              to build advertising or cross-site profiles.
            </li>
          </ul>

          <h2>What we don&rsquo;t do</h2>
          <ul>
            <li>We don&rsquo;t show ads.</li>
            <li>We don&rsquo;t sell, rent, or trade your personal data.</li>
            <li>We don&rsquo;t run third-party advertising or tracking pixels.</li>
            <li>We don&rsquo;t share your data with data brokers.</li>
          </ul>

          <h2>Service providers</h2>
          <p>
            We rely on a small set of processors to run the product. Each handles
            only the data it needs for its job:
          </p>
          <ul className="legal-processors">
            <li><b>Neon</b> Database hosting (your account and product data).</li>
            <li><b>Vercel</b> Application hosting and delivery.</li>
            <li><b>Resend</b> Sending sign-in and account email.</li>
            <li><b>Stripe</b> Payment processing (card data never reaches us).</li>
            <li><b>Apple</b> Sign in with Apple authentication.</li>
          </ul>

          <h2>Your rights and choices</h2>
          <p>
            You can ask us to access, correct, or delete your personal data. To make
            a request — including deleting your account and associated data — email{' '}
            <a href="mailto:privacy@sportsvyn.com">privacy@sportsvyn.com</a> from the
            address on your account and we will act on it.
          </p>
          <p>
            <strong>California residents (CCPA/CPRA)</strong> and{' '}
            <strong>people in the EEA and UK (GDPR)</strong> have the right to access
            and delete their personal data, and to know how it is used. We do not
            sell personal data, so there is nothing to opt out of on that front.
            Exercise any of these rights through the same address above.
          </p>

          <h2>Data retention</h2>
          <p>
            We keep your data while your account is active. When you ask us to delete
            it, we remove your account and associated product data, except anything
            we are legally required to keep (for example, basic payment records
            Stripe must retain for tax and fraud rules).
          </p>

          <h2>Children</h2>
          <p>
            Sportsvyn is not directed to children, and we do not knowingly collect
            data from anyone under 13.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            If we change this policy we will update the effective date above, and for
            material changes we will make a reasonable effort to notify account
            holders.
          </p>

          <div className="legal-contact">
            Questions or requests? Email{' '}
            <a href="mailto:privacy@sportsvyn.com">privacy@sportsvyn.com</a>.
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

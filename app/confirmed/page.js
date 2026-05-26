/**
 * /confirmed -- landing for the confirmation-email round trip.
 *
 * GET /api/email/confirm validates the token then redirects here with
 * either no query (success), ?error=invalid, or ?error=expired. This
 * page renders the brand-styled message for whichever state arrived.
 *
 * Server Component reading searchParams via the Next 16 async pattern
 * (the prop is Promise-shaped -- must be awaited).
 */

import Wordmark from '@/components/Wordmark';

const STATES = {
  default: {
    headline: 'Confirmed.',
    body: "We'll be in touch when there's something worth reading.",
  },
  invalid: {
    headline: 'Invalid link',
    body: "This confirmation link is invalid or has already been used. If you've already confirmed, you're all set.",
  },
  expired: {
    headline: 'Link expired',
    body: 'This confirmation link expired. Sign up again from the homepage to get a new one.',
  },
};

export const metadata = {
  title: 'Confirmed — Sportsvyn',
};

export default async function ConfirmedPage({ searchParams }) {
  const params = await searchParams;
  const errorParam = typeof params?.error === 'string' ? params.error : null;
  const state = STATES[errorParam] ?? STATES.default;

  return (
    <main className="max-w-md mx-auto py-24 px-6 text-center">
      <Wordmark sizeClassName="text-2xl sm:text-3xl" />
      <h1 className="font-display font-black text-3xl text-paper-warm mt-12">
        {state.headline}
      </h1>
      <p className="font-serif italic text-muted mt-4">
        {state.body}
      </p>
      <a
        href="/"
        className="font-mono text-xs uppercase tracking-widest text-muted hover:text-volt mt-12 inline-block"
      >
        ← sportsvyn.com
      </a>
    </main>
  );
}

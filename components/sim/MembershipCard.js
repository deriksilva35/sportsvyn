/**
 * MembershipCard — the conversion surface that renders INLINE at a sim gate
 * (not a modal, not a redirect — the user keeps their context). Two contextual
 * variants via `variant`: 'draft' (out of free drafts) and 'custom' (custom
 * config lock). Presentation only — server-side entitlement (isMember /
 * canStartDraft) stays the source of truth; this card is only ever rendered in a
 * gated, non-member state by StartForm.
 *
 * INK surface, house tokens. The SEE PLANS CTA -> /membership carries no return
 * context by design: createCheckoutSession's success_url is fixed at
 * /sim?upgraded=1, so post-checkout always lands back in the sim. Shell-aware:
 * inside the Draftvyn shell the plans link opens externally (same as the old
 * BECOME A MEMBER bar).
 */

import Link from 'next/link';
import { MEMBERSHIP_PRICE_LINE, MEMBERSHIP_CARD_VARIANTS } from './membershipCopy';

export default function MembershipCard({ variant = 'draft', shell = false, onBackToPresets }) {
  const v = MEMBERSHIP_CARD_VARIANTS[variant] ?? MEMBERSHIP_CARD_VARIANTS.draft;
  const planLinkProps = shell ? { target: '_blank', rel: 'noopener noreferrer', 'data-external': '' } : {};

  return (
    <div className="mcard" data-variant={variant}>
      <div className="mcard-eyebrow">MEMBERSHIP</div>
      <div className="mcard-head">{v.headline}</div>
      <p className="mcard-body">{v.body}</p>
      <div className="mcard-price">{MEMBERSHIP_PRICE_LINE}</div>
      <Link href="/membership" className="mcard-cta" {...planLinkProps}>SEE PLANS</Link>
      {v.secondary.href ? (
        <Link href={v.secondary.href} className="mcard-sec">{v.secondary.label}</Link>
      ) : (
        <button type="button" className="mcard-sec" onClick={onBackToPresets}>{v.secondary.label}</button>
      )}
      <div className="mcard-fine">Cancel anytime from your account.</div>
    </div>
  );
}

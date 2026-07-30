/**
 * MembershipCard — the conversion surface that renders INLINE at a sim gate
 * (not a modal, not a redirect — the user keeps their context). Three contextual
 * variants via `variant`: 'draft' (out of free drafts), 'custom' (custom config
 * lock) and 'tracker' (tracker mode lock). Presentation only — server-side
 * entitlement (isMember / canStartDraft) stays the source of truth; this card is
 * only ever rendered in a gated, non-member state.
 *
 * ============================ SHELL MODE (3.1.1) ============================
 * App Store Guideline 3.1.1 forbids an app from containing ANY mechanism to
 * purchase outside IAP, and from steering users to one. Apple rejected 1.0(2)
 * because Stripe checkout was reachable from these cards.
 *
 * So in shell mode this renders a NEUTRAL LOCKED STATE and the purchase surface
 * is not merely hidden by CSS - it is never constructed:
 *   · no price line          (MEMBERSHIP_PRICE_LINE is not read at all)
 *   · no SEE PLANS CTA       (no /membership Link is rendered)
 *   · no plan names          (shell copy says "the Sportsvyn membership")
 *   · no external link out   (the old shell branch OPENED /membership in a new
 *                             tab, which is precisely the steering 3.1.1 bans)
 * The secondary action (Your drafts / Back to presets) survives, because it is
 * navigation inside the app and carries no commerce.
 *
 * Web (non-shell) rendering is byte-for-byte unchanged.
 */

import Link from 'next/link';
import {
  MEMBERSHIP_PRICE_LINE, MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_CARD_SHELL,
} from './membershipCopy';

export default function MembershipCard({ variant = 'draft', shell = false, onBackToPresets }) {
  const key = MEMBERSHIP_CARD_VARIANTS[variant] ? variant : 'draft';
  const v = MEMBERSHIP_CARD_VARIANTS[key];

  // Secondary action is shared by both modes: in-app navigation, no commerce.
  const secondary = v.secondary.href ? (
    <Link href={v.secondary.href} className="mcard-sec">{v.secondary.label}</Link>
  ) : (
    <button type="button" className="mcard-sec" onClick={onBackToPresets}>{v.secondary.label}</button>
  );

  if (shell) {
    const s = MEMBERSHIP_CARD_SHELL[key];
    return (
      <div className="mcard mcard--locked" data-variant={variant} data-shell="1">
        <div className="mcard-eyebrow">MEMBERSHIP</div>
        <div className="mcard-head">{s.headline}</div>
        <p className="mcard-body">{s.body}</p>
        {secondary}
      </div>
    );
  }

  return (
    <div className="mcard" data-variant={variant}>
      <div className="mcard-eyebrow">MEMBERSHIP</div>
      <div className="mcard-head">{v.headline}</div>
      <p className="mcard-body">{v.body}</p>
      <div className="mcard-price">{MEMBERSHIP_PRICE_LINE}</div>
      <Link href="/membership" className="mcard-cta">SEE PLANS</Link>
      {secondary}
      <div className="mcard-fine">Cancel anytime from your account.</div>
    </div>
  );
}

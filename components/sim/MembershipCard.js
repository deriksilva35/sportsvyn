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
 *   · no pricing CTA         (no /membership Link is rendered)
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
  MEMBERSHIP_PRICE_LINE, MEMBERSHIP_CARD_VARIANTS, MEMBERSHIP_CARD_SHELL, MEMBERSHIP_CARD_IAP,
} from './membershipCopy';
import PassBuy from './PassBuy';

export default function MembershipCard({ variant = 'draft', shell = false, iap = false, compact = false, onBackToPresets }) {
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
    // APPLE_IAP_ENABLED off (today, and for the whole life of the shipped 1.0(2)
    // binary): the neutral locked card, unchanged. On: the same card plus an IAP
    // buy control, and a body that stops saying "members sign in and it unlocks",
    // which is wrong once you can buy it where you are standing. All three
    // variants gate on the `sim` entitlement, which is exactly what the Pass
    // grants, so every one of them is buyable - no per-variant carve-out.
    // Even with the flag on, PassBuy renders NOTHING unless the native purchase
    // bridge is present, so an old binary still shows the suppressed card.
    // COMPACT — the above-the-fold slot on the DRAFT tab. Same card, stripped to
    // the three things that have to be visible without scrolling: what is locked,
    // the price, and the buy control. The explanatory body and the secondary nav
    // are dropped rather than shrunk, because a paragraph that has to be read is
    // not doing work above the fold; the full card still exists everywhere else.
    // Compact is IAP-only: with the flag off there is nothing to put in it, so
    // the caller falls through to the neutral locked card below.
    if (iap && compact) {
      return (
        <div className="mcard mcard--locked mcard--compact" data-variant={variant} data-shell="1" data-iap="1">
          <div className="mcard-eyebrow">MEMBERSHIP</div>
          <div className="mcard-head">{s.headline}</div>
          <PassBuy />
        </div>
      );
    }
    return (
      <div className="mcard mcard--locked" data-variant={variant} data-shell="1" data-iap={iap ? '1' : undefined}>
        <div className="mcard-eyebrow">MEMBERSHIP</div>
        <div className="mcard-head">{s.headline}</div>
        <p className="mcard-body">{iap ? MEMBERSHIP_CARD_IAP[key].body : s.body}</p>
        {iap ? <PassBuy /> : null}
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
      <Link href="/membership" className="mcard-cta">WHAT IS FREE</Link>
      {secondary}
      <div className="mcard-fine">Cancel anytime from your account.</div>
    </div>
  );
}

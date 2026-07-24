// components/home/SimPromoCard.js — the sim product doorway inside the Today's
// Card flow. An ink block on the paper homepage (Surface Rule): instruments/
// product surfaces render ink and sit as ink blocks on paper. Server component;
// the whole card is a link to /sim.

import { SIM_PROMO } from './simPromoCopy';

export default function SimPromoCard() {
  return (
    <a className="dc-sim-promo" href="/sim" data-surface="ink">
      <div className="dc-sim-kicker">{SIM_PROMO.kicker}</div>
      <div className="dc-sim-head">{SIM_PROMO.headline}</div>
      <p className="dc-sim-line">{SIM_PROMO.line}</p>
      <span className="dc-sim-cta">{SIM_PROMO.cta} →</span>
    </a>
  );
}

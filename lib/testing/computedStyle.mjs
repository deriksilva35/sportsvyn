// lib/testing/computedStyle.mjs - the ACTUAL winning CSS rule for an
// element, via jsdom's real cascade (specificity + source order), not a
// human reading the stylesheet top to bottom.
//
// WHY THIS EXISTS (relay 2c item 2's own lesson, and 2a-polish-2's before
// it): a source-level "I added the rule I meant" is not evidence it wins.
// .weekly .hdr .clock once had no font-style of its own and silently lost
// to a same-file, lower-specificity .clock rule for a completely different
// element (the Daily's countdown) - a human skim of the intended rule would
// never have caught that; jsdom's actual cascade does, because it is asking
// the same question a browser's DevTools "computed" pane asks.
//
// A SYNTHETIC SKELETON, NOT A LIVE SERVER. Tests must not depend on a
// running `next dev` - this builds the smallest DOM that has the real
// ancestor chain a selector like ".weekly .yr .sub" needs to match, loads
// the real CSS file verbatim, and reads getComputedStyle() off it.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/**
 * @param {string} cssPath absolute or repo-relative path to the real CSS file
 * @param {string} skeletonHtml the element chain, e.g.
 *   '<div class="weekly"><div class="yr"><div class="sub" id="target">x</div></div></div>'
 * @returns {{ window, document, target: Element }}
 */
export function loadSkeleton(cssPath, skeletonHtml) {
  const css = readFileSync(cssPath, 'utf8');
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${skeletonHtml}</body></html>`);
  const target = dom.window.document.getElementById('target');
  if (!target) throw new Error('loadSkeleton: skeletonHtml must contain one element with id="target"');
  return { window: dom.window, document: dom.window.document, target };
}

/** font-weight / color / font-size (as strings, e.g. '400', 'rgb(184, 184, 179)', '13px'). */
export function computed(target, win) {
  const cs = win.getComputedStyle(target);
  return { fontWeight: cs.fontWeight, color: cs.color, fontSize: cs.fontSize };
}

// lib/brand/tagline.js - THE LINE UNDER THE MARK (mon-15, Derik).
//
// "The arcade of sports." replaced the old line (the one ending "sports games.")
// everywhere it was written. One sentence-case form for prose (meta descriptions, alt text)
// and one caps form for the lockup - the wordmark with the line set under it
// in Rubik Mono One, 9px, 0.22em tracking, muted ink (the Play tab mock,
// "Tagline header", option A). The caps form is DERIVED, so the two cannot
// drift apart; lib/brand/tagline.test.mjs holds that and the retirement of the
// old line repo-wide.
//
// THE APP STORE SUBTITLE AND KEYWORDS ARE NOT THIS. They live in App Store
// Connect / the Mac's native repo, not here, and were deliberately left alone.

export const TAGLINE = 'The arcade of sports.';
export const TAGLINE_CAPS = TAGLINE.replace(/\.$/, '').toUpperCase();

/**
 * THE EMAIL LOCKUP: the wordmark image with the caps line under it, as one
 * table cell's content. Email has no stylesheet, so the lockup's type is
 * written inline; mail clients will not have Rubik Mono One and fall back to
 * the heavy sans. The colour is the emails' own existing muted grey, kept here
 * (lib/brand/ is the mark's own colour data) so no template gains a literal.
 */
export const EMAIL_LOCKUP_MUTED = '#888888';
export function emailLockupHtml({ wordmarkUrl, width = 200, height = 40, color = EMAIL_LOCKUP_MUTED }) {
  return `<img src="${wordmarkUrl}" alt="Sportsvyn" width="${width}" height="${height}" style="display:block;border:0;outline:none;text-decoration:none;height:${height}px;width:${width}px;">
            <div style="padding-top:6px;font-family:'Rubik Mono One','Arial Black',Arial,sans-serif;font-size:9px;line-height:1;letter-spacing:0.22em;color:${color};">${TAGLINE_CAPS}</div>`;
}

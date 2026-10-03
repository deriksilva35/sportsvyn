/**
 * lib/legal.js — single-sourced compliance strings.
 *
 * NON_AFFILIATION renders site-wide (SiteFooter, the team-page footer, the
 * NFL and CFB game pages, the Daily's method note, the Games tab) and in the
 * sim's quiet fine-print zone next to the FFC ADP attribution. ONE LINE FOR
 * EVERY SPORT (ruling thu-42): it used to name the National Football League
 * alone on a site that now carries MLB, the EPL and the NBA. Our NFL stats
 * vendor's ToS permits the data but DENIES name/likeness use, so the vendor is
 * never named user-facing and NO attribution is shown for it. Hyphens only.
 */

export const NON_AFFILIATION = 'Sportsvyn is not affiliated with any league, team or player.';

/**
 * THE EFFECTIVE DATE OF THE TERMS AND THE PRIVACY POLICY - one line, both
 * pages (app/terms, app/privacy). Set it to the day the change deploys.
 */
export const LEGAL_EFFECTIVE_DATE = 'October 3, 2026';

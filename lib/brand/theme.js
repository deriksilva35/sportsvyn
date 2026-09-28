// lib/brand/theme.js - which palette this deployment draws (rebrand R1).
//
// ONE FLAG, READ AT BUILD/RENDER FROM THE ENVIRONMENT - not a user setting and
// not a runtime switch (ruling 28 Sep: one theme). ARCADE_THEME=on is set on DEV
// and in Vercel's Preview environment until Derik passes the gate on a preview;
// then it goes to production, and after that the arcade values become the plain
// :root values and this module is deleted with the dark ones.

export const THEME_COLOR = Object.freeze({ dark: '#0A0A0A', arcade: '#FFFFFF' });

export const arcadeOn = (env = process.env) => String(env?.ARCADE_THEME ?? '').trim().toLowerCase() === 'on';

/** The value for <html data-theme>, or undefined for today's dark. */
export const dataTheme = (env = process.env) => (arcadeOn(env) ? 'arcade' : undefined);

/** The browser/OS bar tint (viewport themeColor) this deployment should use. */
export const themeColor = (env = process.env) => (arcadeOn(env) ? THEME_COLOR.arcade : THEME_COLOR.dark);

/**
 * THE FIRST-PAINT GROUND (droplet-mon-12): the page colour, set as a style
 * ATTRIBUTE on <html> by the root layout - the first thing the parser reads,
 * ahead of everything in <head> - so the document's first frame is already the
 * --tok-page value. Resolved from the same flag as data-theme, so the arcade
 * flip moves it with no second change.
 *
 * WHY NOT AN INLINE <style> IN <head>, which is what was asked: Next and React
 * 19 hoist the route's stylesheet <link>s into <head> ahead of anything the
 * layout renders there, with or without a React `precedence` (both tried, 28
 * Sep - the served head ran link, link, link, style). The attribute on <html>
 * precedes all of them by construction. Not a new CSS rule: body already paints
 * var(--tok-page) (app/globals.css); this is that value, earlier.
 */
export const firstPaintColor = (env = process.env) => (arcadeOn(env) ? THEME_COLOR.arcade : THEME_COLOR.dark);

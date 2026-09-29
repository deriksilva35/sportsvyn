// lib/brand/theme.js - which palette this deployment draws (rebrand R1).
//
// ONE FLAG, READ AT BUILD/RENDER FROM THE ENVIRONMENT - not a user setting and
// not a runtime switch (ruling 28 Sep: one theme). ARCADE_THEME=on is set on DEV
// and in Vercel's Preview environment until Derik passes the gate on a preview;
// then it goes to production, and after that the arcade values become the plain
// :root values and this module is deleted with the dark ones.

export const THEME_COLOR = Object.freeze({ dark: '#0A0A0A', arcade: '#FFFFFF' });

export const arcadeOn = (env = process.env) => String(env?.ARCADE_THEME ?? '').trim().toLowerCase() === 'on';

/**
 * THE APP FLIP (tue-0): ARCADE_SHELL=on puts the arcade palette on the NATIVE
 * APP ONLY - requests carrying the shell cookie - while the web stays dark.
 * ARCADE_THEME still flips everything, as before.
 */
export const arcadeShellOn = (env = process.env) => String(env?.ARCADE_SHELL ?? '').trim().toLowerCase() === 'on';

/**
 * THE PER-REQUEST ANSWER: arcadeOn(req) = ARCADE_THEME || (ARCADE_SHELL && shell).
 * `isShell` is the caller's own resolveShellMode() (the sv_shell cookie). Only
 * DYNAMIC routes can ask it - the root layout cannot read a cookie without
 * making every page dynamic (see app/layout.js), so <html> gets the shell's
 * palette from shellThemeScript() below instead.
 */
export const arcadeFor = (isShell, env = process.env) => arcadeOn(env) || (arcadeShellOn(env) && Boolean(isShell));

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

/**
 * THE SHELL'S HTML PALETTE, BEFORE FIRST PAINT (tue-0, the next-themes pattern).
 *
 * The root layout renders <html> once for web and shell alike and must not
 * read a cookie (that makes every page dynamic, and /market is force-static,
 * where a cookie read comes back empty). So when ARCADE_SHELL is on and the
 * whole deployment is not already arcade, the layout puts this script FIRST
 * in <head>. It is classic and inline, so the parser runs it before it reaches
 * <body> - before any frame is painted - and it sets data-theme="arcade" AND
 * the white first-paint ground in the same tick, so a shell launch never shows
 * an ink frame. Web requests (no cookie) are untouched: the script reads the
 * cookie, finds nothing and returns.
 *
 * Returns null when there is nothing to do, and the layout then renders no
 * script at all - with ARCADE_SHELL off the served HTML is byte-identical.
 */
export function shellThemeScript(env = process.env, { cookie = 'sv_shell', value = 'sim-app' } = {}) {
  if (arcadeOn(env) || !arcadeShellOn(env)) return null;
  const re = `(?:^|;\\s*)${cookie}=${value}(?:;|$)`;
  return `(function(){try{if(new RegExp(${JSON.stringify(re)}).test(document.cookie)){var d=document.documentElement;d.setAttribute('data-theme','arcade');d.style.backgroundColor=${JSON.stringify(THEME_COLOR.arcade)};}}catch(e){}})();`;
}

/** The viewport theme-color for a request whose shell mode is known (dynamic routes). */
export const themeColorFor = (isShell, env = process.env) => (arcadeFor(isShell, env) ? THEME_COLOR.arcade : THEME_COLOR.dark);

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

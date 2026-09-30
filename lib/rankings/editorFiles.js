// lib/rankings/editorFiles.js - every editor list, ONE STATIC URL EACH.
//
// WHY A TABLE AND NOT A TEMPLATE. editorFilePath() used to build
//   new URL(`../../content/power/${league}-${season}-w${week}.md`, import.meta.url)
// which is correct under plain node and WRONG IN THE DEPLOYED BUNDLE: the
// bundler cannot enumerate a template, emitted one asset for it, and every
// path resolved to that one file - cfb-2026-w4.md. So the NFL publish read the
// CFB editor's 25 college teams and threw ("25 name(s) match no team in this
// league") on 22 Sep and again on 29 Sep, and the CFB week-5 edition on 28 Sep
// reported its editor list "present" from a file that does not exist - it was
// week 4's. Nothing local could see it: the dry run is unbundled node.
//
// A LITERAL new URL('...', import.meta.url) IS WHAT THE BUNDLER TRACES - the
// same pattern app/daily/[date]/card/route.js reads its font with in
// production. So each file is named here, once, literally.
//
// ADDING A LIST: write content/power/<league>-<season>-w<week>.md AND add its
// line below. lib/rankings/editorFiles.test.mjs walks the directory and fails
// on a file with no line, so a list can never again be committed and ignored.
//
// THE NFL LAYER IS CLOSED (wed-1). nfl-2026-w2 keeps its line because the walk
// above demands one for every file on disk, but editorFilePath() answers null
// for every NFL week (LEAGUE_CONFIG.nfl.editorLayer is false) - it is history,
// not an input. Only a CFB list added here is read.

export const EDITOR_FILES = Object.freeze({
  'cfb-2026-w4': new URL('../../content/power/cfb-2026-w4.md', import.meta.url),
  'nfl-2026-w2': new URL('../../content/power/nfl-2026-w2.md', import.meta.url),
});

export const editorKey = (league, season, week) => `${league}-${season}-w${week}`;

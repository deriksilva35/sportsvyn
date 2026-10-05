// lib/soccer/teamColors.js - EPL club colours, by hand, keyed on teams.slug
// for league 'epl'. DATA ONLY: no I/O. scripts/team-colours-fill.mjs is the
// writer (fills NULLs only).
//
// WHY A HAND TABLE (mon-22). The only provider in the stack that knew these
// clubs was API-Sports, which is being closed, and its /teams payload carried
// no colours anyway. Twenty pairs, reviewed once, is the same posture as
// lib/mlb/teamColors.js and lib/nba/teamColors.js. When a club is promoted the
// row is added here and the fill script re-run; a slug in the DB with no row
// here is listed as unfilled, never guessed.
//
// THE PAIR IS THE HOME KIT (mon-24 ruling): primary = the home SHIRT colour,
// secondary = the kit's second colour (sleeves, stripes, shorts). That puts
// white first for Fulham, Leeds and Tottenham - Derik's call; badges are the
// home shirt. Hex values are the clubs' brand shades where a palette lists
// them, and plain white/black where the kit colour is white/black.
// `source` is cited per club; `flag` marks a pair a reviewer should eyeball.
//
// SOURCES, fetched 5 Oct 2026:
//   tcc  = teamcolorcodes.com/<club page> (club brand palettes, with Pantone)
//   fl   = footylogos.com/color-codes/<club>, cross-checked on encycolorpedia.com
//   site = the club's own website, read from its served CSS/theme
// The home-kit layout (which colour is the shirt) is the clubs' traditional
// home kit; 2026-27 kit launches were not re-read shirt by shirt.

// This file is census-exempt (lib/brand/hexCensus.js CENSUS_EXEMPT), like the
// MLB and NBA tables: club colours are data, not theme.

/** slug -> { name, primary, secondary, source, flag? }. Twenty rows, 2026-27. */
export const EPL_COLORS = Object.freeze({
  'arsenal':           { name: 'Arsenal',           primary: '#EF0107', secondary: '#FFFFFF', source: 'home kit red body, white sleeves; red per tcc arsenal-color-codes' },
  'aston-villa':       { name: 'Aston Villa',       primary: '#670E36', secondary: '#95BFE5', source: 'home kit claret body, blue sleeves; tcc aston-villa-fc-color-codes' },
  'bournemouth':       { name: 'Bournemouth',       primary: '#DA291C', secondary: '#000000', source: 'home kit red/black stripes; tcc afc-bournemouth-color-codes' },
  'brentford':         { name: 'Brentford',         primary: '#E30613', secondary: '#FFFFFF', source: 'home kit red/white stripes; red per fl brentford' },
  'brighton':          { name: 'Brighton',          primary: '#0057B8', secondary: '#FFFFFF', source: 'home kit blue/white stripes (ruling); blue per tcc brighton-hove-albion-colors' },
  'chelsea':           { name: 'Chelsea',           primary: '#034694', secondary: '#FFFFFF', source: 'home kit blue shirt and shorts, white socks/trim; blue per tcc chelsea-color-codes' },
  'coventry':          { name: 'Coventry',          primary: '#059DD9', secondary: '#FFFFFF', source: 'home kit sky blue, white; tcc coventry-city-f-c-color-codes' },
  'crystal-palace':    { name: 'Crystal Palace',    primary: '#1B458F', secondary: '#C4122E', source: 'home kit blue/red stripes; tcc crystal-palace-fc-colors', flag: 'red/blue halves - blue chosen as primary' },
  'everton':           { name: 'Everton',           primary: '#003399', secondary: '#FFFFFF', source: 'home kit royal blue shirt, white shorts; tcc everton-fc-colors' },
  'fulham':            { name: 'Fulham',            primary: '#FFFFFF', secondary: '#000000', source: 'home kit white shirt, black shorts (ruling); tcc fulham-fc-color-codes' },
  'hull-city':         { name: 'Hull City',         primary: '#F18A01', secondary: '#000000', source: 'home kit amber/black; tcc hull-city-a-f-c-color-codes' },
  // https://www.itfc.co.uk/ - the club site's own blue (#0333A0, button--primary, the most-used colour in its CSS)
  'ipswich':           { name: 'Ipswich',           primary: '#0333A0', secondary: '#FFFFFF', source: 'home kit blue shirt, white sleeves/shorts; blue = site itfc.co.uk CSS' },
  'leeds':             { name: 'Leeds',             primary: '#FFFFFF', secondary: '#1D428A', source: 'home kit white with blue trim (ruling); blue per tcc leeds-united-football-club-colors' },
  'liverpool':         { name: 'Liverpool',         primary: '#C8102E', secondary: '#FFFFFF', source: 'home kit red with white trim (ruling); red per tcc liverpool-fc-colors (PMS 186)' },
  'manchester-city':   { name: 'Manchester City',   primary: '#6CABDD', secondary: '#FFFFFF', source: 'home kit sky blue shirt, white shorts; sky blue per tcc manchester-city-fc-colors', flag: 'navy trim (#1C2C5B) is the alternative secondary' },
  'manchester-united': { name: 'Manchester United', primary: '#DA291C', secondary: '#FFFFFF', source: 'home kit red shirt, white shorts; red per tcc manchester-united-colors (PMS 485)' },
  'newcastle':         { name: 'Newcastle',         primary: '#241F20', secondary: '#FFFFFF', source: 'home kit black/white stripes; tcc newcastle-united-fc-colors' },
  'nottingham-forest': { name: 'Nottingham Forest', primary: '#DD0000', secondary: '#FFFFFF', source: 'home kit red shirt, white shorts; tcc nottingham-forest-f-c-color-codes' },
  // https://www.safc.com/ - the club site's theme palette, "primary" 500 = #DC0714
  'sunderland':        { name: 'Sunderland',        primary: '#DC0714', secondary: '#FFFFFF', source: 'home kit red/white stripes; red = site safc.com theme primary-500' },
  'tottenham':         { name: 'Tottenham',         primary: '#FFFFFF', secondary: '#132257', source: 'home kit white shirt, navy shorts (ruling); navy per tcc tottenham-hotspur-colors (PMS 2766)' },
});

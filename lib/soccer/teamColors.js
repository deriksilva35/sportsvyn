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
// THE PAIR: the club's primary brand colour first, then the one that reads as
// the club on a 22px TeamMark disc next to it. Where a club's shirt is white
// (Fulham, Leeds, Tottenham) the dark brand colour leads, as the NBA/MLB tables
// do. `source` is cited per club; `flag` marks a pair a reviewer should eyeball.
//
// SOURCES, fetched 5 Oct 2026:
//   tcc  = teamcolorcodes.com/<club page> (club brand palettes, with Pantone)
//   fl   = footylogos.com/color-codes/<club>, cross-checked on encycolorpedia.com
//   ency = encycolorpedia.com/teams/football/.../<club> (logo colours)
//   ccc  = clubcolorcodes.com (Premier League index)
// A secondary of white where the source lists none is the kit's, said so.
//
// This file is census-exempt (lib/brand/hexCensus.js CENSUS_EXEMPT), like the
// MLB and NBA tables: club colours are data, not theme.

/** slug -> { name, primary, secondary, source, flag? }. Twenty rows, 2026-27. */
export const EPL_COLORS = Object.freeze({
  'arsenal':           { name: 'Arsenal',           primary: '#EF0107', secondary: '#063672', source: 'tcc arsenal-color-codes: Red, Blue' },
  'aston-villa':       { name: 'Aston Villa',       primary: '#670E36', secondary: '#95BFE5', source: 'tcc aston-villa-fc-color-codes: Claret, Blue' },
  'bournemouth':       { name: 'Bournemouth',       primary: '#DA291C', secondary: '#000000', source: 'tcc afc-bournemouth-color-codes: Red, Black' },
  'brentford':         { name: 'Brentford',         primary: '#E30613', secondary: '#FFFFFF', source: 'fl brentford: Red, White (logo palette)' },
  'brighton':          { name: 'Brighton',          primary: '#0057B8', secondary: '#FFCD00', source: 'tcc brighton-hove-albion-colors: Blue PMS 2935, Yellow PMS 116', flag: 'brand secondary is yellow; the home kit is blue/white' },
  'chelsea':           { name: 'Chelsea',           primary: '#034694', secondary: '#DBA111', source: 'tcc chelsea-color-codes: Blue, Gold' },
  'coventry':          { name: 'Coventry',          primary: '#059DD9', secondary: '#FFFFFF', source: 'tcc coventry-city-f-c-color-codes: Sky Blue, White' },
  'crystal-palace':    { name: 'Crystal Palace',    primary: '#1B458F', secondary: '#C4122E', source: 'tcc crystal-palace-fc-colors: Blue, Red' },
  'everton':           { name: 'Everton',           primary: '#003399', secondary: '#FFFFFF', source: 'tcc everton-fc-colors: Blue, White' },
  'fulham':            { name: 'Fulham',            primary: '#000000', secondary: '#FFFFFF', source: 'tcc fulham-fc-color-codes: Black, White', flag: 'shirt is white; black leads so the disc reads' },
  'hull-city':         { name: 'Hull City',         primary: '#F18A01', secondary: '#000000', source: 'tcc hull-city-a-f-c-color-codes: Orange (amber), Black' },
  'ipswich':           { name: 'Ipswich',           primary: '#3A64A3', secondary: '#FFFFFF', source: 'ency ipswich-town-f-c: logo Blue, White', flag: 'no tcc page; logo blue from encycolorpedia' },
  'leeds':             { name: 'Leeds',             primary: '#1D428A', secondary: '#FFCD00', source: 'tcc leeds-united-football-club-colors: Blue, Yellow', flag: 'shirt is white; brand blue leads' },
  'liverpool':         { name: 'Liverpool',         primary: '#C8102E', secondary: '#F6EB61', source: 'tcc liverpool-fc-colors: Red PMS 186, Gold PMS 100', flag: 'secondary could be white (kit) or green #00B2A9 (brand); gold chosen' },
  'manchester-city':   { name: 'Manchester City',   primary: '#6CABDD', secondary: '#1C2C5B', source: 'tcc manchester-city-fc-colors: Sky Blue, Blue' },
  'manchester-united': { name: 'Manchester United', primary: '#DA291C', secondary: '#FBE122', source: 'tcc manchester-united-colors: Red PMS 485, Yellow PMS 107' },
  'newcastle':         { name: 'Newcastle',         primary: '#241F20', secondary: '#FFFFFF', source: 'tcc newcastle-united-fc-colors: Black, White' },
  'nottingham-forest': { name: 'Nottingham Forest', primary: '#DD0000', secondary: '#FFFFFF', source: 'tcc nottingham-forest-f-c-color-codes: Red, White' },
  'sunderland':        { name: 'Sunderland',        primary: '#EB172B', secondary: '#FFFFFF', source: 'ccc sunderland: Red, White', flag: 'no tcc page; read from a search-result summary of clubcolorcodes.com' },
  'tottenham':         { name: 'Tottenham',         primary: '#132257', secondary: '#FFFFFF', source: 'tcc tottenham-hotspur-colors: Navy PMS 2766 (sole brand colour); White is the kit', flag: 'secondary white is the shirt, not a listed brand colour' },
});

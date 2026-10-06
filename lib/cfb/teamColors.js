// lib/cfb/teamColors.js - CFB colours by hand, for the schools CFBD has NO
// colour for at all. Keyed on the CFBD team id (teams.external_ids->>'cfbd_team_id'),
// which is what the FCS stubs carry. DATA ONLY; scripts/team-colours-fill.mjs
// reads it, and only for a team whose two columns are both NULL AND whose
// CFBD /teams row has no colour (mon-24 ruling 2). CFBD stays the source
// whenever it has anything.
//
// Census-exempt by exact name (lib/brand/hexCensus.js), like
// lib/mlb/teamColors.js, lib/nba/teamColors.js and lib/soccer/teamColors.js.

/** cfbd id -> { name, primary, secondary, source, flag? }. */
export const CFB_STATIC_COLORS = Object.freeze({
  // LIU Sharks. "The colors of the new LIU Sharks will be blue and gold" -
  // https://post.liuathletics.com/news/2019/5/15/general-welcome-to-the-shark-tank-liu-chooses-sharks-as-new-mascot.aspx
  // The hex is the PMS each is specified in (Blue PMS 292 C, Gold PMS 123 C),
  // as listed at https://www.brandcolorcode.com/liu-sharks - no LIU-hosted
  // style guide with hex values was found.
  '2341': { name: 'Long Island University', primary: '#69B3E7', secondary: '#FFC72C',
    source: 'liuathletics.com (blue and gold) + PMS 292 C / 123 C', flag: 'hex via PMS listing, not an LIU-hosted guide' },
  // UTRGV Vaqueros. "The University's official colors are orange, gray and
  // white": Orange PMS 1655 C = #CB4900, Gray Cool Gray 10 C = #646469 -
  // https://www.utrgv.edu/brand/identity/color-palette/index.htm
  '292': { name: 'UT Rio Grande Valley', primary: '#CB4900', secondary: '#646469',
    source: 'utrgv.edu brand colour palette (Orange PMS 1655 C, Cool Gray 10 C)' },
});

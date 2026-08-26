// lib/gridiron/roster.js - gridiron roster normalisation, both codes.
//
// THE TWO PROVIDERS DISAGREE WITH EACH OTHER AND WITH THE COLUMN:
//     BDL   height "6' 4\""  weight "225 lbs"  experience "17th Season"
//     CFBD  height 72         weight 210        year 3
// One is display strings, the other is numbers in imperial units, and the
// column is metric because height_cm already existed. Everything reconciles
// here so `players` means one thing - the same discipline yards_to_goal got.
//
// A VALUE WE CANNOT PARSE BECOMES NULL, NEVER ZERO. A 0 cm player is a lie a
// roster would render as fact; a null is an honest gap the row can omit. This
// is the VAL-column rule applied to bios.

/** BDL: "6' 4\"" | "6'4" | null  ->  centimetres. */
export function heightFromBdl(s) {
  if (s == null) return null;
  const m = String(s).match(/(\d+)\s*'\s*(\d+)?/);
  if (!m) return null;
  const inches = Number(m[1]) * 12 + Number(m[2] ?? 0);
  return Number.isFinite(inches) && inches > 0 ? Math.round(inches * 2.54) : null;
}

/** CFBD: 72 (inches) -> centimetres. */
export function heightFromInches(n) {
  const inches = Number(n);
  return Number.isFinite(inches) && inches > 0 ? Math.round(inches * 2.54) : null;
}

/** "225 lbs" | 210 | null -> kilograms, two decimals. */
export function weightToKg(v) {
  if (v == null) return null;
  // THE SIGN IS PART OF THE NUMBER. Matching bare digits made "-5" parse as 5
  // lb - a negative weight silently becoming a positive one. Caught by test.
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const lb = Number(m[0]);
  return Number.isFinite(lb) && lb > 0 ? Math.round(lb * 0.45359237 * 100) / 100 : null;
}

/**
 * Seasons of experience as an integer.
 *   BDL  "17th Season" -> 17 · "Rookie" -> 1 · "2nd Season" -> 2
 *   CFBD  3            -> 3
 * A rookie is season ONE, not season zero - "0 seasons" would sort a rookie
 * below a player who has not played at all, which is nobody.
 */
export function experienceYears(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
  const s = String(v).trim();
  if (/^rookie$/i.test(s)) return 1;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// THE GRIDIRON POSITION VOCABULARY. Both providers use the same abbreviations
// for the same jobs, so one map serves both codes. Grouped the way a roster is
// actually read - offence, defence, then the specialists, who are three players
// nobody wants buried at the bottom of a 53-man list under "OTHER".
const GROUPS = {
  OFF: ['QB', 'RB', 'FB', 'HB', 'TB', 'WR', 'TE', 'OL', 'OT', 'OG', 'C', 'G', 'T', 'LS'],
  DEF: ['DL', 'DE', 'DT', 'NT', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'FS', 'SS', 'SAF'],
  ST: ['K', 'P', 'PK', 'KR', 'PR', 'ATH'],
};
const LOOKUP = new Map();
for (const [group, list] of Object.entries(GROUPS)) for (const p of list) LOOKUP.set(p, group);

// BDL sends words, not abbreviations ("Punter", "Quarterback"), and also sends
// a position_abbreviation. Prefer the abbreviation; fall back to the word.
const WORDS = {
  quarterback: 'QB', 'running back': 'RB', fullback: 'FB', 'wide receiver': 'WR',
  'tight end': 'TE', 'offensive lineman': 'OL', 'offensive tackle': 'OT',
  'offensive guard': 'OG', center: 'C', 'long snapper': 'LS',
  'defensive lineman': 'DL', 'defensive end': 'DE', 'defensive tackle': 'DT',
  linebacker: 'LB', cornerback: 'CB', safety: 'S', 'defensive back': 'DB',
  kicker: 'K', punter: 'P', 'place kicker': 'PK', athlete: 'ATH',
};

/** A position string -> its group, or null when the vocabulary is new. */
export function positionGroup(position, abbreviation = null) {
  const abbr = String(abbreviation ?? '').toUpperCase().trim();
  if (abbr && LOOKUP.has(abbr)) return LOOKUP.get(abbr);
  const raw = String(position ?? '').trim();
  const up = raw.toUpperCase();
  if (LOOKUP.has(up)) return LOOKUP.get(up);
  const word = WORDS[raw.toLowerCase()];
  if (word && LOOKUP.has(word)) return LOOKUP.get(word);
  // Unknown vocabulary returns NULL rather than being swept into a bucket it
  // may not belong to - the render can show it ungrouped and the run summary
  // can name it, the same way an unmapped drive result is named.
  return null;
}

/** BDL /nfl/v1/players/active row -> our shape. */
export function fromBdl(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return {
    providerKey: 'bdl_player_id',
    providerId: String(p.id),
    fullName: name || null,
    position: p.position_abbreviation || p.position || null,
    positionGroup: positionGroup(p.position, p.position_abbreviation),
    jersey: p.jersey_number == null || p.jersey_number === '' ? null : Number(p.jersey_number),
    heightCm: heightFromBdl(p.height),
    weightKg: weightToKg(p.weight),
    college: p.college || null,
    experienceYears: experienceYears(p.experience),
    providerTeamId: p.team?.id == null ? null : String(p.team.id),
    teamKey: 'bdl_team_id',
  };
}

/** CFBD /roster row -> our shape. */
export function fromCfbd(p) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return {
    providerKey: 'cfbd_player_id',
    providerId: String(p.id),
    fullName: name || null,
    position: p.position || null,
    positionGroup: positionGroup(p.position),
    jersey: p.jersey == null ? null : Number(p.jersey),
    heightCm: heightFromInches(p.height),
    weightKg: weightToKg(p.weight),
    // CFBD carries no college on /roster, and for a college player the team IS
    // the college - so null here is correct, not missing.
    college: null,
    experienceYears: experienceYears(p.year),
    providerTeamName: p.team ?? null,
    teamKey: 'name',
  };
}

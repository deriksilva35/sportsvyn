// lib/flags.js — map a FIFA-style 3-letter team code (what API-Sports stores
// in team.code / our teams.abbreviation) to a flagcdn 2-letter ISO code,
// then to the flagcdn SVG URL.
//
// Coverage:
//   - All 48 expected 2026 World Cup participants (mapped from FIFA 3-letter
//     to ISO 3166-1 alpha-2 / flagcdn's gb-{eng|sct|wls|nir} subdivisions)
//   - Common friendly opponents that appear in the recent-form sync output
//     (Belgium, Egypt, Gambia, Sudan, etc.)
//
// flagcdn returns SVGs at https://flagcdn.com/{iso}.svg — confirmed
// content-type image/svg+xml, CORS-open, Cloudflare-cached 31d. The
// teams.flag_svg_path column (added in migration 017, originally intended
// for Vercel Blob SVGs) is the storage target.
//
// flagcdnUrl(code) returns null for unmapped codes. FlagSlot falls back
// to the empty rule-bordered rectangle when null is returned — no crashes.

// FIFA / API-Sports 3-letter code → flagcdn ISO code
const CODE_TO_ISO = {
  // ----- WC 2026 participants (and their FIFA codes) -----
  ALG: 'dz', // Algeria
  ARG: 'ar', // Argentina
  AUS: 'au', // Australia
  AUT: 'at', // Austria
  BEL: 'be', // Belgium
  BOL: 'bo', // Bolivia
  BRA: 'br', // Brazil
  CAN: 'ca', // Canada
  CIV: 'ci', // Côte d'Ivoire / Ivory Coast
  COL: 'co', // Colombia
  CPV: 'cv', // Cape Verde
  CRC: 'cr', // Costa Rica
  CRO: 'hr', // Croatia (FIFA CRO vs ISO hr)
  CUW: 'cw', // Curaçao
  CZE: 'cz', // Czech Republic
  DEN: 'dk', // Denmark
  ECU: 'ec', // Ecuador
  EGY: 'eg', // Egypt
  ENG: 'gb-eng', // England — flagcdn supports gb-eng
  ESP: 'es', // Spain
  FRA: 'fr', // France
  GER: 'de', // Germany
  GHA: 'gh', // Ghana
  HON: 'hn', // Honduras
  IDN: 'id', // Indonesia
  IRL: 'ie', // Republic of Ireland
  IRN: 'ir', // Iran
  ITA: 'it', // Italy
  JOR: 'jo', // Jordan
  JPN: 'jp', // Japan
  KOR: 'kr', // South Korea
  KSA: 'sa', // Saudi Arabia
  MAR: 'ma', // Morocco
  MEX: 'mx', // Mexico
  NED: 'nl', // Netherlands
  NGA: 'ng', // Nigeria
  NIR: 'gb-nir', // Northern Ireland
  NOR: 'no', // Norway
  NZL: 'nz', // New Zealand
  PAN: 'pa', // Panama
  PAR: 'py', // Paraguay
  PER: 'pe', // Peru
  POL: 'pl', // Poland
  POR: 'pt', // Portugal
  QAT: 'qa', // Qatar
  RSA: 'za', // South Africa (FIFA RSA vs ISO za)
  SCO: 'gb-sct', // Scotland
  SEN: 'sn', // Senegal
  SRB: 'rs', // Serbia
  SUI: 'ch', // Switzerland (FIFA SUI vs ISO ch)
  SVK: 'sk', // Slovakia
  SWE: 'se', // Sweden
  TUN: 'tn', // Tunisia
  TUR: 'tr', // Turkey
  UAE: 'ae', // United Arab Emirates
  URU: 'uy', // Uruguay
  USA: 'us', // United States
  UZB: 'uz', // Uzbekistan
  WAL: 'gb-wls', // Wales

  // ----- Common friendly / AFCON / Gold Cup opponents seen in form-sync -----
  BEN: 'bj', // Benin
  BOT: 'bw', // Botswana
  BFA: 'bf', // Burkina Faso
  BIH: 'ba', // Bosnia & Herzegovina
  CHN: 'cn', // China PR
  COD: 'cd', // Congo DR
  CMR: 'cm', // Cameroon
  CYP: 'cy', // Cyprus
  EST: 'ee', // Estonia
  FIN: 'fi', // Finland
  GAM: 'gm', // Gambia
  GAB: 'ga', // Gabon
  GEO: 'ge', // Georgia
  GRE: 'gr', // Greece
  GUA: 'gt', // Guatemala
  GUI: 'gn', // Guinea (NOTE: API-Sports sends GUI for BOTH Guinea AND Guinea-Bissau —
             //        Guinea-Bissau's api_sports_id is overridden to GNB in lib/teamFlags.js)
  HUN: 'hu', // Hungary
  IRQ: 'iq', // Iraq
  IRE: 'ie', // Republic of Ireland (API-Sports sends IRE; canonical FIFA IRL also mapped above)
  ISL: 'is', // Iceland
  ISR: 'il', // Israel
  KAZ: 'kz', // Kazakhstan
  KEN: 'ke', // Kenya
  KVX: 'xk', // Kosovo (flagcdn supports xk)
  // LIB was incorrectly mapped to 'lb' (Lebanon) since file inception. Verified
  // 2026-06-05 via /teams?country=Lebanon: Lebanon's actual API-Sports code is LEB
  // (api 1551). API-Sports sends LIB for Liberia (api 1525). The pre-fix mapping
  // would have rendered Liberia with Lebanon's flag once B1 acquired their code.
  LIB: 'lr', // Liberia (API-Sports's LIB IS Liberia; was wrongly mapped to Lebanon)
  LEB: 'lb', // Lebanon (API-Sports's actual code for Lebanon, verified)
  LBY: 'ly', // Libya
  LTU: 'lt', // Lithuania
  LUX: 'lu', // Luxembourg
  MAD: 'mg', // Madagascar
  MDA: 'md', // Moldova
  MKD: 'mk', // North Macedonia
  MLI: 'ml', // Mali
  MLT: 'mt', // Malta
  MNE: 'me', // Montenegro
  MOZ: 'mz', // Mozambique
  NIC: 'ni', // Nicaragua
  PRK: 'kp', // North Korea
  ROU: 'ro', // Romania
  RUS: 'ru', // Russia
  RWA: 'rw', // Rwanda
  SDN: 'sd', // Sudan (API-Sports often uses SDN; FIFA legacy SUD also seen)
  SUD: 'sd', // Sudan (alt FIFA code mapping)
  SLO: 'si', // Slovenia
  SMR: 'sm', // San Marino
  TGO: 'tg', // Togo
  TJK: 'tj', // Tajikistan
  TKM: 'tm', // Turkmenistan
  UGA: 'ug', // Uganda
  UKR: 'ua', // Ukraine
  VEN: 've', // Venezuela
  VIE: 'vn', // Vietnam
  ZAM: 'zm', // Zambia
  ZIM: 'zw', // Zimbabwe

  // ----- API-Sports first-3-letters-of-name variants -----
  // API-Sports often uses the team name's first three letters as the
  // abbreviation instead of the canonical FIFA code. Mapping these
  // explicitly so the backfill resolves them rather than reporting
  // them as unmapped. IRA is INTENTIONALLY OMITTED — API-Sports uses
  // it for both Iran and Iraq (a data-quality collision), so both
  // render the empty fallback rather than risk showing the wrong flag.
  SPA: 'es',  // Spain   (canonical ESP)
  JAP: 'jp',  // Japan   (canonical JPN)
  SAU: 'sa',  // Saudi Arabia (canonical KSA)
  SWI: 'ch',  // Switzerland (canonical SUI)
  NET: 'nl',  // Netherlands (canonical NED)
  MOR: 'ma',  // Morocco (canonical MAR)
  BOS: 'ba',  // Bosnia & Herzegovina (canonical BIH)
  IVO: 'ci',  // Ivory Coast (canonical CIV)
  // CON was incorrectly mapped to 'cd' (Congo DR) with a comment acknowledging the
  // ambiguity. Verified 2026-06-05: Congo (Brazzaville, api 1517) sends code CON;
  // Congo DR (api 1508) sends code CGO. So CON belongs to Brazzaville (.cg);
  // Congo DR resolves via the new CGO entry below.
  CON: 'cg',  // Republic of the Congo / Brazzaville (API-Sports CON)
  CGO: 'cd',  // Congo DR (API-Sports actually sends CGO, not COD, verified)
  SOU: 'za',  // South Africa (canonical RSA)
  CAP: 'cv',  // Cape Verde (canonical CPV)
  HAI: 'ht',  // Haiti
  ZEA: 'nz',  // New Zealand (canonical NZL)

  // ----- Audit-verified additions (2026-06-05) -----
  // Pulled by directly querying API-Sports /teams?country=X for each
  // candidate. Codes here are what API-Sports ACTUALLY sends, not
  // canonical FIFA guesses. Four collisions surfaced (MAL, CHI, GUI,
  // NIG) — the entry below is the STATIC DEFAULT for each colliding
  // code (whichever nation we considered the canonical owner); the
  // OTHER nations sharing that code are overridden by api_sports_id
  // in lib/teamFlags.js's API_SPORTS_ID_OVERRIDES.

  // Collision static defaults — the nation that "owns" the colliding
  // 3-letter code at the static-map layer. Others overridden in teamFlags.
  MAL: 'ml',  // Mali (collision default; Malaysia/Malta/Malawi overridden)
  CHI: 'cl',  // Chile (collision default; China overridden)
  NIG: 'ng',  // Nigeria (collision default; Niger overridden — replaces dead NGA static)

  // Canonical FIFA codes used by the override map. Each entry is
  // pointed AT by an API_SPORTS_ID_OVERRIDES rule so the overridden
  // nation resolves to the correct flag.
  MAS: 'my',  // Malaysia (overridden from MAL collision)
  MWI: 'mw',  // Malawi (overridden from MAL collision)
  GNB: 'gw',  // Guinea-Bissau (overridden from GUI collision)
  NER: 'ne',  // Niger (overridden from NIG collision)

  // Senior-slate codes acquired via /teams during the 2026-06-05 audit.
  // None of these were in the file before; all are API-Sports's actual
  // codes for the nation listed. No collisions among them.
  ALB: 'al',  // Albania
  ARM: 'am',  // Armenia
  SIE: 'sl',  // Sierra Leone
  ETH: 'et',  // Ethiopia
  COM: 'km',  // Comoros
  KYR: 'kg',  // Kyrgyzstan
  MYA: 'mm',  // Myanmar
  PAL: 'ps',  // Palestine
  SAL: 'sv',  // El Salvador
  CUR: 'cw',  // Curaçao (alias to existing CUW; API-Sports sends CUR)
  ARU: 'aw',  // Aruba
  ERI: 'er',  // Eritrea (bonus from audit)
  SSU: 'ss',  // South Sudan (bonus from audit)
  BUR: 'bi',  // Burundi (bonus from audit)

  // Code-null nation overrides. API-Sports sends code:null for these
  // teams, so B1's /teams acquisition cannot give us an abbreviation.
  // Manual override entries in lib/teamFlags.js map their api_sports_id
  // to a chosen FIFA-style code; the entries below let those chosen
  // codes resolve to the right flag.
  GIB: 'gi',  // Gibraltar
  LUX: 'lu',  // Luxembourg
  BER: 'bm',  // Bermuda
  FJI: 'fj',  // Fiji
  VAN: 'vu',  // Vanuatu
  GUM: 'gu',  // Guam
  CYM: 'ky',  // Cayman Islands
};

export function flagIso(code) {
  if (!code) return null;
  return CODE_TO_ISO[String(code).toUpperCase()] ?? null;
}

export function flagcdnUrl(code) {
  const iso = flagIso(code);
  return iso ? `https://flagcdn.com/${iso}.svg` : null;
}

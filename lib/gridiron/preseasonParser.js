// lib/gridiron/preseasonParser.js — pure parser for content/preseason-edition-0.md
// into the five ranking boards. Takes the markdown TEXT (fs stays in the seed
// script), so it is unit-testable against the real file. No DB.
//
// Entry grammar (one paragraph per entry):
//   **N. Name.** read...                 -> explicit rank N
//   **N. Player Name, Team.** read...    -> player board: name + team tag
//   **Name.** read...                    -> dark horse (no number): rank assigned
//                                           sequentially from the board's darkStart
//   **N. Name.** [Rank only. ...]        -> rank-only row (read = null)

export const BOARDS = [
  { heading: '# 1. NFL Power Rankings',    slug: 'nfl-power',        league: 'nfl', entity: 'team',   name: 'NFL Power Rankings',    composite: 'team_power',       darkStart: 16 },
  { heading: '# 2. NFL MVP (Offense)',     slug: 'nfl-mvp-offense',  league: 'nfl', entity: 'player', name: 'NFL MVP',               composite: 'player_composite', darkStart: 16 },
  { heading: '# 2b. NFL Defensive Player', slug: 'nfl-mvp-defense',  league: 'nfl', entity: 'player', name: 'NFL Defensive Player',  composite: 'player_composite', darkStart: 11 },
  { heading: '# 3. The Sportsvyn 25',      slug: 'cfb-top25',        league: 'cfb', entity: 'team',   name: 'The Sportsvyn 25',      composite: 'team_power',       darkStart: 16 },
  { heading: '# 4. Heisman',               slug: 'cfb-heisman',      league: 'cfb', entity: 'player', name: 'Heisman',               composite: 'player_composite', darkStart: 16 },
];

const END_MARKER = '\n## Copy discipline';

function parseBoardBody(body, cfg) {
  const entries = [];
  const footerLines = [];
  let inDark = false;
  let inFooter = false; // the "Named and left off" section -> a serif footer note
  let darkIdx = 0;
  for (const line of body.split('\n')) {
    const s = line.trim();
    if (s.startsWith('## ')) {
      inDark = /dark hors/i.test(s);
      inFooter = /named and left off/i.test(s);
      continue;
    }
    if (inFooter) { if (s) footerLines.push(s); continue; }
    const m = s.match(/^\*\*(.+?)\.\*\*\s*(.*)$/);
    if (!m) continue;
    const head = m[1].trim();
    const readRaw = m[2].trim();

    let rank = null;
    let namePart = head;
    const rm = head.match(/^(\d+)\.\s+(.+)$/);
    if (rm) { rank = Number(rm[1]); namePart = rm[2].trim(); }

    let label = namePart;
    let teamTag = null;
    if (cfg.entity === 'player') {
      const ci = namePart.lastIndexOf(', ');
      if (ci > 0) { label = namePart.slice(0, ci).trim(); teamTag = namePart.slice(ci + 2).trim(); }
    }

    let band = null;
    if (rank == null) { rank = cfg.darkStart + darkIdx; darkIdx += 1; band = 'dark_horse'; }
    else if (inDark) { band = 'dark_horse'; }

    const read = /^\[rank only/i.test(readRaw) ? null : (readRaw || null);
    entries.push({ rank, label, teamTag, band, read });
  }
  return { entries, footer: footerLines.length ? footerLines.join(' ') : null };
}

export function parsePreseasonEditions(md) {
  const out = [];
  for (let i = 0; i < BOARDS.length; i++) {
    const cfg = BOARDS[i];
    const start = md.indexOf(cfg.heading);
    if (start < 0) throw new Error(`board heading not found: ${cfg.heading}`);
    const next = BOARDS[i + 1]?.heading;
    let end = next ? md.indexOf(next, start) : md.indexOf(END_MARKER, start);
    if (end < 0) end = md.length;
    const body = md.slice(start + cfg.heading.length, end);
    const parsed = parseBoardBody(body, cfg);
    out.push({ ...cfg, entries: parsed.entries, footer: parsed.footer });
  }
  return out;
}

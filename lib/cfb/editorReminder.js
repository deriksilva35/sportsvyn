// lib/cfb/editorReminder.js - "CFB 25 due - week N" (mon-9).
//
// The Sportsvyn 25 needs Derik's list for each AP week
// (content/power/cfb-2026-w<N>.md + its EDITOR_FILES line). When the new AP
// week is in and the file is not, this builds the email that tells him, with
// the table he ranks from: AP rank, team, record, the weekend's result, last
// week's Sportsvyn 25 rank, and last week's teams that fell out of the AP.
//
// ONE DECISION-MAKER, THREE CALLERS. runReminder() is the whole job; the cron
// route passes the real mailer, scripts/cfb25-reminder.mjs passes a printer
// (the dry run), the tests pass fakes. It never imports lib/resend: a module
// that can send mail must not be the unit under test (alerts.js learned that
// with twenty emails in the inbox), so the sender is injected.
//
// "EXISTS" MEANS WHAT THE PUBLISHER MEANS: editorFilePath() answers a URL only
// for a week with a line in the EDITOR_FILES table, and the file must be on
// disk. A file with no table line would publish on the model alone, so it does
// not count as "Derik has sent his list".
//
// ONCE PER WEEK: a sync_runs marker (source cfb25-reminder, kind reminder,
// summary {season, week}), written BEFORE the send like maybeAlert's - one
// dropped reminder beats a reminder every tick. A dry run writes nothing.

import { existsSync } from 'node:fs';
import { editorFilePath } from '../rankings/publishGridironEdition.js';

export const REMINDER_SOURCE = 'cfb25-reminder';
export const REMINDER_TO = 'deriksilva@gmail.com';
const DAY = 86_400_000;

/** Has Derik's list for this AP week landed (file on disk AND its table line)? */
export function editorListExists(season, week) {
  const url = editorFilePath('cfb', season, week);
  return Boolean(url && existsSync(url));
}

/** "W 20-17 at ALA" / "L 24-27 vs OU" - the team's result from its own side. */
export function resultLine(g) {
  if (!g) return 'bye';
  const mine = g.is_home ? g.home_score : g.away_score;
  const theirs = g.is_home ? g.away_score : g.home_score;
  return `${mine > theirs ? 'W' : 'L'} ${mine}-${theirs} ${g.is_home ? 'vs' : 'at'} ${g.opp}`;
}

/**
 * The rows: every AP team in rank order, then last week's Sportsvyn 25 teams
 * that are not in the AP (sorted by their old rank). `now` bounds the weekend:
 * finals kicked off in the five days before it (Wed-Mon), latest per team.
 */
export async function loadReminderRows(sql, { season, week, now = new Date() }) {
  const since = new Date(now.getTime() - 5 * DAY).toISOString();
  const until = now.toISOString();
  return sql`
    WITH prev AS (
      SELECT rd.id
        FROM ranking_editions rd JOIN ranking_lists rl ON rl.id = rd.ranking_list_id
       WHERE rl.slug = 'cfb-top25' AND rd.notes ~ '^\\{'
         AND (rd.notes::jsonb->'forWeek'->>'season')::int = ${season}
         AND (rd.notes::jsonb->'forWeek'->>'week')::int < ${week}
       ORDER BY rd.edition_number DESC LIMIT 1),
    sv AS (SELECT e.team_id, e.rank FROM ranking_entries e JOIN prev ON prev.id = e.ranking_edition_id),
    ap AS (SELECT team_id, rank FROM ap_rankings
            WHERE season = ${season} AND week = ${week} AND season_type = 'regular'),
    ids AS (SELECT team_id FROM ap UNION SELECT team_id FROM sv WHERE rank <= 25)
    SELECT ap.rank AS ap_rank, t.name, tr.wins, tr.losses, sv.rank AS sv_prev,
           (SELECT json_build_object(
                     'is_home', m.home_team_id = t.id, 'home_score', m.home_score,
                     'away_score', m.away_score,
                     'opp', CASE WHEN m.home_team_id = t.id THEN a.abbreviation ELSE h.abbreviation END)
              FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
             WHERE (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.status = 'final'
               AND m.kickoff_at >= ${since}::timestamptz AND m.kickoff_at < ${until}::timestamptz
             ORDER BY m.kickoff_at DESC LIMIT 1) AS game
      FROM ids JOIN teams t ON t.id = ids.team_id
      LEFT JOIN ap ON ap.team_id = t.id
      LEFT JOIN sv ON sv.team_id = t.id
      LEFT JOIN team_records tr ON tr.team_id = t.id AND tr.season = ${season} AND tr.season_type = 'regular'
     ORDER BY ap.rank NULLS LAST, sv.rank
     LIMIT 60`;
}

const pad = (s, n) => String(s).padEnd(n);

/** The email: subject + plain-text body. PURE. */
export function renderReminder({ season, week, rows }) {
  const inAp = rows.filter((r) => r.ap_rank != null);
  const fell = rows.filter((r) => r.ap_rank == null);
  const line = (r) => [
    pad(r.ap_rank ?? '-', 3), pad(r.name, 18), pad(`${r.wins ?? '?'}-${r.losses ?? '?'}`, 6),
    pad(resultLine(r.game), 16), r.sv_prev ?? 'NR',
  ].join(' ');
  const head = `${pad('AP', 3)} ${pad('Team', 18)} ${pad('Rec', 6)} ${pad('Weekend', 16)} SV25 last wk`;
  const body = [
    `AP week ${week} is in and content/power/cfb-2026-w${week}.md is not.`,
    `Send your 25 and the board gets published with it; until then it runs on the model + AP.`,
    '',
    head,
    ...inAp.map(line),
    ...(fell.length ? ['', 'Last week\'s Sportsvyn 25, out of the AP this week:', ...fell.map(line)] : []),
    '',
    `Season ${season}. SV25 last wk = the Sportsvyn 25 rank before this AP week (NR = not in it).`,
  ].join('\n');
  return { subject: `CFB 25 due - week ${week}`, body };
}

/**
 * The job. `week`/`season` default to the newest AP poll; the dry run may force
 * them (and `force` skips the file/marker skips so the table can be printed for
 * a week that is already done). Returns {decision, ...}; sends only via `send`.
 */
export async function runReminder({ sql, send, now = new Date(), season = null, week = null, force = false, dryRun = false, readAp }) {
  const ap = season != null && week != null ? { season, week } : await readAp();
  if (ap.season == null || ap.week == null) return { decision: 'no-ap-week' };
  if (!force && editorListExists(ap.season, ap.week)) return { decision: 'file-exists', ...ap };

  if (!dryRun && !force) {
    const [seen] = await sql`
      SELECT id FROM sync_runs
       WHERE source = ${REMINDER_SOURCE} AND kind = 'reminder'
         AND (summary->>'season')::int = ${ap.season} AND (summary->>'week')::int = ${ap.week}
       LIMIT 1`;
    if (seen) return { decision: 'already-sent', ...ap };
  }

  const rows = await loadReminderRows(sql, { ...ap, now });
  const mail = renderReminder({ ...ap, rows });
  if (dryRun) return { decision: 'dry-run', ...ap, ...mail };

  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${REMINDER_SOURCE}, 'reminder', now(), now(), true,
            ${JSON.stringify({ season: ap.season, week: ap.week, subject: mail.subject })}::jsonb)`;
  await send({ to: REMINDER_TO, ...mail });
  return { decision: 'sent', ...ap, subject: mail.subject };
}

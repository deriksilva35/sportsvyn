/**
 * /admin/prematch — pre-match analyst control room.
 *
 * Lists every articles row produced by the pre-match analyst pass
 * (type='preview', score_type='watch'), with pending_review rows
 * (status='preview') flagged + sorted to the top.
 *
 * Gated by proxy.js Basic Auth (matcher covers /admin/:path*) — no
 * per-page auth needed. Same pattern as /admin/signups.
 *
 * Click a row to open the edit surface at /admin/prematch/[id], where
 * the editor can adjust dim scores (composite recomputes server-side),
 * justifications, preview paragraphs, watch summary, moment_basis, and
 * publish/un-publish.
 */

import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Pre-match analyst · Sportsvyn admin',
  robots: { index: false, follow: false },
};

async function getAnalystRows() {
  // Order: pending_review (status='preview') first, then published, then
  // any other status. Within each bucket, kickoff_at ASC so the next
  // upcoming match floats up.
  const rows = await sql`
    SELECT
      a.id, a.slug, a.title, a.status, a.moment_basis, a.composite_score,
      a.stakes_score, a.quality_score, a.narrative_score, a.drama_score, a.moment_score,
      a.edited_at, a.published_at, a.updated_at,
      m.slug AS match_slug, m.kickoff_at, m.status AS match_status,
      h.name AS home_name, a2.name AS away_name
    FROM articles a
    LEFT JOIN matches m ON m.id = a.match_id
    LEFT JOIN teams h  ON h.id = m.home_team_id
    LEFT JOIN teams a2 ON a2.id = m.away_team_id
    WHERE a.type = 'preview' AND a.score_type = 'watch'
    ORDER BY
      (a.status = 'preview') DESC,
      (a.status = 'published') DESC,
      m.kickoff_at ASC NULLS LAST,
      a.updated_at DESC
  `;
  return rows;
}

function num1(v) {
  if (v == null) return '—';
  return Number(v).toFixed(1);
}

function fmtKickoff(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Los_Angeles',
  }).format(new Date(d)) + ' PT';
}

function statusBadge(status, editedAt) {
  let color = '#888';
  let label = status?.toUpperCase() ?? '?';
  if (status === 'preview')   { color = '#D4FF00'; label = 'PENDING REVIEW'; }
  if (status === 'published') { color = '#2A8A4F'; label = 'PUBLISHED'; }
  if (status === 'draft')     { color = '#B8410F'; label = 'DRAFT'; }
  const editedNote = editedAt ? ' · EDITED' : '';
  return (
    <span style={{
      fontFamily: 'ui-monospace, monospace',
      fontSize: 10,
      letterSpacing: '0.12em',
      padding: '3px 7px',
      borderRadius: 3,
      border: `1px solid ${color}`,
      color,
    }}>{label}{editedNote}</span>
  );
}

function momentBasisChip(basis) {
  if (!basis) return null;
  const color = basis === 'geopolitical' ? '#E63946'
              : basis === 'cultural'     ? '#D4FF00'
              : '#888';
  return (
    <span style={{
      fontFamily: 'ui-monospace, monospace',
      fontSize: 10,
      letterSpacing: '0.08em',
      padding: '2px 6px',
      borderRadius: 3,
      border: `1px solid ${color}`,
      color,
      marginLeft: 8,
    }}>{basis}</span>
  );
}

export default async function AdminPrematchPage() {
  const rows = await getAnalystRows();
  const pendingCount = rows.filter((r) => r.status === 'preview').length;
  const publishedCount = rows.filter((r) => r.status === 'published').length;

  return (
    <div style={{
      background: '#0A0A0A', color: '#F5F5F2', minHeight: '100vh',
      fontFamily: 'ui-monospace, monospace', padding: '24px 32px',
    }}>
      <h1 style={{ fontSize: 22, margin: 0, letterSpacing: '0.04em' }}>
        Pre-match analyst — control room
      </h1>
      <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
        {rows.length} total · <span style={{ color: '#D4FF00' }}>{pendingCount} pending review</span> · {publishedCount} published
      </div>

      <table style={{
        width: '100%', borderCollapse: 'collapse', marginTop: 24, fontSize: 13,
      }}>
        <thead>
          <tr style={{ color: '#888', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Match</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Kickoff (PT)</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Composite</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>S</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Q</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>N</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>D</th>
            <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>M</th>
            <th style={{ textAlign: 'right',  padding: '8px 10px', borderBottom: '1px solid #2A2A2A' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bgColor = r.status === 'preview' ? '#1A1A0A' : 'transparent';
            return (
              <tr key={r.id} style={{ background: bgColor }}>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A' }}>
                  {statusBadge(r.status, r.edited_at)}
                  {momentBasisChip(r.moment_basis)}
                </td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A' }}>
                  <a href={`/admin/prematch/${r.id}`} style={{ color: '#F5F5F2', textDecoration: 'none' }}>
                    {r.home_name ?? '?'} vs {r.away_name ?? '?'}
                  </a>
                  <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{r.match_slug}</div>
                </td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', color: '#C5C5C2' }}>{fmtKickoff(r.kickoff_at)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', fontWeight: 700 }}>{num1(r.composite_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', color: '#888' }}>{num1(r.stakes_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', color: '#888' }}>{num1(r.quality_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', color: '#888' }}>{num1(r.narrative_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', color: '#888' }}>{num1(r.drama_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'center', color: '#888' }}>{num1(r.moment_score)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #1A1A1A', textAlign: 'right' }}>
                  <a href={`/admin/prematch/${r.id}`} style={{ color: '#D4FF00', fontSize: 11, letterSpacing: '0.08em' }}>EDIT →</a>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              No analyst-pass records yet. Fire the pass against a fixture to populate this view.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

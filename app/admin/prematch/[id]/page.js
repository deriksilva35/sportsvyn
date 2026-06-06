/**
 * /admin/prematch/[id] — edit a single analyst-pass article.
 *
 * Renders all editable fields with current values. Save (server action)
 * recomputes composite from the edited dim scores. Publish action (for
 * pending_review rows) flips status to 'published'. Unpublish hides a
 * row from render without deleting it.
 *
 * Auth: gated by proxy.js at the /admin/* matcher; the Server Actions
 * themselves re-verify ADMIN_SECRET presence (defense-in-depth).
 */

import { sql } from '@/lib/db';
import { saveEdit, publishHeld, unpublish } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Edit analyst row · Sportsvyn admin',
  robots: { index: false, follow: false },
};

async function getArticle(id) {
  const rows = await sql`
    SELECT
      a.*,
      m.slug AS match_slug, m.kickoff_at,
      h.name AS home_name, a2.name AS away_name
    FROM articles a
    LEFT JOIN matches m ON m.id = a.match_id
    LEFT JOIN teams h  ON h.id = m.home_team_id
    LEFT JOIN teams a2 ON a2.id = m.away_team_id
    WHERE a.id = ${id}
      AND a.type = 'preview' AND a.score_type = 'watch'
  `;
  return rows[0] ?? null;
}

function num1(v) { if (v == null) return ''; return Number(v).toFixed(1); }

const fieldStyle = {
  display: 'block', width: '100%', background: '#1A1A1A', color: '#F5F5F2',
  border: '1px solid #2A2A2A', borderRadius: 3, padding: '8px 10px',
  fontFamily: 'ui-monospace, monospace', fontSize: 13, marginTop: 6,
};
const labelStyle = {
  display: 'block', fontFamily: 'ui-monospace, monospace',
  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: '#888', marginTop: 20,
};
const buttonStyle = {
  background: '#D4FF00', color: '#0A0A0A', border: 'none', borderRadius: 3,
  padding: '10px 18px', fontFamily: 'ui-monospace, monospace',
  fontSize: 12, letterSpacing: '0.08em', fontWeight: 600, cursor: 'pointer',
};
const buttonSecondaryStyle = {
  ...buttonStyle, background: 'transparent', color: '#F5F5F2',
  border: '1px solid #2A2A2A',
};

export default async function EditAnalystPage({ params }) {
  const { id } = await params;
  const a = await getArticle(Number(id));
  if (!a) {
    return (
      <div style={{ background: '#0A0A0A', color: '#F5F5F2', minHeight: '100vh', padding: 40 }}>
        <div>Article not found.</div>
        <a href="/admin/prematch" style={{ color: '#D4FF00' }}>← Back to list</a>
      </div>
    );
  }

  const isPendingReview = a.status === 'preview';
  const isPublished     = a.status === 'published';

  return (
    <div style={{
      background: '#0A0A0A', color: '#F5F5F2', minHeight: '100vh',
      fontFamily: 'ui-monospace, monospace', padding: '24px 32px',
      maxWidth: 980, margin: '0 auto',
    }}>
      <div style={{ marginBottom: 20 }}>
        <a href="/admin/prematch" style={{ color: '#D4FF00', fontSize: 11, letterSpacing: '0.08em' }}>← BACK TO LIST</a>
      </div>

      <h1 style={{ fontSize: 22, margin: 0 }}>{a.home_name ?? '?'} vs {a.away_name ?? '?'}</h1>
      <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
        Match: {a.match_slug} · Article id {a.id} · Status: <b style={{ color: isPendingReview ? '#D4FF00' : isPublished ? '#2A8A4F' : '#888' }}>{a.status}</b>
        {a.edited_at && <span> · EDITED at {new Date(a.edited_at).toISOString()}</span>}
      </div>

      {/* Pending-review banner */}
      {isPendingReview && (
        <div style={{
          marginTop: 16, padding: 14, border: '1px solid #D4FF00',
          background: 'rgba(212,255,0,0.06)', color: '#D4FF00', fontSize: 12,
        }}>
          PENDING REVIEW · moment_basis=&quot;{a.moment_basis}&quot; routed this row to admin.
          Review the MOMENT justification + preview prose; edit if needed, then publish.
        </div>
      )}

      {/* Edit form */}
      <form action={saveEdit}>
        <input type="hidden" name="id" value={a.id} />

        <label style={labelStyle}>Title</label>
        <input style={fieldStyle} name="title" defaultValue={a.title ?? ''} />

        <label style={labelStyle}>Subtitle (the 40-70 word verdict — appears italic under headline)</label>
        <textarea style={{ ...fieldStyle, height: 80 }} name="subtitle" defaultValue={a.subtitle ?? ''} />

        <label style={labelStyle}>Watch Summary (separate field — currently same as subtitle from auto-fire)</label>
        <textarea style={{ ...fieldStyle, height: 80 }} name="watch_summary" defaultValue={a.watch_summary ?? ''} />

        <label style={labelStyle}>Preview Body (two paragraphs separated by blank line)</label>
        <textarea style={{ ...fieldStyle, height: 220, lineHeight: 1.5 }} name="body" defaultValue={a.body ?? ''} />

        <label style={labelStyle}>moment_basis (sporting / cultural / geopolitical)</label>
        <select style={fieldStyle} name="moment_basis" defaultValue={a.moment_basis ?? ''}>
          <option value="">— (unset)</option>
          <option value="sporting">sporting</option>
          <option value="cultural">cultural</option>
          <option value="geopolitical">geopolitical</option>
        </select>

        <h2 style={{ marginTop: 36, fontSize: 14, letterSpacing: '0.08em', color: '#D4FF00' }}>
          DIMENSIONS (composite recomputes on save as flat mean, one decimal)
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr', gap: 16, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>STAKES score (0–10)</label>
            <input style={fieldStyle} name="stakes_score" type="number" step="0.1" min="0" max="10" defaultValue={num1(a.stakes_score)} />
          </div>
          <div>
            <label style={labelStyle}>STAKES justification</label>
            <textarea style={{ ...fieldStyle, height: 80 }} name="stakes_note" defaultValue={a.stakes_note ?? ''} />
          </div>

          <div>
            <label style={labelStyle}>QUALITY score (0–10)</label>
            <input style={fieldStyle} name="quality_score" type="number" step="0.1" min="0" max="10" defaultValue={num1(a.quality_score)} />
          </div>
          <div>
            <label style={labelStyle}>QUALITY justification</label>
            <textarea style={{ ...fieldStyle, height: 80 }} name="quality_note" defaultValue={a.quality_note ?? ''} />
          </div>

          <div>
            <label style={labelStyle}>NARRATIVE score (0–10)</label>
            <input style={fieldStyle} name="narrative_score" type="number" step="0.1" min="0" max="10" defaultValue={num1(a.narrative_score)} />
          </div>
          <div>
            <label style={labelStyle}>NARRATIVE justification</label>
            <textarea style={{ ...fieldStyle, height: 80 }} name="narrative_note" defaultValue={a.narrative_note ?? ''} />
          </div>

          <div>
            <label style={labelStyle}>DRAMA score (0–10)</label>
            <input style={fieldStyle} name="drama_score" type="number" step="0.1" min="0" max="10" defaultValue={num1(a.drama_score)} />
          </div>
          <div>
            <label style={labelStyle}>DRAMA justification</label>
            <textarea style={{ ...fieldStyle, height: 80 }} name="drama_note" defaultValue={a.drama_note ?? ''} />
          </div>

          <div>
            <label style={labelStyle}>MOMENT score (0–10)</label>
            <input style={fieldStyle} name="moment_score" type="number" step="0.1" min="0" max="10" defaultValue={num1(a.moment_score)} />
          </div>
          <div>
            <label style={labelStyle}>MOMENT justification</label>
            <textarea style={{ ...fieldStyle, height: 80 }} name="moment_note" defaultValue={a.moment_note ?? ''} />
          </div>
        </div>

        <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button style={buttonStyle} type="submit">SAVE EDIT</button>
          <span style={{ fontSize: 11, color: '#888' }}>
            Composite recomputes as flat mean of the 5 dim scores · edited_at set to now.
          </span>
        </div>
      </form>

      {/* Publish action — separate form so it submits without form-state collision. */}
      {isPendingReview && (
        <form action={publishHeld} style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #2A2A2A' }}>
          <input type="hidden" name="id" value={a.id} />
          <button style={{ ...buttonStyle, background: '#2A8A4F', color: '#F5F5F2' }} type="submit">PUBLISH (clear pending-review hold)</button>
          <span style={{ marginLeft: 12, fontSize: 11, color: '#888' }}>
            Flips status to &quot;published&quot;; row renders on the match page on next request.
          </span>
        </form>
      )}
      {isPublished && (
        <form action={unpublish} style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #2A2A2A' }}>
          <input type="hidden" name="id" value={a.id} />
          <button style={buttonSecondaryStyle} type="submit">UNPUBLISH</button>
          <span style={{ marginLeft: 12, fontSize: 11, color: '#888' }}>
            Hides from match page render without deleting. Status flips to &quot;unpublished&quot;.
          </span>
        </form>
      )}
    </div>
  );
}

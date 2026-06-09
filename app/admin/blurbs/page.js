/**
 * /admin/blurbs — Editorial Blurb review queue (all blurb_types).
 *
 * Mirrors /admin/daily-card: list pending_review rows, two server actions
 * per row (Approve & Publish, Reject), tail of Recently Reviewed for
 * context. Type filter at top so the same queue can serve team_outlook,
 * player_outlook, ranking_row_blurb, and stats_framing as they come online.
 *
 * Auth: gated by proxy.js at the route layer (HTTP Basic Auth on /admin/*).
 * If the user reaches this page they're already authenticated.
 *
 * The publish path goes through lib/blurbs.publishBlurb which demotes the
 * prior current row in the same transaction — never two is_current=true
 * rows for the same (entity, blurb_type) at the same time.
 */

import { revalidatePath } from 'next/cache';
import { getPendingBlurbs, getRecentlyReviewed, publishBlurb, publishAllPending, rejectBlurb } from '@/lib/blurbs';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const BLURB_TYPES = ['team_outlook', 'player_outlook', 'ranking_row_blurb', 'stats_framing'];

function entityHref(kind, slug) {
  if (!slug) return null;
  if (kind === 'team')          return `/team/${slug}`;
  if (kind === 'player')        return `/player/${slug}`;
  if (kind === 'ranking_entry') return `/team/${slug}`;
  if (kind === 'league')        return `/league/${slug}`;
  return null;
}

async function approveAction(formData) {
  'use server';
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id < 1) return;
  const updated = await publishBlurb({ id, reviewedBy: 'admin' });
  // Revalidate the admin queue + the entity surface (team/player page).
  revalidatePath('/admin/blurbs');
  if (updated) {
    const kind = updated.team_id != null ? 'team'
               : updated.player_id != null ? 'player'
               : updated.league_id != null ? 'league'
               : 'ranking_entry';
    // We don't know the slug here without a join; lib/blurbs already
    // demoted the prior row, so the safe option is a broad revalidate of
    // the entity collection. The team page reads getCurrentBlurb live.
    if (kind === 'team')   revalidatePath('/team/[slug]', 'page');
    if (kind === 'player') revalidatePath('/player/[slug]', 'page');
  }
}

async function rejectAction(formData) {
  'use server';
  const id = Number(formData.get('id'));
  const notes = formData.get('notes')?.toString().trim() || null;
  if (!Number.isFinite(id) || id < 1) return;
  await rejectBlurb({ id, reviewedBy: 'admin', notes });
  revalidatePath('/admin/blurbs');
}

// Bulk-approve every pending row of the currently-filtered blurb_type.
// Type-scoped — never publishes across unrelated types. Requires the editor
// to type "APPROVE" in the confirm field, so a stray click can't fire it.
async function bulkApproveAction(formData) {
  'use server';
  const blurbType = formData.get('blurbType')?.toString().trim();
  const confirm = formData.get('confirm')?.toString().trim();
  const reviewedBy = formData.get('reviewedBy')?.toString().trim() || 'admin';
  if (!blurbType || confirm !== 'APPROVE') return;
  await publishAllPending({ blurbType, reviewedBy });
  // Revalidate the queue + every team-page slug (cheap broad invalidate; the
  // team pages are dynamic-rendered and will pick up new blurb_body on next hit).
  revalidatePath('/admin/blurbs');
  revalidatePath('/team/[slug]', 'page');
  revalidatePath('/');
}

function fmtTime(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(d));
}

export default async function BlurbsAdmin({ searchParams }) {
  const sp = (await searchParams) || {};
  const typeFilter = BLURB_TYPES.includes(sp.type) ? sp.type : null;

  const pending = await getPendingBlurbs({ blurbType: typeFilter });
  const recent  = await getRecentlyReviewed({ limit: 10 });

  return (
    <main style={{
      maxWidth: 900,
      margin: '0 auto',
      padding: '32px 24px 80px',
      fontFamily: 'var(--font-mono)',
      color: 'var(--paper-warm)',
      fontSize: 14,
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontStyle: 'italic',
        fontWeight: 900,
        fontSize: 32,
        textTransform: 'uppercase',
        marginBottom: 16,
      }}>Editorial Blurbs · Review</h1>

      <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        AI-generated blurbs surface ONLY after editor approval. Pending rows never appear on entity pages.
      </p>

      {/* Type filter */}
      <nav style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        <a href="/admin/blurbs" style={filterStyle(typeFilter === null)}>All</a>
        {BLURB_TYPES.map((t) => (
          <a key={t} href={`/admin/blurbs?type=${t}`} style={filterStyle(typeFilter === t)}>{t.replace(/_/g, ' ')}</a>
        ))}
      </nav>

      <h2 style={sectionHeaderStyle('var(--volt)')}>Pending Review · {pending.length}</h2>

      {/* Bulk-approve — only when filtered to a single blurb_type and pending > 0.
          Per-row approve/reject still available below; this is additive. */}
      {pending.length > 0 && typeFilter && (
        <form
          action={bulkApproveAction}
          style={{
            background: 'var(--ink)',
            border: '1px solid var(--rule-dark)',
            borderLeft: '3px solid var(--volt)',
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input type="hidden" name="blurbType" value={typeFilter} />
          <input type="hidden" name="reviewedBy" value="admin" />
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--paper-warm)' }}>
            Approve ALL {pending.length} pending · {typeFilter.replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            type <span style={{ color: 'var(--volt)' }}>APPROVE</span> to confirm →
          </div>
          <input
            type="text"
            name="confirm"
            placeholder="APPROVE"
            autoComplete="off"
            required
            style={{
              background: 'transparent',
              color: 'var(--paper-warm)',
              border: '1px solid var(--rule-dark)',
              padding: '8px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              width: 140,
              letterSpacing: '0.18em',
            }}
          />
          <button type="submit" style={approveButtonStyle}>Approve All</button>
        </form>
      )}

      {pending.length === 0 && (
        <p style={{ padding: '16px 0', color: 'var(--muted)' }}>
          No pending {typeFilter ? typeFilter.replace(/_/g, ' ') : 'blurbs'}. Generators land draft rows here.
        </p>
      )}

      {pending.map((row) => {
        const gi = row.generation_input || {};
        const validation = gi.validation || {};
        const wordCount = row.word_count ?? validation.word_count ?? null;
        const keyPhrase = gi.key_phrase ?? null;
        const href = entityHref(row.entity_kind, row.entity_slug);

        return (
          <article
            key={row.id}
            style={{
              background: 'var(--graphite)',
              border: '1px solid var(--rule-dark)',
              borderLeft: '3px solid var(--volt)',
              padding: '20px 24px',
              marginBottom: 16,
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--rule-darker)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                  {href ? <a href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{row.entity_name || '—'}</a> : (row.entity_name || '—')}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.18em', textTransform: 'uppercase', marginTop: 4 }}>
                  {row.blurb_type.replace(/_/g, ' ')} · {row.entity_kind} · generated {fmtTime(row.generated_at)}
                </div>
              </div>
              <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: validation.ok ? 'var(--volt)' : (validation.issues?.length ? 'var(--terra)' : 'var(--muted)') }}>
                {validation.ok ? '✓ Validates' : (validation.issues?.length ? `⚠ ${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}` : '· no validation')}
              </div>
            </header>

            {/* Body — render readable. For team_outlook this is two paragraphs separated by a blank line; render the blank line as paragraph breaks. */}
            <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18, lineHeight: 1.55, color: 'var(--paper-warm)', marginBottom: 16 }}>
              {(row.body || '').split(/\n\s*\n/).map((para, i) => (
                <p key={i} style={{ margin: i === 0 ? '0 0 14px 0' : '0 0 14px 0' }}>{para}</p>
              ))}
            </div>

            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 16 }}>
              {wordCount != null && <span>Words: {wordCount}</span>}
              {wordCount != null && <span> · </span>}
              <span>Tier: {row.generation_tier}</span>
              <span> · </span>
              <span>Voice: {row.voice_model_version}</span>
              {keyPhrase && (
                <>
                  <span> · </span>
                  <span>Key phrase: <span style={{ color: 'var(--paper-warm)', textTransform: 'none', letterSpacing: 0, fontStyle: 'italic' }}>“{keyPhrase}”</span></span>
                </>
              )}
              {validation.issues?.length > 0 && (
                <ul style={{ marginTop: 8, color: 'var(--terra)', textTransform: 'none', letterSpacing: 0, listStyle: 'disc', paddingLeft: 20 }}>
                  {validation.issues.map((iss, i) => (<li key={i}>{iss}</li>))}
                </ul>
              )}
              {row.editor_notes && (
                <div style={{ marginTop: 8, color: 'var(--terra)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>{row.editor_notes}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <form action={approveAction}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" style={approveButtonStyle}>Approve &amp; Publish</button>
              </form>
              <form action={rejectAction} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="hidden" name="id" value={row.id} />
                <input
                  type="text"
                  name="notes"
                  placeholder="Reject reason (optional)"
                  style={{
                    background: 'transparent',
                    color: 'var(--paper-warm)',
                    border: '1px solid var(--rule-dark)',
                    padding: '9px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    width: 240,
                  }}
                />
                <button type="submit" style={rejectButtonStyle}>Reject</button>
              </form>
            </div>
          </article>
        );
      })}

      {recent.length > 0 && (
        <>
          <h2 style={sectionHeaderStyle('var(--muted)')}>Recently Reviewed</h2>
          {recent.map((r) => (
            <div key={r.id} style={{
              padding: '12px 0',
              borderBottom: '1px solid var(--rule-darker)',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 16,
              alignItems: 'baseline',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                {r.blurb_type.replace(/_/g, ' ')} · {r.entity_name || '—'}
              </span>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--muted-light)' }}>
                {(r.body || '').slice(0, 140).replace(/\s+/g, ' ')}{(r.body?.length ?? 0) > 140 ? '…' : ''}
              </span>
              <span style={{
                fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: r.status === 'editor_approved' ? 'var(--volt)'
                     : r.status === 'rejected' ? 'var(--terra)'
                     : 'var(--muted)',
              }}>{r.status}</span>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

// ─── style helpers ───────────────────────────────────────────────────────
function sectionHeaderStyle(color) {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.24em',
    textTransform: 'uppercase',
    color,
    marginTop: 32,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid var(--rule-dark)',
  };
}

function filterStyle(active) {
  return {
    padding: '6px 12px',
    border: '1px solid var(--rule-dark)',
    color: active ? 'var(--ink)' : 'var(--paper-warm)',
    background: active ? 'var(--volt)' : 'transparent',
    textDecoration: 'none',
  };
}

const approveButtonStyle = {
  background: 'var(--volt)',
  color: 'var(--ink)',
  border: 'none',
  padding: '10px 18px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
const rejectButtonStyle = {
  background: 'transparent',
  color: 'var(--paper-warm)',
  border: '1px solid var(--rule-dark)',
  padding: '10px 18px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

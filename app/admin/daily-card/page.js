/**
 * /admin/daily-card — Daily Card intro review queue.
 *
 * Smallest viable review surface (mirrors the spirit of /admin/prematch
 * without the editor-form polish). Lists daily_card_intros where
 * status='pending_review' ordered by pt_day DESC + below them the
 * recently-published intros for context.
 *
 * Actions (server actions):
 *   · Approve & publish → status='published', published_at=now()
 *   · Reject            → status='rejected'
 *   · (Re-generate is via scripts/generate-daily-card-intro.mjs — UPSERT
 *     on pt_day overwrites the prior draft.)
 *
 * Auth: same proxy/middleware layer as /admin/prematch (handled at the
 * routing layer, not this file). If the user reaches this page they're
 * already authenticated as admin.
 */

import { sql } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

async function approveIntro(formData) {
  'use server';
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id < 1) return;
  await sql`
    UPDATE daily_card_intros
       SET status = 'published',
           reviewed_at = now(),
           reviewed_by = COALESCE(reviewed_by, 'admin'),
           published_at = now(),
           updated_at = now()
     WHERE id = ${id}
       AND status = 'pending_review'
  `;
  // Revalidate both the admin queue and the homepage (which reads the
  // published intro for today's PT day).
  revalidatePath('/admin/daily-card');
  revalidatePath('/');
}

async function rejectIntro(formData) {
  'use server';
  const id = Number(formData.get('id'));
  if (!Number.isFinite(id) || id < 1) return;
  await sql`
    UPDATE daily_card_intros
       SET status = 'rejected',
           reviewed_at = now(),
           reviewed_by = COALESCE(reviewed_by, 'admin'),
           updated_at = now()
     WHERE id = ${id}
       AND status = 'pending_review'
  `;
  revalidatePath('/admin/daily-card');
}

function fmtTime(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(d));
}

export default async function DailyCardAdmin() {
  const pending = await sql`
    SELECT id, pt_day, body, status, generated_at, model_meta, notes
      FROM daily_card_intros
     WHERE status = 'pending_review'
     ORDER BY pt_day DESC, id DESC
  `;

  const recent = await sql`
    SELECT id, pt_day, body, status, published_at, reviewed_at, generated_at
      FROM daily_card_intros
     WHERE status IN ('published', 'rejected')
     ORDER BY COALESCE(published_at, reviewed_at, generated_at) DESC
     LIMIT 10
  `;

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
      }}>Daily Card Intros · Review</h1>

      <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        Pending intros never surface on the homepage. Approve to publish; reject to drop.
      </p>

      <h2 style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.24em',
        textTransform: 'uppercase',
        color: 'var(--volt)',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid var(--rule-dark)',
      }}>Pending Review · {pending.length}</h2>

      {pending.length === 0 && (
        <p style={{ padding: '16px 0', color: 'var(--muted)' }}>
          No pending intros. Re-generate via{' '}
          <code style={{ color: 'var(--volt)' }}>scripts/generate-daily-card-intro.mjs</code>.
        </p>
      )}

      {pending.map((row) => {
        const meta = row.model_meta || {};
        const v = meta.validation || {};
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
                  PT {row.pt_day instanceof Date ? row.pt_day.toISOString().slice(0,10) : row.pt_day}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.18em', textTransform: 'uppercase', marginTop: 4 }}>
                  Generated {fmtTime(row.generated_at)}
                </div>
              </div>
              <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: v.ok ? 'var(--volt)' : 'var(--terra)' }}>
                {v.ok ? '✓ Validates' : (v.issues?.length ? '⚠ ' + v.issues.length + ' issue' + (v.issues.length === 1 ? '' : 's') : '?')}
              </div>
            </header>

            <p style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 18,
              lineHeight: 1.5,
              color: 'var(--paper-warm)',
              marginBottom: 16,
            }}>{row.body}</p>

            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 16 }}>
              {v.word_count != null && <span>Words: {v.word_count} · </span>}
              <span>Model: {meta.model ?? '?'}</span>
              {row.notes && <div style={{ marginTop: 6, color: 'var(--terra)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>{row.notes}</div>}
              {v.issues?.length > 0 && (
                <ul style={{ marginTop: 8, color: 'var(--terra)', textTransform: 'none', letterSpacing: 0, listStyle: 'disc', paddingLeft: 20 }}>
                  {v.issues.map((iss, i) => (<li key={i}>{iss}</li>))}
                </ul>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <form action={approveIntro}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  style={{
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
                  }}
                >Approve &amp; Publish</button>
              </form>
              <form action={rejectIntro}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  style={{
                    background: 'transparent',
                    color: 'var(--paper-warm)',
                    border: '1px solid var(--rule-dark)',
                    padding: '10px 18px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >Reject</button>
              </form>
            </div>
          </article>
        );
      })}

      {recent.length > 0 && (
        <>
          <h2 style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginTop: 48,
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: '1px solid var(--rule-dark)',
          }}>Recently Reviewed</h2>
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
                PT {r.pt_day instanceof Date ? r.pt_day.toISOString().slice(0,10) : r.pt_day}
              </span>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--muted-light)' }}>
                {r.body.slice(0, 120)}{r.body.length > 120 ? '…' : ''}
              </span>
              <span style={{
                fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: r.status === 'published' ? 'var(--volt)' : 'var(--terra)',
              }}>{r.status}</span>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

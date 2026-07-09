/**
 * /admin/topic-drafts - prompt-attached AI draft admin surface.
 *
 * Proxy-gated (same as the other /admin pages); Server Actions re-assert the
 * admin env fail-closed. A textarea + Generate runs lib/topicDraft.js; drafts
 * appear in a status-ordered list with a PROMPTED - AI DRAFT badge and the
 * original prompt shown above the draft. Review is READ-ONLY for v1: no diff
 * view, no inline editing. Publish is disabled (blocked on the /article/[slug]
 * route). Discard (status -> discarded) is the only mutation on a draft.
 */

import { sql } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { runTopicDraft } from '@/lib/topicDraft';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata = { title: 'Topic Drafts - Admin', robots: { index: false, follow: false } };

function assertAdminEnv() {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_SECRET) {
    throw new Error('Admin auth misconfigured');
  }
}

async function generateTopicDraft(formData) {
  'use server';
  assertAdminEnv();
  const prompt = (formData.get('prompt') ?? '').toString().trim();
  if (!prompt) return;
  await runTopicDraft(prompt);
  revalidatePath('/admin/topic-drafts');
}

async function discardTopicDraft(formData) {
  'use server';
  assertAdminEnv();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id) || id <= 0) return;
  await sql`UPDATE topic_drafts SET status = 'discarded', updated_at = now() WHERE id = ${id} AND status <> 'published'`;
  revalidatePath('/admin/topic-drafts');
}

const STATUS_COLOR = {
  pending_review: '#1a7f37', in_editing: '#9a6700', published: '#0969da',
  discarded: '#6e7781', failed: '#cf222e',
};

export default async function TopicDraftsPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const selectedId = Number(sp.id) || null;

  const drafts = await sql`
    SELECT id, prompt_text, article_type, status, generated_at,
           current_content, ai_original, resolved_entities, unresolved_entities, research_sources, editor_notes
      FROM topic_drafts
     ORDER BY generated_at DESC
     LIMIT 50
  `;
  const selected = (selectedId ? drafts.find((d) => d.id === selectedId) : drafts[0]) ?? null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'system-ui, sans-serif', color: '#1f2328' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Topic Drafts</h1>
      <p style={{ color: '#57606a', fontSize: 13, marginTop: 0 }}>
        Prompt-attached AI drafts. Editor-only - never published as written. Review is read-only for v1.
      </p>

      <form action={generateTopicDraft} style={{ margin: '16px 0 28px' }}>
        <textarea
          name="prompt"
          required
          rows={3}
          placeholder="Write an article on ..."
          style={{ width: '100%', padding: 10, fontSize: 14, border: '1px solid #d0d7de', borderRadius: 6, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ marginTop: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#1f883d', border: 0, borderRadius: 6, cursor: 'pointer' }}>
          Generate
        </button>
        <span style={{ marginLeft: 12, color: '#57606a', fontSize: 12 }}>Runs plan - research - envelope - write. Lands in pending_review.</span>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#57606a', marginBottom: 8 }}>
            Drafts ({drafts.length})
          </div>
          {drafts.length === 0 && <div style={{ color: '#57606a', fontSize: 13 }}>None yet.</div>}
          {drafts.map((d) => {
            const c = d.current_content ?? {};
            const active = selected && d.id === selected.id;
            return (
              <a key={d.id} href={`/admin/topic-drafts?id=${d.id}`}
                 style={{ display: 'block', padding: '10px 12px', marginBottom: 6, textDecoration: 'none', color: '#1f2328',
                          border: `1px solid ${active ? '#0969da' : '#d0d7de'}`, borderRadius: 6, background: active ? '#f6f8fa' : '#fff' }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{c.headline ?? d.prompt_text.slice(0, 60)}</div>
                <div style={{ fontSize: 11, color: STATUS_COLOR[d.status] ?? '#57606a', marginTop: 4, fontWeight: 600 }}>
                  {d.status.replace('_', ' ')}{d.article_type ? ` · ${d.article_type}` : ''}
                </div>
              </a>
            );
          })}
        </div>

        <div>
          {!selected && <div style={{ color: '#57606a' }}>Select a draft.</div>}
          {selected && <DraftDetail draft={selected} />}
        </div>
      </div>
    </main>
  );
}

function DraftDetail({ draft }) {
  const c = draft.current_content ?? {};
  const sources = Array.isArray(draft.research_sources) ? draft.research_sources : [];
  const resolved = Array.isArray(draft.resolved_entities) ? draft.resolved_entities : [];
  const unresolved = Array.isArray(draft.unresolved_entities) ? draft.unresolved_entities : [];
  const sections = Array.isArray(c.sections) ? c.sections : [];
  const failed = draft.status === 'failed' || c.error;
  const warnings = Array.isArray(draft.ai_original?.validation?.warnings) ? draft.ai_original.validation.warnings : [];

  return (
    <article>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#8250df', border: '1px solid #d0b8f0', background: '#faf5ff', padding: '3px 7px', borderRadius: 3 }}>
          PROMPTED - AI DRAFT
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[draft.status] ?? '#57606a' }}>{draft.status.replace('_', ' ')}</span>
        {draft.article_type && <span style={{ fontSize: 11, color: '#57606a' }}>{draft.article_type}</span>}
      </div>

      <div style={{ background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#57606a', marginBottom: 3 }}>Original prompt</div>
        <div style={{ fontSize: 14 }}>{draft.prompt_text}</div>
      </div>

      {failed && (
        <div style={{ background: '#ffebe9', border: '1px solid #ff818266', borderRadius: 6, padding: '10px 12px', marginBottom: 16, fontSize: 13, color: '#cf222e' }}>
          Validation failed - not queued for review. {draft.editor_notes ?? ''}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ background: '#fff8c5', border: '1px solid #d4a72c66', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#7d4e00', marginBottom: 6 }}>
            Flagged terms ({warnings.length}) - warnings only, not blocking
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 13, marginBottom: 4, color: '#4d3800' }}>
                <b>{w.term}</b> - {w.sentence}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.headline && <h2 style={{ fontSize: 24, margin: '0 0 6px', lineHeight: 1.2 }}>{c.headline}</h2>}
      {c.dek && <p style={{ fontSize: 15, color: '#57606a', fontStyle: 'italic', marginTop: 0 }}>{c.dek}</p>}

      {sections.map((s, i) => (
        <section key={i} style={{ marginTop: 18 }}>
          {s.heading && <h3 style={{ fontSize: 16, margin: '0 0 6px' }}>{s.heading}</h3>}
          {String(s.body ?? '').split(/\n\n+/).map((para, j) => (
            <p key={j} style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 10px' }}>{para}</p>
          ))}
        </section>
      ))}

      {(resolved.length > 0 || unresolved.length > 0) && (
        <div style={{ marginTop: 24, fontSize: 12, color: '#57606a' }}>
          <b>Entities</b> - resolved: {resolved.map((e) => `${e.matched_name ?? e.name} (${e.kind})`).join(', ') || 'none'}
          {unresolved.length > 0 && <> · unresolved: {unresolved.map((e) => `${e.name} (${e.kind})`).join(', ')}</>}
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#57606a' }}>
          <b>Research sources</b> ({sources.length}):
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {sources.slice(0, 12).map((s, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                [T{s.tier}] <a href={s.url} style={{ color: '#0969da' }}>{s.title || s.url}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" disabled title="Blocked on the /article/[slug] route"
                style={{ padding: '7px 14px', fontSize: 13, color: '#8c959f', background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 6, cursor: 'not-allowed' }}>
          Publish
        </button>
        <span style={{ fontSize: 11, color: '#8c959f' }}>Publish blocked on the /article/[slug] route.</span>
        {draft.status !== 'discarded' && draft.status !== 'published' && (
          <form action={discardTopicDraft} style={{ marginLeft: 'auto' }}>
            <input type="hidden" name="id" value={draft.id} />
            <button type="submit" style={{ padding: '7px 14px', fontSize: 13, color: '#cf222e', background: '#fff', border: '1px solid #d0d7de', borderRadius: 6, cursor: 'pointer' }}>
              Discard
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

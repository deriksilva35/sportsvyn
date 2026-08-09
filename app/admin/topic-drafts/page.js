/**
 * /admin/topic-drafts - prompt-attached AI draft admin surface.
 *
 * Proxy-gated (same as the other /admin pages); Server Actions re-assert the
 * admin env fail-closed. A league picker + a textarea + Generate runs
 * lib/topicDraft.js; drafts appear in a status-ordered list with a
 * PROMPTED - AI DRAFT badge and the original prompt shown above the draft.
 * Review is read-only here: no diff view, no inline editing. Discard
 * (status -> discarded) and Publish are the mutations on a draft.
 *
 * LEAGUE IS CHOSEN BEFORE GENERATION, NOT AFTER (migration 060). It drives the
 * envelope readers, three placeholders in the stored prompt, and the league_id
 * stamped at publish - so it cannot be inferred from the prose afterwards, and
 * it is stored on the row rather than re-derived. The publish path used to
 * hardcode 'fifa-wc-2026'; a football article published through it would have
 * been tagged World Cup and would never have appeared in Today's Reads.
 *
 * Contrast: this is a review surface for article prose, so it runs on the dark
 * Sportsvyn surface with paper-warm text. Locked tokens - draft body, dek, and
 * editor notes are paper-warm #F5F5F2 at FULL opacity (article prose, not
 * secondary UI); secondary text (labels, timestamps, status) never below
 * rgba(245,245,242,0.65); placeholder minimum 0.5.
 */

import { sql } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runTopicDraft } from '@/lib/topicDraft';
import { TOPIC_DRAFT_LEAGUES, TOPIC_DRAFT_LEAGUE_SLUGS, WC_LEAGUE_SLUG } from '@/lib/topicDraftLeagues';
import { publishTopicDraft } from '@/lib/articleReader';
import PublishTopicDraftButton from '@/components/admin/PublishTopicDraftButton';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata = { title: 'Topic Drafts - Admin', robots: { index: false, follow: false } };

// Locked contrast tokens.
const PROSE = '#F5F5F2';                       // article prose, full opacity
const SECONDARY = 'rgba(245,245,242,0.65)';    // labels/timestamps/status floor
const FAINT = 'rgba(245,245,242,0.5)';         // placeholder / disabled floor
const BORDER = 'rgba(245,245,242,0.16)';
const CARD = 'rgba(245,245,242,0.05)';
const LINK = '#58a6ff';

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
  // Whitelisted here rather than trusted from the form: a hand-posted league
  // would otherwise reach the FK as a bad slug, or worse, resolve to a league
  // the envelope readers know nothing about.
  const league = (formData.get('league') ?? '').toString();
  if (!TOPIC_DRAFT_LEAGUE_SLUGS.includes(league)) return;
  await runTopicDraft(prompt, { leagueSlug: league });
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

// Publish a pending_review / in_editing topic draft into a live article.
// Flattens sections -> clean semantic HTML (h2/p, no inline styles, no legacy
// classes); type 'feature', author 'Sportsvyn' with the AI-draft provenance
// treatment (honest label, per the Tier rules - editor byline comes later).
//
// The work is in lib/articleReader.publishTopicDraft. A Server Action cannot be
// called from a script or a test, so leaving the body here meant the single most
// consequential step in the pipeline was the only one nothing could exercise.
// This is the thin caller: admin gate, then revalidate and go read the piece.
async function publishTopicDraftAction(formData) {
  'use server';
  assertAdminEnv();
  const r = await publishTopicDraft(Number(formData.get('id')));
  revalidatePath('/admin/topic-drafts');
  revalidatePath('/');
  if (!r.ok) return;
  redirect(`/article/${r.slug}`);
}

// Status colors, legible on the dark surface (>= 0.65 luminance-equivalent).
const STATUS_COLOR = {
  pending_review: '#3fb950', in_editing: '#e3b341', published: '#58a6ff',
  discarded: SECONDARY, failed: '#f85149',
};

export default async function TopicDraftsPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const selectedId = Number(sp.id) || null;

  const drafts = await sql`
    SELECT id, prompt_text, league_slug, article_type, status, generated_at,
           current_content, ai_original, resolved_entities, unresolved_entities, research_sources, editor_notes
      FROM topic_drafts
     ORDER BY generated_at DESC
     LIMIT 50
  `;
  const selected = (selectedId ? drafts.find((d) => d.id === selectedId) : drafts[0]) ?? null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'system-ui, sans-serif', color: PROSE }}>
      <style>{`body{background:#141311} .td-textarea::placeholder{color:${FAINT}}`}</style>
      <h1 style={{ fontSize: 22, marginBottom: 4, color: PROSE }}>Topic Drafts</h1>
      <p style={{ color: SECONDARY, fontSize: 13, marginTop: 0 }}>
        Prompt-attached AI drafts. Editor-only - never published as written. Review is read-only for v1.
      </p>

      <form action={generateTopicDraft} style={{ margin: '16px 0 28px' }}>
        {/* League first, and required. It is not a filter on the output - it
            picks which readers build the envelope and which words the prompt
            uses, so it has to be decided before the model runs, not after. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <label htmlFor="td-league" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: SECONDARY }}>
            League
          </label>
          <select
            id="td-league"
            name="league"
            defaultValue={WC_LEAGUE_SLUG}
            style={{ padding: '7px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: PROSE, fontFamily: 'inherit' }}
          >
            {TOPIC_DRAFT_LEAGUE_SLUGS.map((s) => (
              <option key={s} value={s} style={{ background: '#141311', color: PROSE }}>
                {TOPIC_DRAFT_LEAGUES[s].label}
              </option>
            ))}
          </select>
          <span style={{ color: SECONDARY, fontSize: 12 }}>Drives the envelope, the prompt, and the league the article publishes under.</span>
        </div>
        <textarea
          name="prompt"
          className="td-textarea"
          required
          rows={3}
          placeholder="Write an article on ..."
          style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${BORDER}`, borderRadius: 6, fontFamily: 'inherit', boxSizing: 'border-box', background: CARD, color: PROSE }}
        />
        <button type="submit" style={{ marginTop: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#2ea043', border: 0, borderRadius: 6, cursor: 'pointer' }}>
          Generate
        </button>
        <span style={{ marginLeft: 12, color: SECONDARY, fontSize: 12 }}>Runs plan - research - envelope - write. Lands in pending_review.</span>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: SECONDARY, marginBottom: 8 }}>
            Drafts ({drafts.length})
          </div>
          {drafts.length === 0 && <div style={{ color: SECONDARY, fontSize: 13 }}>None yet.</div>}
          {drafts.map((d) => {
            const c = d.current_content ?? {};
            const active = selected && d.id === selected.id;
            return (
              <a key={d.id} href={`/admin/topic-drafts?id=${d.id}`}
                 style={{ display: 'block', padding: '10px 12px', marginBottom: 6, textDecoration: 'none', color: PROSE,
                          border: `1px solid ${active ? LINK : BORDER}`, borderRadius: 6, background: active ? CARD : 'transparent' }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{c.headline ?? d.prompt_text.slice(0, 60)}</div>
                <div style={{ fontSize: 11, color: STATUS_COLOR[d.status] ?? SECONDARY, marginTop: 4, fontWeight: 600 }}>
                  {d.status.replace('_', ' ')}{d.article_type ? ` · ${d.article_type}` : ''}
                </div>
                {/* The league the draft will publish under, on the row rather
                    than only in the detail pane - it is the one property that
                    cannot be corrected after the fact. */}
                <div style={{ fontSize: 10, color: SECONDARY, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {TOPIC_DRAFT_LEAGUES[d.league_slug]?.label ?? d.league_slug}
                </div>
              </a>
            );
          })}
        </div>

        <div>
          {!selected && <div style={{ color: SECONDARY }}>Select a draft.</div>}
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
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#bc8cff', border: '1px solid rgba(188,140,255,0.4)', background: 'rgba(188,140,255,0.1)', padding: '3px 7px', borderRadius: 3 }}>
          PROMPTED - AI DRAFT
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[draft.status] ?? SECONDARY }}>{draft.status.replace('_', ' ')}</span>
        {draft.article_type && <span style={{ fontSize: 11, color: SECONDARY }}>{draft.article_type}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: PROSE, border: `1px solid ${BORDER}`, padding: '3px 7px', borderRadius: 3 }}>
          {TOPIC_DRAFT_LEAGUES[draft.league_slug]?.label ?? draft.league_slug}
        </span>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: SECONDARY, marginBottom: 3 }}>Original prompt</div>
        <div style={{ fontSize: 14, color: PROSE }}>{draft.prompt_text}</div>
      </div>

      {failed && (
        <div style={{ background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.4)', borderRadius: 6, padding: '10px 12px', marginBottom: 16, fontSize: 13, color: PROSE }}>
          <b style={{ color: '#f85149' }}>Validation failed</b> - not queued for review. {draft.editor_notes ?? ''}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ background: 'rgba(227,179,65,0.1)', border: '1px solid rgba(227,179,65,0.35)', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#e3b341', marginBottom: 6 }}>
            Flagged terms ({warnings.length}) - warnings only, not blocking
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 13, marginBottom: 4, color: PROSE }}>
                <b>{w.term}</b> - {w.sentence}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.headline && <h2 style={{ fontSize: 24, margin: '0 0 6px', lineHeight: 1.2, color: PROSE }}>{c.headline}</h2>}
      {c.dek && <p style={{ fontSize: 15, color: PROSE, fontStyle: 'italic', marginTop: 0 }}>{c.dek}</p>}

      {sections.map((s, i) => (
        <section key={i} style={{ marginTop: 18 }}>
          {s.heading && <h3 style={{ fontSize: 16, margin: '0 0 6px', color: PROSE }}>{s.heading}</h3>}
          {String(s.body ?? '').split(/\n\n+/).map((para, j) => (
            <p key={j} style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 10px', color: PROSE }}>{para}</p>
          ))}
        </section>
      ))}

      {(resolved.length > 0 || unresolved.length > 0) && (
        <div style={{ marginTop: 24, fontSize: 12, color: SECONDARY }}>
          <b>Entities</b> - resolved: {resolved.map((e) => `${e.matched_name ?? e.name} (${e.kind})`).join(', ') || 'none'}
          {unresolved.length > 0 && <> · unresolved: {unresolved.map((e) => `${e.name} (${e.kind})`).join(', ')}</>}
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: SECONDARY }}>
          <b>Research sources</b> ({sources.length}):
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {sources.slice(0, 12).map((s, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                [T{s.tier}] <a href={s.url} style={{ color: LINK }}>{s.title || s.url}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        {(draft.status === 'pending_review' || draft.status === 'in_editing') ? (
          <PublishTopicDraftButton
            action={publishTopicDraftAction}
            id={draft.id}
            leagueLabel={TOPIC_DRAFT_LEAGUES[draft.league_slug]?.label ?? draft.league_slug}
          />
        ) : (
          <button type="button" disabled
                  style={{ padding: '7px 14px', fontSize: 13, color: FAINT, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'not-allowed' }}>
            Publish
          </button>
        )}
        {draft.status === 'published' && <span style={{ fontSize: 11, color: SECONDARY }}>Published.</span>}
        {draft.status !== 'discarded' && draft.status !== 'published' && (
          <form action={discardTopicDraft} style={{ marginLeft: 'auto' }}>
            <input type="hidden" name="id" value={draft.id} />
            <button type="submit" style={{ padding: '7px 14px', fontSize: 13, color: '#f85149', background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer' }}>
              Discard
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

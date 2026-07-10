import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { getArticleBySlug } from '@/lib/articles';
import { normalizeArticle } from '@/lib/articleReader';
import './article.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = await getArticleBySlug(slug);
  if (!a || a.status !== 'published') return {};
  return { title: a.title, description: a.subtitle || undefined };
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Byline: human authors get "By X"; auto-generated and AI-draft pieces get the
// provenance treatment (label + optional review note), never a human byline.
function Byline({ byline }) {
  if (byline.kind === 'human') return <span className="by">{byline.label}</span>;
  return (
    <span className="prov">
      <span className="prov-label">{byline.label}</span>
      {byline.note ? <span className="prov-note">{byline.note}</span> : null}
    </span>
  );
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  const a = await getArticleBySlug(slug);
  // Published only. Drafts / previews-in-progress / unpublished all 404.
  if (!a || a.status !== 'published') notFound();

  const art = normalizeArticle(a);

  return (
    <>
      <SiteHeaderServer />
      <main className="article-wrap">
        <article className="article-col">
          {art.kicker ? <span className="article-kicker">{art.kicker}</span> : null}
          <h1 className="article-headline">{art.headline}</h1>
          {art.dek ? <p className="article-dek">{art.dek}</p> : null}
          <div className="article-meta">
            <Byline byline={art.byline} />
            <span className="dot">·</span>
            <span>{fmtDate(art.publishedAt)}</span>
            <span className="dot">·</span>
            <span>{art.readMin} min read</span>
          </div>

          {art.kind === 'raw' ? (
            // Legacy essay: self-contained markup (a-hero6 etc.). Verbatim pass-
            // through - do NOT re-parse or double-wrap.
            <div className="a-body" dangerouslySetInnerHTML={{ __html: art.rawHtml }} />
          ) : (
            // Preview prose + published topic-draft features (clean h2/p): the
            // reader typography styles this semantic content.
            <div className="a-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {art.body || ''}
              </ReactMarkdown>
            </div>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

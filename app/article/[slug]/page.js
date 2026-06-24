import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { getArticleBySlug } from '@/lib/articles';
import './article.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = await getArticleBySlug(slug);
  if (!a || a.status !== 'published') return {};
  return { title: a.title, description: a.subtitle || undefined };
}

function readTime(body) {
  const words = (body || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 250));
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function ArticlePage({ params }) {
  const { slug } = await params;
  const a = await getArticleBySlug(slug);
  if (!a || a.status !== 'published') notFound();

  const kicker = [a.primary_tag_name, a.league_name].filter(Boolean).join(' · ');

  return (
    <>
      <SiteHeaderServer />
      <main className="article-wrap">
        <article className="article-col">
          {kicker ? <span className="article-kicker">{kicker}</span> : null}
          <h1 className="article-headline">{a.title}</h1>
          {a.subtitle ? <p className="article-dek">{a.subtitle}</p> : null}
          <div className="article-meta">
            {a.author ? <span className="by">By {a.author}</span> : null}
            {a.author ? <span className="dot">·</span> : null}
            <span>{fmtDate(a.published_at)}</span>
            <span className="dot">·</span>
            <span>{readTime(a.body)} min read</span>
          </div>
          <div className="a-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {a.body || ''}
            </ReactMarkdown>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * MatchBrief — recap-tab body. Renders the Tier 1 brief
 * (match_briefs row: headline + paragraph_1 + paragraph_2 + optional
 * paragraph_3) using the same typography classes as PreviewLeft, so
 * recap and preview prose share visual treatment (Saira italic headline,
 * mono "By Sportsvyn · Auto-generated · <reltime>" byline, Source Serif
 * italic body with the volt drop-cap on the first paragraph).
 *
 * Renders a graceful stub when no brief exists yet (pre-FT, or the
 * generate-brief job hasn't run). The recap tab itself is only visible
 * when match.status='final', so this stub appears narrowly — between
 * full-time and the moment the brief lands.
 *
 * validation_status='fallback' rows render the same way as 'passed' —
 * the fallback template still produces a structurally complete brief.
 */

function relativeTime(date) {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return rtf.format(-diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  return rtf.format(-diffDay, 'day');
}

export default function MatchBrief({ brief = null }) {
  if (!brief) {
    return <div className="tab-stub">Recap publishes after full time.</div>;
  }

  const paragraphs = [brief.paragraph_1, brief.paragraph_2, brief.paragraph_3].filter(Boolean);
  const reltime = relativeTime(brief.published_at ?? brief.generated_at);

  return (
    <div>
      <h1 className="preview-headline">{brief.headline}</h1>
      <div className="preview-byline">
        <span>By</span> <span className="author">Sportsvyn</span>
        <span className="sep">·</span>
        <span>Auto-generated</span>
        {reltime && (
          <>
            <span className="sep">·</span>
            <span>{reltime}</span>
          </>
        )}
      </div>
      <div className="preview-prose">
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </div>
  );
}

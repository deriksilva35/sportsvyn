/**
 * PreviewLeft — editorial column of the two-column Preview tab.
 *
 * Renders the locked Option-C left column when an editorial preview row
 * exists (articles WHERE type='preview' AND score_type IS NULL):
 *   - .preview-headline   (Saira italic 36px, the article title)
 *   - .preview-byline     (mono, "By Sportsvyn · Auto-generated · <reltime>")
 *   - .preview-prose      (Source Serif italic 18px, body paragraphs;
 *                          the CSS rule .preview-prose p:first-child::first-letter
 *                          applies the volt drop-cap automatically)
 *
 * Auto-generated attribution: the byline is honest about provenance. When
 * the article eventually gets a human author edit (status flips, author
 * changes), this component still respects whatever author is set on the
 * row; the "Auto-generated" chip is only emitted when author === 'auto'.
 */

const DEFAULT_TZ = 'America/New_York';

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

function splitParagraphs(body) {
  if (!body || typeof body !== 'string') return [];
  return body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function PreviewLeft({ preview = null, match }) {
  if (preview && preview.body) {
    const paragraphs = splitParagraphs(preview.body);
    const isAuto = !preview.author || preview.author === 'auto';
    const authorLabel = isAuto ? 'Sportsvyn' : preview.author;
    const reltime = relativeTime(preview.published_at ?? preview.updated_at);

    return (
      <div>
        <h1 className="preview-headline">{preview.title}</h1>
        <div className="preview-byline">
          <span>By</span> <span className="author">{authorLabel}</span>
          {isAuto && (
            <>
              <span className="sep">·</span>
              <span>Auto-generated</span>
            </>
          )}
          {reltime && (
            <>
              <span className="sep">·</span>
              <span>{reltime}</span>
            </>
          )}
        </div>
        {preview.subtitle && (
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 18,
              lineHeight: 1.5,
              color: 'var(--muted-light)',
              maxWidth: 720,
              marginBottom: 24,
            }}
          >
            {preview.subtitle}
          </p>
        )}
        <div className="preview-prose">
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>
    );
  }

  const homeName = match?.home_name ?? 'Home';
  const awayName = match?.away_name ?? 'Away';

  return (
    <div>
      <h1 className="preview-headline">
        {homeName} <span className="accent">vs</span> {awayName}
      </h1>
      <div className="preview-byline">
        <span className="author">Preview pending</span>
        <span className="sep">·</span>
        <span>Auto-generated copy lands here when the analyst pass runs</span>
      </div>
      <div className="slot-empty" data-empty="preview-prose">
        <div className="slot-empty-label">Editorial Preview</div>
        <div className="slot-empty-body">
          The two-paragraph match preview appears in this column once
          generated. Until then, the rail to the right carries whatever
          structured signals are available (Watch Score, win probability,
          where to watch).
        </div>
      </div>
    </div>
  );
}

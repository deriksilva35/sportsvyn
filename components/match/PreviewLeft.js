/**
 * PreviewLeft — editorial column of the two-column Preview tab.
 *
 * SHELL: renders a placeholder slot in the .preview-prose container until
 * the auto-preview AI slice produces real prose. Headline + byline are
 * deferred too — they're tied to the preview generation.
 */

export default function PreviewLeft({ preview = null, match }) {
  if (preview) {
    return (
      <div>
        <h1 className="preview-headline">{preview.headline}</h1>
        <div className="preview-byline">
          <span>By</span> <span className="author">{preview.author ?? 'Sportsvyn'}</span>
          <span className="sep">·</span>
          <span>{preview.relative_time ?? ''}</span>
        </div>
        <div className="preview-prose">
          {(preview.paragraphs ?? []).map((p, i) => <p key={i}>{p}</p>)}
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

/**
 * WhereToWatch — rail slot for the locked Variant 1 layout from
 * sportsvyn-where-to-watch-spec.html. Groups broadcasters by type (TV
 * above Streaming). Primary broadcaster renders with volt name. ES tag
 * appears beside Spanish-language listings. Free tag (jade) is reserved
 * for is_free=true broadcasters (column doesn't exist in 013 yet — this
 * data won't render until a future migration adds it).
 *
 * SHELL: renders a slot-empty placeholder until the data layer wires.
 */

function BroadcasterRow({ b }) {
  const isPrimary = !!b.is_primary;
  const isSpanish = b.language_code && b.language_code !== 'en';
  return (
    <div className={`broadcaster-row${isPrimary ? ' primary' : ''}`}>
      <span className="broadcaster-name">{b.broadcaster_name}</span>
      {isSpanish && <span className="broadcaster-tag es">ES</span>}
    </div>
  );
}

export default function WhereToWatch({ broadcasters = null, region = 'USA' }) {
  if (!broadcasters) {
    return (
      <div className="slot-empty" data-empty="where-to-watch">
        <div className="slot-empty-label">Where to Watch</div>
        <div className="slot-empty-body">
          Broadcaster listings appear here once US lineups are confirmed for this fixture.
        </div>
      </div>
    );
  }

  if (broadcasters.length === 0) {
    return null;
  }

  const tv = broadcasters.filter((b) => b.broadcaster_type === 'tv');
  const streaming = broadcasters.filter((b) => b.broadcaster_type === 'streaming');

  return (
    <div className="watch-block">
      <div className="watch-block-header">
        <div className="watch-block-title">Where to Watch</div>
        <div className="watch-block-region">
          <span>{region}</span>
        </div>
      </div>
      {tv.length > 0 && (
        <div className="watch-block-section">
          <div className="watch-block-section-label">▣ Television</div>
          {tv.map((b) => <BroadcasterRow key={b.broadcaster_name} b={b} />)}
        </div>
      )}
      {streaming.length > 0 && (
        <div className="watch-block-section">
          <div className="watch-block-section-label">⏵ Streaming</div>
          {streaming.map((b) => <BroadcasterRow key={b.broadcaster_name} b={b} />)}
        </div>
      )}
    </div>
  );
}

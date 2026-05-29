/**
 * FormSection — full-width section, two form-card columns showing each
 * side's last 5 results. Renders null when neither side has prior finals
 * (sparse-data fixtures like the USA-Senegal friendly in our seed).
 */

export default function FormSection({ home = null, away = null }) {
  const hasAny = (home?.results?.length ?? 0) > 0 || (away?.results?.length ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">
          Recent <span className="accent">Form</span>
        </h2>
      </div>
      <div className="form-section">
        <FormCard side={home} fallbackName="Home" />
        <FormCard side={away} fallbackName="Away" />
      </div>
    </section>
  );
}

function FormCard({ side, fallbackName }) {
  const name = side?.team_name ?? fallbackName;
  const results = side?.results ?? [];
  if (results.length === 0) {
    return (
      <div className="form-card">
        <div className="form-card-header">
          <div className="form-card-team">{name}</div>
        </div>
        <div className="slot-empty-body">No recent finals on file.</div>
      </div>
    );
  }
  return (
    <div className="form-card">
      <div className="form-card-header">
        <div className="form-card-team">{name}</div>
        <div className="form-card-pills">
          {results.slice(-5).map((r, i) => (
            <div key={i} className={`form-pill ${r.code}`}>{r.code}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Articles — section is rendered with an empty state for now because the
 * articles table has no data seeded. Once articles ship, swap this for an
 * articles-grid driven by a getTeamArticles query.
 */

export default function Articles({ team }) {
  return (
    <section className="page-section" id="articles">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Articles</span>
          <h2 className="section-head-title">Reads · <span className="accent">{team.name}</span></h2>
        </div>
      </div>
      <p className="articles-empty">No coverage yet.</p>
    </section>
  );
}

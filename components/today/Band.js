// components/today/Band.js - a league band and its head.
//
// The band ships in the HTML whether its chip is on or not; LeagueChips
// toggles `.off`. The context line is DERIVED - contextLine() off the ranker's
// own signals - so a band cannot claim a game week it is not in. The locked
// mock reads "CFB · Week 0" and that was a mock-date artifact: the schedule
// says week 1, and this renders what the schedule says.

export function BandHead({ label, week, context, moreHref, moreLabel, top = false }) {
  return (
    <div className={`bandhead${top ? '' : ' sub'}`}>
      <h2>
        <span className="lg">{label}</span>
        {week != null ? ` · Week ${week}` : ''}
      </h2>
      {context ? <span className="ctx">{context}</span> : null}
      <span className="spacer" />
      {moreHref ? <a className="more" href={moreHref}>{moreLabel} &rarr;</a> : null}
    </div>
  );
}

export default function Band({ id, off = false, children }) {
  return (
    <section className={`band${off ? ' off' : ''}`} data-band={id}>
      {children}
    </section>
  );
}

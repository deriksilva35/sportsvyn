// components/today/LeagueBands.js - the per-league band bodies.
//
// Every module here is an EXISTING reader's output, re-laid-out. The relay's
// rule was that the carpentry changes and the reads survive, and they do:
// getEditorialBoard, getMovementCard, getSlateByDate, getEplStandings, plus the
// new EPL fixtures reader.
//
// THE ARTICLE MODULE IS CONDITIONAL AND WILL BE ABSENT AT LAUNCH. All 129
// published articles carry a soccer league_id, so getTodaysReads for nfl/cfb
// returns nothing and the band renders two modules instead of three. That is
// the ruled behaviour, not a hole: no empty frame, no "coming soon".

import { BandHead } from './Band';

function Mod({ title, ctx, children, cta, ctaHref }) {
  return (
    <div className="mod">
      <div className="eb"><span>{title}</span>{ctx ? <span className="ctx">{ctx}</span> : null}</div>
      {children}
      {cta ? <a className="ghostcta" href={ctaHref}>{cta} &rarr;</a> : null}
    </div>
  );
}

function Rows({ rows }) {
  return rows.map((r, i) => (
    <div className="row" key={r.key ?? i}>
      <div className="l">{r.pos != null ? <span className="pos">{r.pos}</span> : null}{r.label}</div>
      <div className={`v${r.dim ? ' sub' : ''}${r.down ? ' dn' : ''}`}>{r.value}</div>
    </div>
  ));
}

const KO = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});

/**
 * Slate rows, with the Board-1 badge decided by SET MEMBERSHIP against
 * currentPickemBoard().board - no second query, and no badge invented for a
 * game that merely looks like a board game.
 */
function SlateRows({ games, boardIds }) {
  return games.map((g) => {
    const onBoard = boardIds?.has(g.id);
    const isFinal = g.status === 'final';
    const time = KO.format(new Date(g.kickoffAt)).replace(' ', '').toLowerCase();
    return (
      <div className="srow" key={g.id}>
        <div className="when">{g.etWeekday}<br />{isFinal ? 'Final' : time}</div>
        <div>
          <div className="mu">
            {g.away?.abbreviation ?? g.away?.name} <span className="at">at</span> {g.home?.abbreviation ?? g.home?.name}
            {onBoard ? <span className="onboard">Board 1</span> : null}
          </div>
          <div className="stag">{g.week != null ? `Wk ${g.week}` : g.leagueName}</div>
        </div>
        <div className="fin">
          {isFinal ? `${g.awayScore}-${g.homeScore}` : null}
          <span className="s2">{isFinal ? 'FT' : 'Preview'}</span>
        </div>
      </div>
    );
  });
}

function ArticleRows({ reads }) {
  return reads.map((a) => (
    <div className="arow" key={a.slug}>
      <div className="kick">{a.kicker ?? a.tag_name ?? 'Read'}</div>
      <h4>{a.title}</h4>
    </div>
  ));
}

export function GridironBand({ id, label, week, context, slate, boardIds, board, boardTitle,
  boardCtx, boardCta, boardHref, movement, reads, hubHref, hubLabel }) {
  return (
    <>
      <BandHead label={label} week={week} context={context} moreHref={hubHref} moreLabel={hubLabel} />
      <div className="bmods">
        {slate?.length ? (
          <Mod title="The slate" ctx={boardIds?.size ? 'Board 1 marked' : null}
               cta="Full schedule" ctaHref={hubHref}>
            <SlateRows games={slate} boardIds={boardIds} />
          </Mod>
        ) : null}
        {board?.length ? (
          <Mod title={boardTitle} ctx={boardCtx} cta={boardCta} ctaHref={boardHref}>
            <Rows rows={board} />
          </Mod>
        ) : null}
        {movement}
        {reads?.length ? (
          <Mod title={`Latest ${label}`} cta={`All ${label} articles`} ctaHref="/articles">
            <ArticleRows reads={reads} />
          </Mod>
        ) : null}
      </div>
    </>
  );
}

export function EplBand({ context, fixtures, table, reads }) {
  return (
    <>
      <BandHead label="EPL" context={context} moreHref="/epl/standings" moreLabel="EPL hub" />
      <div className="bmods">
        {fixtures?.length ? (
          <Mod title="Results + fixtures" cta="Full schedule" ctaHref="/scores?sport=epl">
            {fixtures.map((f) => (
              <div className="srow" key={f.id}>
                <div className="when">{f.when.day}<br />{f.when.time}</div>
                <div>
                  <div className="mu">{f.away} <span className="at">at</span> {f.home}</div>
                </div>
                <div className="fin">
                  {f.isFinal ? `${f.awayScore}-${f.homeScore}` : null}
                  <span className="s2">{f.isFinal ? 'FT' : 'Preview'}</span>
                </div>
              </div>
            ))}
          </Mod>
        ) : null}
        {table?.length ? (
          <Mod title="Table" cta="Full table" ctaHref="/epl/standings">
            <Rows rows={table} />
          </Mod>
        ) : null}
        {reads?.length ? (
          <Mod title="Latest EPL" cta="All EPL articles" ctaHref="/articles">
            <ArticleRows reads={reads} />
          </Mod>
        ) : null}
      </div>
    </>
  );
}

/** The archive. Static links, and off by default - the tournament is over. */
export function ArchiveBand() {
  return (
    <>
      <BandHead label="World Cup" context="2026 · Kept, not deleted"
        moreHref="/world-cup-2026/bracket" moreLabel="The tournament" />
      <div className="bmods">
        <Mod title="The essays" cta="All 129 pieces" ctaHref="/articles">
          <div className="arow"><div className="kick">Essay</div>
            <h4>2026 World Cup rules: the laws</h4></div>
        </Mod>
        <Mod title="The bracket" cta="Open the bracket" ctaHref="/world-cup-2026/bracket">
          <Rows rows={[{ label: 'Final + full path', value: 'View', dim: true }]} />
        </Mod>
        <Mod title="Golden Boot race" cta="The race, kept" ctaHref="/world-cup-2026/golden-boot">
          <Rows rows={[{ label: 'Final standings', value: 'View', dim: true }]} />
        </Mod>
      </div>
    </>
  );
}

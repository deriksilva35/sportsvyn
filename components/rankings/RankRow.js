// components/rankings/RankRow.js - one ranked row, and THE YOU ROW.
//
// ONE COMPONENT FOR THE YOU ROW (item 6), used identically on all three
// views: a volt left bar, the volt-on-ink YOU pill after the name, and the
// rank column showing a dash when the reader does not rank yet. A second
// implementation per view is how three screens end up disagreeing about what
// "you" looks like.
//
// AND ONE COMPONENT FOR THE EXPANDING ROW. `expand` turns the row into a
// native <details> whose <summary> IS the row - same classes, same children,
// same order - so a power row that can show its working and a standings row
// that cannot are the same row with one difference the markup states.

import TeamMark from '@/components/team/TeamMark';

export default function RankRow({
  rank = null, name, sub = null, value = null, second = null,
  team = null, followed = false, you = false, right = null, expand = null,
}) {
  const body = (
    <>
      <span className="rnk-n">{rank ?? '–'}</span>
      {team ? (
        <TeamMark
          primary={team.colors?.primary} secondary={team.colors?.secondary}
          abbr={team.abbreviation} size={22} title={team.fullName ?? name}
          className={followed ? 'rk-mark fol' : 'rk-mark'}
        />
      ) : null}
      <span className="rnk-nm">
        {name}
        {you ? <b className="rk-you">YOU</b> : null}
        {sub ? <small>{sub}</small> : null}
      </span>
      {second != null ? <span className="rnk-v">{second}</span> : null}
      {value != null ? <span className={`rnk-v${you ? ' mu' : ''}`}>{value}</span> : null}
      {right}
    </>
  );
  // A ROW WITH WORKING BEHIND IT IS A DISCLOSURE; every other row is the div
  // it has always been. The class list is identical either way, so the YOU
  // row, the volt left bar and every existing style land the same on both -
  // and a row that has nothing to expand does not grow a triangle that opens
  // onto nothing.
  if (!expand) {
    return (
      <div className={`rk-row${you ? ' you' : ''}`} data-you={you ? '1' : undefined}>{body}</div>
    );
  }
  return (
    <details className="rk-exp">
      <summary className={`rk-row${you ? ' you' : ''}`} data-you={you ? '1' : undefined}>{body}</summary>
      {expand}
    </details>
  );
}

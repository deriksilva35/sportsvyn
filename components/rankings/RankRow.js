// components/rankings/RankRow.js - one ranked row, and THE YOU ROW.
//
// ONE COMPONENT FOR THE YOU ROW (item 6), used identically on all three
// views: a volt left bar, the volt-on-ink YOU pill after the name, and the
// rank column showing a dash when the reader does not rank yet. A second
// implementation per view is how three screens end up disagreeing about what
// "you" looks like.

import TeamMark from '@/components/team/TeamMark';

export default function RankRow({
  rank = null, name, sub = null, value = null, second = null,
  team = null, followed = false, you = false, right = null,
}) {
  return (
    <div className={`rk-row${you ? ' you' : ''}`} data-you={you ? '1' : undefined}>
      <span className="rk">{rank ?? '–'}</span>
      {team ? (
        <TeamMark
          primary={team.colors?.primary} secondary={team.colors?.secondary}
          abbr={team.abbreviation} size={22} title={team.fullName ?? name}
          className={followed ? 'rk-mark fol' : 'rk-mark'}
        />
      ) : null}
      <span className="nm">
        {name}
        {you ? <b className="rk-you">YOU</b> : null}
        {sub ? <small>{sub}</small> : null}
      </span>
      {second != null ? <span className="v">{second}</span> : null}
      {value != null ? <span className={`v${you ? ' mu' : ''}`}>{value}</span> : null}
      {right}
    </div>
  );
}

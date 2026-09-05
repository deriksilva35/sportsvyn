// components/today/WeekSlate.js - the league's week, first module in its band.
//
// THE ROW GRAMMAR IS THE MOCK'S srow, and it now lives in
// components/slate/SlateRow.js so /my can speak it too. The live and final
// DECISIONS still come from lib/today/slateRow.js, which TodaysGames also uses
// - two presentations, one decision-maker, so a game cannot read LIVE in the
// band and scheduled in the rail on the same screen. State in lib/, shape in
// components/slate/, and neither one guesses at the other's job.
//
// CAPPED AT SIX with a link to the full scoreboard. CFB week 1 is 99 games;
// a band module that tried to be a scoreboard would be a worse scoreboard than
// the scoreboard.

import SlateRow from '@/components/slate/SlateRow';
import { orderSlate, SLATE_ROW_CAP } from '@/lib/today/slateRow';


export default function WeekSlate({ slate, boardIds, boardNumber, scoresHref, label }) {
  if (!slate?.games?.length) return null;
  const ordered = orderSlate(slate.games);
  const shown = ordered.slice(0, SLATE_ROW_CAP);
  const hidden = ordered.length - shown.length;
  // The heading states the week the DATA says, never a calendar week.
  const weekLabel = slate.week != null
    ? `${slate.phase === 'PRE' ? 'Preseason wk' : 'Week'} ${slate.week}`
    : null;
  return (
    <div className="mod">
      <div className="eb">
        <span>This week</span>
        <span className="ctx">
          {weekLabel}{boardIds?.size ? ` · Board ${boardNumber} marked` : ''}
        </span>
      </div>
      {shown.map((g) => (
        <SlateRow key={g.id} g={g} onBoard={boardIds?.has(g.id)} boardNumber={boardNumber} />
      ))}
      <a className="ghostcta" href={scoresHref}>
        {hidden > 0 ? `Full scoreboard · ${hidden} more` : 'Full scoreboard'} &rarr;
      </a>
    </div>
  );
}

// lib/gridiron/cfbClock.js - THE CLOCK OF A CFB PLAY, as far as the feed knows it (drive-4). PURE.
//
// WHAT THE FEED SENDS (CFBD /live/plays, read off Oregon-Ohio State, 7 Nov): every play
// of a drive carries the SAME `clock` - the drive's - except the drive's last play (and
// a period's last row), which carries the clock the drive ended on. The sentence does
// not repeat it (no "(08:21)" prefix: that prefix is the historical /plays shape);
// it names a clock only on a score ("TOUCHDOWN, clock 09:56"). `wallClock` is the one
// per-play time, and plays.* does not keep it. So plays.clock is wrong for every
// mid-drive play ("Q1 15:00" for a snap in the middle of a drive, "Q2 15:00" for a
// 4th & 2 at the 15), and the stored rows are what the feed gave: NOT an ingest bug,
// and no backfill can repair them (the per-play clock is not in the data we kept).
//
// THE LIVE CARD IS NOT AFFECTED: its period and clock come from matches.metadata.live_state,
// written by the poller from the game's own live clock (CFBD /scoreboard), never from a
// play row.
//
// MOST GAMES CARRY THE PLAY'S OWN CLOCK IN THE SENTENCE: plays.text starts "(08:21) Shotgun #23 ..."
// (PROD, CFB since 6 Nov: 56 of 58 games, 8,512 of 10,299 plays; ORE@OSU is one of the two without).
// A leading "(MM:SS)" / "(M:SS)" / "(:SS)" is that play's EXACT clock and an anchor; only plays with no
// stated clock between two anchors are estimated. (cfbPlayText strips the prefix from displayed text.)
//
// A SCORING PLAY STATES ITS OWN CLOCK ("... TOUCHDOWN, clock 03:25 ..." / "field goal attempt from
// 33 yards GOOD (...), clock 11:26"), and that one is exact: it is taken as the play's clock and
// used as an anchor, so the plays before it spread between the start and IT, not between the
// start and a timeout row that closes the drive.
//
// THE REPLAY'S ESTIMATE: within one drive's run of plays in one period, the first play's
// clock is where the drive (or the period) began and the last play's is where it ended;
// the plays between are spread evenly by position. Marked `clockEst: true` so the page
// can say so. NOT applied where an anchor does not fall below the one before it, or two
// anchors have no play between them.

const sec = (c) => { const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(c ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// "clock 03:25" in a scoring sentence.
const STATED = /^\s*\((\d{0,2}):(\d{2})\)|\bclock (\d{1,2}):(\d{2})\b/;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

/**
 * @param plays  CFB plays in drive order (driveId, driveNumber, playNumber, period, clock)
 * @returns a NEW array, same order, with `clock` replaced on mid-run plays (clockEst true)
 *          and the stored value kept in `clockStored`. Idempotent.
 */
export function estimateCfbClocks(plays) {
  const list = (plays ?? []).map((p) => ({ ...p }));
  const runs = new Map();
  list.forEach((p, i) => {
    if (p.driveId == null) return;
    const k = `${p.driveId}|${p.period ?? ''}`;
    (runs.get(k) ?? runs.set(k, []).get(k)).push(i);
  });
  for (const idx of runs.values()) {
    idx.sort((a, b) => (Number(list[a].playNumber) || 0) - (Number(list[b].playNumber) || 0) || a - b);
    // Anchors: the run's first and last play, and any play that states its own clock.
    const anchors = [];
    idx.forEach((i, n) => {
      const stated = STATED.exec(String(list[i].text ?? ''));
      if (stated) {
        list[i].clockStored = list[i].clockStored ?? list[i].clock;
        list[i].clock = fmt(Number(stated[1] ?? stated[3] ?? 0) * 60 + Number(stated[2] ?? stated[4]));
      }
      if (n === 0 || n === idx.length - 1 || stated) anchors.push(n);
    });
    for (let k = 0; k + 1 < anchors.length; k++) {
      const n1 = anchors[k], n2 = anchors[k + 1];
      if (n2 - n1 < 2) continue;
      const a = sec(list[idx[n1]].clock), b = sec(list[idx[n2]].clock);
      if (a == null || b == null || b >= a) continue;
      for (let n = n1 + 1; n < n2; n++) {
        const i = idx[n];
        list[i].clockStored = list[i].clockStored ?? list[i].clock;
        list[i].clock = fmt(a - ((a - b) * (n - n1)) / (n2 - n1));
        list[i].clockEst = true;
      }
    }
  }
  return list;
}

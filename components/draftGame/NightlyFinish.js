'use client';

// THE FINISH SCREEN (wed-1b): you have all your picks, the room has not locked.
// A navy header "YOUR THREE ARE IN" with two tiles (the lock time and a ticking
// countdown; your total of averages against the room's best), your picks in
// lineup order, the room, then the next doors and the share. Points are "-"
// until the first tip: after it the page switches to the live result.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TeamMark from '@/components/team/TeamMark';
import ShareDraftGame from '@/components/draftGame/ShareDraftGame';
import { chipClass } from '@/components/draftGame/NightlyPoolRow';
import { slotRows } from '@/components/draftGame/slotRows';
import {
  finishTitle, ptClock, countdownText, avgTotal, roomBest, surnames, shareThree, rowLine,
} from '@/lib/draftGame/nightlyCopy';
import './nightly.css';

const one = (n) => Number(n).toFixed(1);

export default function NightlyFinish({ view, eyebrow, pickemHref, dailyHref, tomorrow = null }) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(null);
  const lockMs = new Date(view.kickoffAt).getTime();
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  // The lock has passed: re-read, and the page shows the live result.
  useEffect(() => {
    if (nowMs != null && nowMs >= lockMs) { const t = setTimeout(() => router.refresh(), 800); return () => clearTimeout(t); }
    return undefined;
  }, [nowMs, lockMs, router]);

  const me = view.seats.find((s) => s.you);
  const mine = me?.picks ?? [];
  const rows = slotRows(view.shape.slots ?? [], mine);

  return (
    <section className="nd-fin" data-nightly-finish>
      <div className="dgm-hd nd-fin-hd">
        <div className="dgm-eyebrow">{eyebrow}</div>
        <h1 className="nd-fin-title" data-room-header>{finishTitle(view.shape.rounds)}</h1>
        <div className="nd-tiles">
          <div className="nd-tile">
            <span className="nd-tile-k">Locks</span>
            <b className="nd-tile-v">{ptClock(view.kickoffAt)}</b>
            <span className="nd-tile-s" data-nightly-countdown>{nowMs == null ? ' ' : countdownText(lockMs - nowMs)}</span>
          </div>
          <div className="nd-tile">
            <span className="nd-tile-k">Avg total</span>
            <b className="nd-tile-v n">{one(avgTotal(mine))}</b>
            <span className="nd-tile-s">room best: {one(roomBest(view.seats))}</span>
          </div>
        </div>
      </div>

      <h2 className="nd-h2">Your team</h2>
      <ul className="nd-picks" aria-label="Your picks">
        {rows.map(({ slot, p }, i) => (p ? (
          <li key={`${slot}-${i}`} className="nd-row nd-row--pick">
            <span className="nd-jersey">
              <TeamMark leagueSlug="nba" abbr={p.team} size={28} />
              <span className={chipClass(slot)}>{slot}</span>
            </span>
            <span className="nd-who"><b>{p.name}</b><small>{rowLine(p)}</small></span>
            <span className="nd-pts n" data-nightly-pts>-</span>
          </li>
        ) : null))}
      </ul>

      <h2 className="nd-h2">The room</h2>
      <ol className="nd-room">
        {view.seats.map((s) => (
          <li key={s.seat} className={`nd-seat${s.you ? ' nd-seat--you' : ''}`}>
            <b>{s.label}</b>
            <span className="nd-seat-picks">{surnames(s.picks)}</span>
            <span className="nd-pts n">-</span>
          </li>
        ))}
      </ol>
      <p className="nd-note">Ranks update every 10 minutes once games tip. Settles after the last final.</p>

      <div className="nd-cta">
        <Link className="nd-btn nd-btn--main" href={pickemHref}>Make your NBA Pick&apos;em</Link>
        <div className="nd-cta-row">
          <Link className="nd-btn" href={dailyHref}>Play today&apos;s Daily</Link>
          <ShareDraftGame text={shareThree(mine)} label="Share my three" className="nd-btn" />
        </div>
        {tomorrow && <p className="nd-tomorrow" data-nightly-tomorrow>{tomorrow}</p>}
      </div>
    </section>
  );
}

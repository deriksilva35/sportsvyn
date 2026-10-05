// components/games/DailyBanner.js - THE DAILY, on the Play lobby (mon-2).
//
// ALONE, RIGHT UNDER PLAY AND THE DATE, and the only surface that wears the
// Daily blue (--tok-daily, app/globals.css; app/dailyBlue.test.mjs holds that).
// lib/games/dailyBanner.js decided every word; this file draws one of two
// states:
//   before  THE DAILY · OCT 4, the streak, the pitch, PLAY (volt) - signed out
//           PLAY goes to sign-in and back to the board - and "N played today"
//           once N >= 25
//   after   the score, BEAT N%, #rank of N, SHARE + SEE BOARD, the streak and
//           the countdown to the next board
//
// THE STREAK WEARS THE FIRE, as the Daily's own streak lines already do
// (components/daily/season/OpenReveal.js, SeasonBoard.js) - one Daily, one
// streak mark.

import Link from 'next/link';
import ShareGrade from '@/components/games/ShareGrade';
import DailyCountdown from '@/components/games/DailyCountdown';
import { bannerShareCaption } from '@/lib/games/dailyBanner';
import { DAILY_V2_PATH } from '@/lib/daily/boardShape';
import '@/components/games/dailyBanner.css';

const SHARE_URL = `sportsvyn.com${DAILY_V2_PATH}`;
const num = (n) => Number(n).toLocaleString('en-US');

function Head({ b }) {
  return (
    <div className="pd-h">
      <span className="pd-eb">THE DAILY{b.date ? ` · ${b.date}` : ''}</span>
      {b.streak != null && <span className="pd-streak">🔥 STREAK {b.streak}</span>}
    </div>
  );
}

export default function DailyBanner({ b, signedIn = false, signinHref = (h) => h, now = null, tz = null }) {
  if (!b) return null;
  if (b.state === 'after') {
    const beat = b.beatPct != null ? `BEAT ${b.beatPct}%` : 'FIRST TO FINISH';
    const sub = [b.pctOfPerfect ? `${b.pctOfPerfect} of perfect` : null, b.rank != null ? `#${num(b.rank)} of ${num(b.of)}` : null]
      .filter(Boolean).join(' · ');
    return (
      <section className="pd" aria-label="The Daily" data-state="after">
        <Head b={b} />
        <div className="pd-score">
          <b className="pd-pts">{b.score.toFixed(1)}</b>
          <span className="pd-beat">
            <span className="pd-beat-n">{beat}</span>
            {sub && <span className="pd-sub">{sub}</span>}
          </span>
        </div>
        <div className="pd-acts">
          <ShareGrade buttonClass="pd-btn pd-share" caption={bannerShareCaption(b)} url={SHARE_URL} />
          <Link className="pd-btn pd-ghost" href={b.href}>See board</Link>
        </div>
        {b.nextAt && <DailyCountdown iso={b.nextAt} now={now} serverTz={tz} />}
      </section>
    );
  }
  return (
    <section className="pd" aria-label="The Daily" data-state="before">
      <Head b={b} />
      <b className="pd-pitch">Build the best lineup from one season</b>
      <p className="pd-line">Three minutes. The same board for everyone. A new one every midnight.</p>
      <div className="pd-row">
        <Link className="pd-btn pd-play" href={signedIn ? b.href : signinHref(b.href)}>Play</Link>
        {b.playedToday != null && <span className="pd-played">{num(b.playedToday)} played today</span>}
      </div>
    </section>
  );
}

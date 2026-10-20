// components/coins/CoinStrip.js - THE PLAY STRIP (coins-2 B4; mock screen 1).
//
// A navy card on the Games tab: coins this week, dropped / in hand, the drawing
// Tuesday with its countdown; under it the meter bar, "N points to next coin".
// Taps through to The Drum. Server-rendered from lib/coins/drum.js drumView;
// /games renders it only with COINS=on and a signed-in reader.

import Link from 'next/link';
import { countdown, stripLine } from '@/lib/coins/copy';

export default function CoinStrip({ view, now = new Date() }) {
  if (!view?.week || !view.me) return null;
  const { me } = view;
  return (
    <div className="cn-strip-wrap" data-coins-strip="">
      <Link href="/coins" className="cn-strip" aria-label={`${me.minted} coins this week. Open The Drum`}>
        <span className="cn-strip-coin cn-mono" aria-hidden="true">SV</span>
        <span className="cn-strip-mid">
          <b className="cn-mono">{me.minted} COIN{me.minted === 1 ? '' : 'S'} THIS WEEK</b>
          <small>{stripLine(me)}</small>
        </span>
        <span className="cn-strip-end">
          <b className="cn-mono">DRAWING TUE</b>
          <small>9:00 am PT · {countdown(view.week.closesAt, now)}</small>
        </span>
      </Link>
      <div className="cn-meter">
        <div className="cn-meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={me.meter.into} aria-label="Points toward your next coin">
          <span style={{ width: `${me.meter.into}%` }} />
        </div>
        <small>{me.meter.toNext} points to next coin</small>
      </div>
    </div>
  );
}

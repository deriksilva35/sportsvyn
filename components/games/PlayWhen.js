'use client';
// components/games/PlayWhen.js - one instant on the Play lobby, in the page's zone.
//
// THE StandaloneTime PATTERN, for the lobby's three shapes: the first render
// (server and client alike, so hydration matches) is in the zone the server
// knows - the sv_tz cookie, or Eastern on a cold visit - and after mount it
// settles on the device's zone, the same moment the header's ZoneLabel does, so
// the zone named at the top and every time below it always agree.
//
//   kind 'time'   "5:15 PM" today, "Sun 10:00 AM" otherwise (lib/games/playTime.js)
//   kind 'date'   "20 Oct"
//   kind 'day'    "Tue 20 Oct"

import { playDateLabel, playTimeLabel } from '@/lib/games/playTime';
import { useViewerZone } from '@/components/time/ViewerTz';

function label(kind, iso, now, tz, tbd) {
  if (kind === 'time') return playTimeLabel(iso, { now, tz, tbd });
  return playDateLabel(iso, { tz, weekday: kind === 'day' });
}

export default function PlayWhen({ iso, kind = 'time', now = null, serverTz = null, tbd = false }) {
  const tz = useViewerZone(serverTz);
  return <>{label(kind, iso, now, tz, tbd)}</>;
}

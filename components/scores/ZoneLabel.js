'use client';
// components/scores/ZoneLabel.js - the "all times <zone>" name in /scores' header.
//
// THE HEADER AND THE CARDS SAY THE SAME ZONE (28 Sep). The server renders the
// zone it knows (the sv_tz cookie, or Eastern on a first visit); after mount this
// settles on the viewer's own zone - the same moment the cards' StandaloneTime
// does - so a first visit without the cookie never ends with "all times Eastern"
// over "10:00 AM PDT". Same function on both sides: lib/time/zoneName.js.

import { useEffect, useState } from 'react';
import { zoneNameOf } from '@/lib/time/zoneName';

export default function ZoneLabel({ initial }) {
  const [name, setName] = useState(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's zone exists only after mount; StandaloneTime does the same
  useEffect(() => { setName(zoneNameOf()); }, []);
  return <>{name}</>;
}

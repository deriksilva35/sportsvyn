'use client';

/**
 * StandaloneTime - the TIME half of StandaloneDate: "1:00 PM PDT", in the
 * VISITOR's zone, zone abbreviation appended. Same hydration-safe pattern
 * as StandaloneDate, StandaloneDateOnly, KickoffTime and LocalTime - SSR
 * and the first client render format identically (ET), then a useEffect
 * swaps to the visitor's own zone after mount.
 *
 * WHY IT HAD TO EXIST (relay 3b item 2). Pick'em's kickoff cell renders
 * inside a row that is already carrying two team names and a spread, so
 * StandaloneDate's full "Sun Sep 7 · 1:00 PM PDT" does not fit; the day is
 * already stated by the group header the row sits under, so repeating it
 * per row was never wanted either. Before this, that cell was the last
 * formatter on the four game surfaces still printing a hardcoded " ET" - a
 * board whose header said "lock Sun Sep 7 · 10:00 AM PDT" and whose rows
 * said "1:00 PM ET", three hours apart, both correct, on one screen.
 *
 * SSR FALLBACK IS ET for the same reason StandaloneDate's is: an
 * unhydrated UTC hour reads as a schedule error to an audience that is
 * entirely in US zones.
 *
 * TWO OPTIONAL PROPS, ADDED FOR THE WEEKLY (weekly-hdr relay), and both
 * default to today's exact output so no existing caller moves:
 *
 *   weekday   prepend "Thu " / "Sun " / "Mon ", in the SAME zone as the
 *             time. A Weekly slate runs Thursday to Monday and every row
 *             read "5:15 PM" - two identical strings four days apart, on
 *             one screen, with nothing to tell them apart. The day has to
 *             come from the same Intl format call as the hour or the pair
 *             can disagree across a midnight boundary in the viewer's zone.
 *   zone      false drops the " PDT". THE SUFFIX BELONGS ONCE PER SCREEN,
 *             not once per row: eight rows repeating the reader's own zone
 *             is noise, and dropping it everywhere would leave a board with
 *             no statement of which clock it is on at all. The Weekly puts
 *             it on the one deadline - "next lock" - and nowhere else.
 *
 * A SIBLING COMPONENT WAS THE ALTERNATIVE AND IS WORSE. The hydration-safe
 * dance below (ET on the server, the viewer's zone after mount) is the thing
 * that must not be copied; a second file would be a second chance to get the
 * fallback wrong, and this file's own header is already an argument against
 * two formatters for one question.
 */

import { useEffect, useState } from 'react';
import { standaloneTimeLabel } from '@/lib/time/standaloneLabel';

export default function StandaloneTime({ iso, weekday = false, zone = true }) {
  const [label, setLabel] = useState(() => standaloneTimeLabel(iso, { weekday, zone, tz: null }));
  useEffect(() => { setLabel(standaloneTimeLabel(iso, { weekday, zone, tz: undefined })); }, [iso, weekday, zone]);
  return <>{label}</>;
}

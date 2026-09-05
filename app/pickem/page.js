/**
 * /pickem - the bare route, now that Pick'em splits by sport (relay 2c
 * item 6). It never renders a board itself; it redirects 307 to whichever
 * sport's own next lock is soonest (soonestPickemSport()'s own rule), so an
 * old link or a hand-typed URL still lands somewhere real instead of a
 * generic sport-agnostic page nobody chose.
 *
 * 307, NOT 308: this is a redirect that depends on the CLOCK (which sport is
 * more urgent right now), not a permanent relocation of the resource - a
 * 308 caches the decision past the moment it stops being true.
 */

import { redirect } from 'next/navigation';
import { soonestPickemSport } from '@/lib/pickem/entry';

export const dynamic = 'force-dynamic';

export default async function PickemPage() {
  const sport = await soonestPickemSport().catch(() => 'cfb');
  redirect(`/pickem/${sport}`);
}

// components/games/VoidAllLabel.js - the line every settled view of an
// all-void board prints (ruling sun-11 item 1), in place of a score, a rank,
// a tier or a DNF. A server component; no CSS of its own - each surface
// passes the muted class it already uses, so nothing here needs dark parity.
//
// data-void-all IS THE HOOK the mount tests and the guard read: the copy is
// VOID_ALL_LABEL from lib/settle/voidRule.js and nowhere else.

import { VOID_ALL_LABEL } from '@/lib/settle/voidRule';

export default function VoidAllLabel({ className = 'muted', style, as: Tag = 'p' }) {
  return <Tag className={className} style={style} data-void-all="">{VOID_ALL_LABEL}</Tag>;
}

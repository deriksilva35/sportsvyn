/**
 * /weekly/board - The Weekly's always-on public board: every entry, ranked, live during
 * games, the reader pinned. The body is shared with the other game's board
 * (components/boards/BoardPage.js); the read is lib/boards/live.js.
 */

import BoardPage from '@/components/boards/BoardPage';
import '../../boards/board.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Weekly · Board - Sportsvyn' };

export default function Page({ searchParams }) {
  return <BoardPage game="weekly" searchParams={searchParams} />;
}

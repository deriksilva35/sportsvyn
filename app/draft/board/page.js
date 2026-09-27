/**
 * /draft/board - The Draft's always-on public board: every entry, ranked, live during
 * games, the reader pinned. The body is shared with the other game's board
 * (components/boards/BoardPage.js); the read is lib/boards/live.js.
 */

import BoardPage from '@/components/boards/BoardPage';
import '../../boards/board.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Draft · Board - Sportsvyn' };

export default function Page({ searchParams }) {
  return <BoardPage game="draft" searchParams={searchParams} />;
}

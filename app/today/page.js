// app/today/page.js - the editorial front page, at its own address (tue-3).
//
// Under the arcade theme / is the Games lobby, and the front page (the Daily
// Card, "the network's front page", MY SPORTSVYN) moved here - reachable by
// URL, linked from no nav. On the dark page / still renders the same component,
// so this is the same page at a second address rather than a copy.
import { FrontPage } from '../page';

export const metadata = { title: 'Today - Sportsvyn' };

export default function TodayPage() {
  return <FrontPage />;
}

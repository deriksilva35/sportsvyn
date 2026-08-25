import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { isAdminUser } from '@/lib/admin/gate';
import {
  overviewStats, recentActivity, gamesActivity, findUsers, userDetail, handleFor, GAME_FILTERS,
} from '@/lib/admin/reads';
import './console.css';

/**
 * THE ADMIN CONSOLE - phase 1: Overview, Games Activity, User Lookup.
 * Drawn from docs/design/sportsvyn-admin-panel-mock-v0_1.html.
 *
 * ACCESS: 404, NOT 403. `notFound()` renders the ordinary not-found page with
 * a 404 status, so a signed-in non-admin cannot tell this route from a typo.
 * A 403 or an "access denied" screen would confirm the route exists and is
 * worth attacking; the whole point of the gate is that there is nothing to
 * learn here. Signed-out gets the same 404 - no redirect to sign-in either,
 * since "sign in to see this" is itself an admission the page is real.
 *
 * See lib/admin/gate.js for why this sits BEHIND proxy.js Basic Auth rather
 * than instead of it.
 *
 * READ-ONLY. Every query lives in lib/admin/reads.js and every one of them is
 * a SELECT. Loading this page writes nothing - no page-view row, no audit
 * entry, no last-seen bump. Phase 2 (page views) is the build that would
 * introduce a write path, and it is deliberately not here.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Console - Admin',
  robots: { index: false, follow: false },
};

// Server-rendered in ET, the spine the rest of the app runs on, so the string
// is identical for every browser and never hydrates to something else.
const ET = 'America/New_York';
const fmtTime = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, hour: 'numeric', minute: '2-digit',
});
const fmtStamp = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const fmtDay = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
});

const isToday = (d) => fmtDay.format(d) === fmtDay.format(new Date());
const stamp = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isToday(d) ? fmtTime.format(d) : fmtStamp.format(d);
};

function Chip({ game }) {
  const label = game === 'pickem' ? "PICK'EM" : String(game || '').toUpperCase();
  return <span className={`chip ${game}`}>{label}</span>;
}

// Every table on this page renders a user cell that links into the lookup
// panel below - one definition, so the anchor and the handle format cannot
// drift between the feed and the activity table.
function UserCell({ handle }) {
  return (
    <td>
      <Link className="handle" href={`/admin/console?q=${encodeURIComponent(handle ?? '')}#lookup`}>
        @{handle ?? 'unknown'}
      </Link>
    </td>
  );
}

const NAV_LIVE = [['Overview', ''], ['Games Activity', '#games'], ['User Lookup', '#lookup'],
  ['Page Views', '#views']];
const NAV_OFF = ['Leagues', 'Push & Email'];

export default async function AdminConsolePage({ searchParams }) {
  const session = await auth();
  if (!isAdminUser(session?.user?.id)) notFound();

  const sp = (await searchParams) ?? {};
  const rawGame = Array.isArray(sp.game) ? sp.game[0] : sp.game;
  const game = GAME_FILTERS.includes(rawGame) ? rawGame : 'all';
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '';

  const [stats, feed, activity, matches, me] = await Promise.all([
    overviewStats(),
    recentActivity({ limit: 12 }),
    gamesActivity({ game, limit: 50 }),
    findUsers(q),
    handleFor(session.user.id),
  ]);
  // One hit -> show them. Several -> show the list and let the admin pick,
  // rather than guessing which "derik" was meant.
  const detail = matches.length === 1 ? await userDetail(matches[0].id) : null;

  return (
    <div className="adm">
      <div className="adm-shell">
        <nav className="adm-rail">
          <div className="brand">SPORTSV<span className="y">Y</span>N<span className="tag">ADMIN</span></div>
          {NAV_LIVE.map(([label, hash], i) => (
            <a key={label} href={`/admin/console${hash}`} className={i === 0 ? 'on' : undefined}>
              <span className="ic">◆</span>{label}
            </a>
          ))}
          {/* Not built. Rendered dead rather than omitted so the rail states
              the roadmap, and dead rather than linked so it cannot 404. */}
          {NAV_OFF.map((label) => (
            <span key={label} className="navoff" aria-disabled="true">
              <span className="ic">◆</span>{label}
            </span>
          ))}
        </nav>

        <main className="adm-main">
          <div className="adm-pagehead">
            <div>
              <h1>Overview</h1>
              <div className="adm-sub">
                {fmtDay.format(new Date())} · signed in as{' '}
                {me ? `@${me}` : `user ${session.user.id}`}
              </div>
            </div>
            <div className="adm-sub">Live read · {fmtTime.format(new Date())} ET</div>
          </div>

          <div className="adm-statgrid">
            <div className="adm-stat">
              <div className="lbl">Total users</div>
              <div className="v">{stats.users}</div>
              <div className={`d${stats.usersToday ? '' : ' flat'}`}>
                {stats.usersToday ? `+${stats.usersToday} today` : 'none today'}
              </div>
            </div>
            <div className="adm-stat">
              <div className="lbl">Active today</div>
              <div className="v">{stats.activeToday}</div>
              <div className="d flat">played something</div>
            </div>
            <div className="adm-stat">
              <div className="lbl">Daily entrants</div>
              <div className="v">{stats.dailyEntrants}</div>
              <div className="d flat">of {stats.totalUsers}</div>
            </div>
            <div className="adm-stat">
              <div className="lbl">Mocks started</div>
              <div className="v">{stats.mocksStarted}</div>
              <div className={`d${stats.mockCompletionPct === null ? ' flat' : ''}`}>
                {stats.mockCompletionPct === null ? '7d · none' : `${stats.mockCompletionPct}% complete · 7d`}
              </div>
            </div>
            <div className="adm-stat">
              <div className="lbl">Leagues</div>
              <div className="v">{stats.leagues}</div>
              <div className="d flat">{stats.leagueMembers} members</div>
            </div>
          </div>

          <section className="adm-panel">
            <div className="ph"><h2>Recent activity, all games</h2><span className="ct">newest first</span></div>
            {feed.length === 0 ? (
              <div className="adm-empty">No activity recorded yet.</div>
            ) : (
              <div className="adm-scroll">
                <table>
                  <thead>
                    <tr><th>Time</th><th>User</th><th>Game</th><th>Action</th><th className="num">Result</th></tr>
                  </thead>
                  <tbody>
                    {feed.map((r, i) => (
                      <tr key={`${r.game}-${r.ref}-${i}`}>
                        <td className="muted">{stamp(r.at) ?? '—'}</td>
                        <UserCell handle={r.handle} />
                        <td><Chip game={r.game} /></td>
                        <td>{r.action}</td>
                        <td className={`num${r.result ? '' : ' muted'}`}>{r.result ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adm-panel" id="games">
            <div className="ph"><h2>Games activity</h2><span className="ct">{activity.length} shown</span></div>
            <div className="adm-gtabs">
              {GAME_FILTERS.map((g) => (
                <Link
                  key={g}
                  href={`/admin/console?game=${g}${q ? `&q=${encodeURIComponent(q)}` : ''}#games`}
                  className={g === game ? 'on' : undefined}
                >
                  {g === 'pickem' ? "Pick'em" : g[0].toUpperCase() + g.slice(1)}
                </Link>
              ))}
            </div>
            {activity.length === 0 ? (
              // HONEST EMPTY STATE, not a hidden panel: pick'em has no entries
              // until board 1 opens, and the table should say so rather than
              // vanish and imply the filter is broken.
              <div className="adm-empty">No {game === 'all' ? '' : `${game} `}activity yet.</div>
            ) : (
              <div className="adm-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>User</th><th>Game</th><th>Started</th><th>Status</th>
                      <th className="num">Score / Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((r, i) => (
                      <tr key={`${r.game}-${r.user_id}-${i}`}>
                        <UserCell handle={r.handle} />
                        <td><Chip game={r.game} /></td>
                        <td className="muted">{stamp(r.started) ?? '—'}</td>
                        <td>{r.status}</td>
                        <td className={`num${r.result ? '' : ' muted'}`}>{r.result ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="adm-footnote">
              Reads the existing entry / draft / contest tables directly — no new tracking.
              Newest 50 per filter; older rows are not paged yet.
            </div>
          </section>

          <section className="adm-panel" id="lookup">
            <div className="ph"><h2>User lookup</h2></div>
            {/* Plain GET form — the query lives in the URL, so a lookup is
                shareable and back-button-able, and the panel needs no client JS. */}
            <form className="adm-searchbar" method="get" action="/admin/console">
              <input name="q" defaultValue={q} placeholder="Search by handle or email..." aria-label="Search users" />
              <input type="hidden" name="game" value={game} />
              <button type="submit">Search</button>
            </form>

            {q && matches.length === 0 && (
              <div className="adm-empty">No user matches “{q}”.</div>
            )}

            {matches.length > 1 && (
              <div className="adm-scroll">
                <table>
                  <thead><tr><th>Handle</th><th>Email</th><th>Joined</th></tr></thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id}>
                        <UserCell handle={m.handle} />
                        <td className="muted">{m.email ?? '—'}</td>
                        <td className="muted">{stamp(m.created_at) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detail && (
              <>
                <div className="adm-userhead">
                  <div className="adm-avatar">{(detail.user.handle ?? '?')[0].toUpperCase()}</div>
                  <div>
                    <div className="adm-uh-name">@{detail.user.handle}</div>
                    <div className="adm-uh-meta">
                      joined {stamp(detail.user.created_at)}
                      {detail.user.first_seen_context ? ` · ${detail.user.first_seen_context}` : ''}
                      {' · '}
                      {detail.lastActive ? `last active ${stamp(detail.lastActive)}` : 'never played'}
                    </div>
                  </div>
                </div>
                <div className="adm-scroll">
                  <table>
                    <thead><tr><th>Game</th><th>Activity</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      <tr>
                        <td><Chip game="daily" /></td>
                        <td>{detail.daily.entries} entries, {detail.daily.revealed} revealed</td>
                        <td className={`num${detail.daily.best ? '' : ' muted'}`}>
                          {detail.daily.best ? `${Number(detail.daily.best).toFixed(1)} best` : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td><Chip game="mock" /></td>
                        <td>{detail.drafts.mocks} drafts, {detail.drafts.mocks_done} completed</td>
                        <td className="num muted">—</td>
                      </tr>
                      <tr>
                        <td><Chip game="tracker" /></td>
                        <td>{detail.drafts.trackers} rooms</td>
                        <td className="num muted">—</td>
                      </tr>
                      <tr>
                        <td><Chip game="pickem" /></td>
                        <td>{detail.pickem.entries} entries</td>
                        <td className="num muted">—</td>
                      </tr>
                      <tr>
                        <td>Leagues</td>
                        <td>
                          {detail.leagues.length === 0
                            ? 'none'
                            : detail.leagues
                                .map((l) => `${l.name} (joined ${stamp(l.joined_at)})`)
                                .join(', ')}
                        </td>
                        <td className="num muted">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="adm-footnote">
              One user, every game, one view — the cross-game read the ad-hoc usage checks
              have been doing by hand all week.
            </div>
          </section>

          <section className="adm-panel" id="views">
            <div className="ph"><h2>Page views, by user</h2><span className="ct">phase 2</span></div>
            <div className="adm-comingsoon">
              <div className="t">Not built yet</div>
              <div className="d">
                Requires a new identified-pageview log (write path + retention policy) — a
                separate build from this panel. Vercel Analytics remains the anonymous
                aggregate source until this ships.
              </div>
              <span className="badge">Retention policy: undecided</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

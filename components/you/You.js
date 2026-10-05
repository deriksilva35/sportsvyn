// components/you/You.js - the You tab, per docs/design/mocks/you-tab-v0_1.html.
//
// YOU IS THE RECORD, TODAY IS THE DAY (R1). Nothing on this tab reads a live
// game. The only number that moves mid-slate is a rank, and it moves because
// a board settled.
//
// ALERTS ARE READ AND LINK ONLY (R3), WITH EXACTLY ONE EXCEPTION. Every row
// states what is true and points at the surface that changes it, and the
// AlertBell sheet is still untouched.
//
// THE EXCEPTION IS THE RED-ZONE SWITCH, and it is not a crack in the rule so
// much as the case the rule did not cover. R3 works because every alert has a
// surface that owns it: a game's bell owns a game, a team page owns a team.
// A LEAGUE-WIDE STANDING INSTRUCTION OWNS NOTHING SMALLER THAN ITSELF - there
// is no screen it could point at - so a read-only row would point at nothing
// and the preference would be unreachable. It writes. Nothing else here does,
// and the next row that wants to should have to argue with this paragraph.
//
// /account AND /my ARE NOW REDIRECTS HERE (sun-16 D), and what only they had
// moved in rather than being lost: unfollow and the team search, the push
// switch (shell), sign out, account deletion (App Store 5.1.1(v)) and a door
// to the draft settings; the plan and billing lines and the membership link
// for members and free accounts alike; your drafts; the players you follow.
// FOUR WRITERS CAME WITH THEM, and they are the argument the R3 paragraph
// above asked for: /account was the place a reader undid a follow, turned
// push off, signed out and deleted the account, and with it gone there is no
// other surface those controls can point at. Each is the SAME component
// /account mounted (FollowedTeams, NotificationsRow, SignOutButton, DeleteAccount),
// never a second copy - one sign-out path, the one that also logs out of
// RevenueCat. You.js itself still has no handler of its own.
//
// THREE ROWS THE MOCK DRAWS ARE NOT HERE, each for a stated reason:
//   BOARD REMINDERS - there is no preference in the schema to read. No
//     column and no alert_prefs scope for it. (The scope CHECK now allows
//     'league' as well as 'team' and 'match' - migration 107 - but a league
//     is not a board, so the gap this names is unchanged.) A row reading
//     "not set up yet" is a promise with nothing behind it (Q2).
//   THE PRICE - nothing in the app stores one per user; memberships.price_id
//     is a Stripe id, never an amount (Q4).
//   MEMBER SINCE - users.created_at is null for the accounts that predate
//     migration 058, user 1 among them. The line renders only when the date
//     is real.

import Link from 'next/link';
import RedZoneRow from '@/components/you/RedZoneRow';
import NotificationsRow from '@/components/push/NotificationsRow';
import FollowedTeams from '@/components/account/FollowedTeams';
import SignOutButton from '@/components/sim/SignOutButton';
import DeleteAccount from '@/components/sim/DeleteAccount';
import { draftDate, draftAction } from '@/lib/fantasy/yourDrafts';
import './you.css';

function SectionHead({ title, href, label }) {
  return (
    <div className="yu-sh">
      <h3>{title}</h3>
      {href ? <Link href={href}>{label}</Link> : null}
    </div>
  );
}

function Identity({ me }) {
  if (!me) return null;
  // The zone is per DEVICE, not per account - there is no timezone column,
  // and the caption says so (R6).
  const sub = [me.since ? `Member since ${me.since}` : null, me.zone].filter(Boolean).join(' · ');
  return (
    <div className="yu-me" data-section="identity">
      <span className="yu-av">{me.initial}</span>
      <div className="yu-who">
        <h1>{me.display}</h1>
        {sub ? <div className="yu-sub">{sub}</div> : null}
      </div>
      <a className="yu-edit" href="#settings">Settings</a>
    </div>
  );
}

function Streak({ daily }) {
  if (!daily) return null;
  return (
    <div className="yu-streak" data-section="streak">
      <div className={`yu-box${daily.streak > 0 ? ' hot' : ''}`}><b className="yu-n">{daily.streak}</b><span>Day streak</span></div>
      <div className="yu-box"><b className="yu-n">{daily.bestStreak}</b><span>Best</span></div>
      <div className="yu-box"><b className="yu-n">{daily.boards}</b><span>Boards</span></div>
    </div>
  );
}

function Dots({ daily }) {
  if (!daily?.dots?.length) return null;
  return (
    <>
      <SectionHead title="The Daily" href="/daily/board" label="History →" />
      <div className="yu-card" data-section="dots">
        <div className="yu-dots">
          {daily.dots.map((d) => (
            <span key={d.day} className={`yu-dot${d.state === 'played' ? ' on' : d.state === 'dnf' ? ' dnf' : ''}`}
              data-state={d.state} title={d.day}>{d.letter}</span>
          ))}
        </div>
        <div className="yu-dotfoot">
          <span>Last {daily.days} days{daily.dnf ? ` · ${daily.dnf} DNF` : ''}</span>
          {daily.best != null ? <span>Best <b className="yu-n">{daily.best.toLocaleString('en-US')}</b></span> : null}
        </div>
      </div>
    </>
  );
}

// R5: unranked STATES the distance, never hides. R7: the row renders whether
// or not the reader is inside the leaderboard's visible top.
function Season({ season }) {
  if (!season?.length) return null;
  return (
    <>
      <SectionHead title="Your season" href="/rankings?view=people" label="Rankings →" />
      <div className="yu-card" data-section="season">
        {season.map((g) => (
          <Link className="yu-gr" key={g.key} href={g.href} data-game={g.key}>
            <span className="yu-ic">{g.glyph}</span>
            <span className="yu-nm">{g.title}{g.sub ? <small>{g.sub}</small> : null}</span>
            <span className="yu-rt">
              <b className="yu-n">{g.rank != null ? `#${g.rank}` : (g.value ?? '–')}</b>
              <span>{g.rank != null && g.of ? `of ${g.of.toLocaleString('en-US')}` : (g.note ?? '')}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

// TEAMS YOU FOLLOW IS /account's CONTROL (sun-16 D): the list, Remove on each
// row, and the searchable Follow a team - the one place a follow could be
// undone (a team page's star only makes one), so it moved here with the rest
// of /account. The cap still sits on the add control (R4), counted live.
function Follows({ follows, allTeams = [] }) {
  return (
    <>
      <SectionHead title="Teams you follow" />
      <div className="yu-card yu-ft" data-section="teams">
        <FollowedTeams initialTeams={follows.teams} allTeams={allTeams} cap={follows.cap} heading={false} />
      </div>
    </>
  );
}

function Alerts({ alerts }) {
  if (!alerts) return null;
  // THE PUSH ROW IS THE SWITCH WHERE THERE IS ONE. Inside the app (the push
  // plugin present) it is NotificationsRow, the control /account carried;
  // everywhere else the plugin is absent and the row states what is true.
  const pushState = (
    <div className="yu-set" data-row="push">
      <span className="yu-k">Push notifications<small>{alerts.push.where}</small></span>
      <span className={`yu-v${alerts.push.on ? ' on' : ''}`}>{alerts.push.on ? 'On' : 'Off'}</span>
    </div>
  );
  return (
    <>
      <SectionHead title="Alerts" />
      <div className="yu-card" data-section="alerts">
        <NotificationsRow variant="you" choice={alerts.push.choice ?? null} fallback={pushState} />
        {alerts.games.count > 0 ? (
          <Link className="yu-set" href="/scores" data-row="games">
            <span className="yu-k">Game alerts<small>{alerts.games.count} game{alerts.games.count === 1 ? '' : 's'} subscribed</small></span>
            <span className="yu-v">{alerts.games.sendLine ?? 'nothing set'}</span>
            <span className="yu-chev">›</span>
          </Link>
        ) : null}
        {/* THE ONE WRITER ON THIS TAB. A league-wide standing instruction has
            no other surface to point at - see RedZoneRow's own note. */}
        <RedZoneRow league="nfl" label="NFL red zone" />
        <div className="yu-set" data-row="email">
          <span className="yu-k">Email<small>{alerts.emailMasked ?? 'your address'}</small></span>
          <span className={`yu-v${alerts.email.optedOut ? '' : ' on'}`}>{alerts.email.optedOut ? 'Unsubscribed' : 'On'}</span>
        </div>
      </div>
    </>
  );
}

// FOR MEMBERS AND FREE ACCOUNTS ALIKE (sun-16 D): /account named the state
// for everybody, and a free reader asking "what am I on" deserves the answer
// too. 3.1.1: no pricing link inside the native container - a member there is
// told where billing lives instead, the line /sim/account already uses.
function Membership({ membership, isShell = false }) {
  if (!membership) return null;
  const m = membership;
  const plan = [m.tier, m.source ? `billed through ${m.source}` : null].filter(Boolean).join(' · ');
  return (
    <div className={`yu-mem${m.member ? '' : ' yu-mem--free'}`} data-section="membership">
      <div>
        <div className="yu-mt">{m.member ? 'Member' : 'Free'}</div>
        {m.member && m.date ? <div className="yu-ms">{m.verb} {m.date}</div> : null}
        {m.member && plan ? <div className="yu-ms">{plan}</div> : null}
        {!m.member ? <div className="yu-ms">Everything is free this season.</div> : null}
        {m.member && isShell ? <div className="yu-ms">Membership is managed on sportsvyn.com from any browser.</div> : null}
      </div>
      {isShell ? null : <Link className="yu-mgo" href="/membership">{m.member ? 'Manage' : 'See membership'}</Link>}
    </div>
  );
}

// YOUR DRAFTS, from /account (sun-16 D): the same three buckets, every row,
// in this tab's row grammar. Nothing at all when there are none - a heading
// over an empty list reads as a feature that failed to load.
const DRAFT_GROUPS = [['open', 'Unfinished mocks'], ['tracker', 'Tracked drafts'], ['done', 'Completed mocks']];
function Drafts({ drafts }) {
  const groups = DRAFT_GROUPS.map(([k, t]) => [k, t, drafts?.[k] ?? []]).filter(([, , rows]) => rows.length > 0);
  if (!groups.length) return null;
  return (
    <>
      <SectionHead title="Your drafts" href="/sim" label="Mock draft →" />
      <div className="yu-card" data-section="drafts">
        {groups.map(([k, t, rows]) => (
          <div className="yu-dg" key={k} data-group={k}>
            <div className="yu-dgh">{t}</div>
            {rows.map((d) => {
              const when = draftDate(d.completedAt ?? d.startedAt);
              const meta = [d.seat != null ? `pick ${d.seat}` : null, `${d.picks} picks`, when].filter(Boolean).join(' · ');
              return (
                <Link className="yu-set" key={d.id} href={d.href} data-draft={d.id}>
                  <span className="yu-k">{d.label}<small>{meta}</small></span>
                  <span className="yu-v">{d.grade ? <b className="yu-n">{d.grade}</b> : null} {draftAction(d)}</span>
                  <span className="yu-chev">›</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

// PLAYERS YOU FOLLOW, from /my (sun-16 D). Rendered only when there are some:
// the follow is made on a player's page, which is where it is undone too.
function Players({ players }) {
  if (!players?.length) return null;
  return (
    <>
      <SectionHead title="Players you follow" />
      <div className="yu-card" data-section="players">
        {players.map((p) => (
          <Link className="yu-tm" key={p.id} href={`/player/${p.slug}`} data-player-id={p.id}>
            <span className="yu-tname">{p.name}</span>
            <span className="yu-lg">{[p.position, p.team, p.league].filter(Boolean).join(' · ')}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

// SIGN OUT AND DELETE ARE THE REAL CONTROLS (sun-16 D). These rows used to
// link to /account, which held them; /account is a redirect to here now, so
// they live here - the same SignOutButton (it also logs out of RevenueCat) and
// the same DeleteAccount (App Store 5.1.1(v): deletion reachable in-app, in
// the account surface, behind one confirm). Draft settings stay on
// /sim/account, which keeps its own copy of both.
function Settings({ me, isShell = false }) {
  return (
    <>
      <SectionHead title="Settings" />
      <div className="yu-card" data-section="settings" id="settings">
        <div className="yu-set" data-row="account">
          <span className="yu-k">Signed in as</span>
          <span className="yu-v">{me?.emailMasked ?? 'your account'}</span>
        </div>
        <div className="yu-set" data-row="tz">
          <span className="yu-k">Time zone<small>from this device</small></span>
          <span className="yu-v">{me?.zone ?? 'not set'}</span>
        </div>
        <div className="yu-set" data-row="handle">
          <span className="yu-k">Handle<small>{me?.handleChanged ? 'changed once' : 'not changed'}</small></span>
          <span className="yu-v">{me?.display}</span>
        </div>
        <Link className="yu-set" href="/sim/account" data-row="draftsettings">
          <span className="yu-k">Draft settings<small>the mock draft&apos;s account page</small></span>
          <span className="yu-chev">›</span>
        </Link>
        <div className="yu-set yu-act" data-row="signout">
          <SignOutButton shell={isShell} />
        </div>
        <div className="yu-set yu-act yu-del" data-row="delete">
          <DeleteAccount shell={isShell} />
        </div>
      </div>
    </>
  );
}

function Foot({ build = null }) {
  return (
    <div className="yu-foot">
      {/* /games/how-it-works: the bare /how-it-works this linked was a 404. */}
      <Link href="/games/how-it-works">How the games work</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/contact">Contact</Link>
      {build ? <span className="yu-ver">Sportsvyn · build {build}</span> : null}
    </div>
  );
}

const PROMISES = [
  ['D', 'A streak', 'One board a day, three minutes'],
  ['W', 'A rank in four games', 'Same boards as everyone else'],
  ['★', 'Your teams', 'Scores and alerts for the ones you pick'],
];

export default function You({ v, signinHref = '/signin', isShell = false }) {
  if (!v.signedIn) {
    return (
      <div className="yu" data-surface="ink" data-signed-in="0">
        <div className="yu-so" data-section="signedout">
          <h2>You</h2>
          <p>Your streak, your rank in every game, the teams you follow and what gets pushed to this phone. All of it starts with a handle.</p>
          <Link className="yu-cta" href={signinHref}>Create your account</Link>
          <Link className="yu-alt" href={signinHref}>Already have one? Sign in</Link>
        </div>
        <SectionHead title="What you get" />
        <div className="yu-card" data-section="promises">
          {PROMISES.map(([ic, title, sub]) => (
            <div className="yu-gr" key={title}>
              <span className="yu-ic">{ic}</span>
              <span className="yu-nm">{title}<small>{sub}</small></span>
            </div>
          ))}
        </div>
        <Foot />
      </div>
    );
  }
  return (
    <div className="yu" data-surface="ink" data-signed-in="1">
      <Identity me={v.me} />
      <Streak daily={v.daily} />
      <Dots daily={v.daily} />
      <Season season={v.season} />
      <Follows follows={v.follows} allTeams={v.allTeams ?? []} />
      <Players players={v.players} />
      <Drafts drafts={v.drafts} />
      <Alerts alerts={v.alerts ? { ...v.alerts, emailMasked: v.me?.emailMasked ?? null } : null} />
      <Membership membership={v.membership} isShell={isShell} />
      <Settings me={v.me} isShell={isShell} />
      <Foot build={v.build} />
    </div>
  );
}

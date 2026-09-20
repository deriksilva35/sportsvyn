// components/you/You.js - the You tab, per docs/design/mocks/you-tab-v0_1.html.
//
// YOU IS THE RECORD, TODAY IS THE DAY (R1). Nothing on this tab reads a live
// game. The only number that moves mid-slate is a rank, and it moves because
// a board settled.
//
// ALERTS ARE READ AND LINK ONLY (R3), WITH EXACTLY ONE EXCEPTION. Every row
// states what is true and points at the surface that changes it, and the
// AlertBell sheet and /account's rows are still untouched.
//
// THE EXCEPTION IS THE RED-ZONE SWITCH, and it is not a crack in the rule so
// much as the case the rule did not cover. R3 works because every alert has a
// surface that owns it: a game's bell owns a game, a team page owns a team.
// A LEAGUE-WIDE STANDING INSTRUCTION OWNS NOTHING SMALLER THAN ITSELF - there
// is no screen it could point at - so a read-only row would point at nothing
// and the preference would be unreachable. It writes. Nothing else here does,
// and the next row that wants to should have to argue with this paragraph.
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
import RedZoneRow from './RedZoneRow';
import TeamMark from '@/components/team/TeamMark';
import { leagueWord } from '@/lib/you/reads';
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
      <Link className="yu-edit" href="/account">Edit</Link>
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
      <SectionHead title="The Daily" href="/daily" label="History →" />
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

function Follows({ follows }) {
  return (
    <>
      <SectionHead title="Teams you follow" href="/rankings/teams?league=nfl" label="Add →" />
      {follows.teams.length > 0 ? (
        <div className="yu-card" data-section="teams">
          {follows.teams.map((t) => (
            <div className="yu-tm" key={t.id} data-team-id={t.id}>
              <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary} abbr={t.abbreviation}
                size={22} title={t.fullName ?? t.name} className="yu-mk" />
              <Link className="yu-tname" href={`/team/${t.slug}`}>{t.name}</Link>
              <span className="yu-lg">{leagueWord(t.leagueSlug, t.leagueName)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="yu-card" data-section="teams">
          <p className="yu-empty">No teams yet. Following one marks its games as yours across the site.</p>
        </div>
      )}
      {/* R4: the cap is on the control, so a sixth follow is never a surprise. */}
      <Link className="yu-add" href={`/rankings/teams?league=${follows.teams[0]?.leagueSlug ?? 'nfl'}`}>
        Follow a team{follows.capLine ? ` · ${follows.capLine}` : ''}
      </Link>
    </>
  );
}

function Alerts({ alerts }) {
  if (!alerts) return null;
  return (
    <>
      <SectionHead title="Alerts" href="/account" label="All →" />
      <div className="yu-card" data-section="alerts">
        <Link className="yu-set" href="/account" data-row="push">
          <span className="yu-k">Push notifications<small>{alerts.push.where}</small></span>
          <span className={`yu-v${alerts.push.on ? ' on' : ''}`}>{alerts.push.on ? 'On' : 'Off'}</span>
          <span className="yu-chev">›</span>
        </Link>
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
        <Link className="yu-set" href="/account" data-row="email">
          <span className="yu-k">Email<small>{alerts.emailMasked ?? 'your address'}</small></span>
          <span className={`yu-v${alerts.email.optedOut ? '' : ' on'}`}>{alerts.email.optedOut ? 'Unsubscribed' : 'On'}</span>
          <span className="yu-chev">›</span>
        </Link>
      </div>
    </>
  );
}

function Membership({ membership }) {
  if (!membership?.member) return null;
  return (
    <div className="yu-mem" data-section="membership">
      <div>
        <div className="yu-mt">Member</div>
        {membership.date ? <div className="yu-ms">{membership.verb} {membership.date}</div> : null}
      </div>
      <Link className="yu-mgo" href="/account">Manage</Link>
    </div>
  );
}

function Settings({ me }) {
  return (
    <>
      <SectionHead title="Settings" />
      <div className="yu-card" data-section="settings">
        <div className="yu-set" data-row="tz">
          <span className="yu-k">Time zone<small>from this device</small></span>
          <span className="yu-v">{me?.zone ?? 'not set'}</span>
        </div>
        <Link className="yu-set" href="/account" data-row="handle">
          <span className="yu-k">Handle<small>{me?.handleChanged ? 'changed once' : 'not changed'}</small></span>
          <span className="yu-v">{me?.display}</span>
          <span className="yu-chev">›</span>
        </Link>
        <Link className="yu-set" href="/account" data-row="signout">
          <span className="yu-k">Sign out</span>
          <span className="yu-chev">›</span>
        </Link>
      </div>
    </>
  );
}

function Foot({ build = null }) {
  return (
    <div className="yu-foot">
      <Link href="/how-it-works">How the games work</Link>
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

export default function You({ v, signinHref = '/signin' }) {
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
      <Follows follows={v.follows} />
      <Alerts alerts={v.alerts ? { ...v.alerts, emailMasked: v.me?.emailMasked ?? null } : null} />
      <Membership membership={v.membership} />
      <Settings me={v.me} />
      <Foot build={v.build} />
    </div>
  );
}

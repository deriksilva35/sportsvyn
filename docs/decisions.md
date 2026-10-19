# Decisions - SPORTSVŶN (append-only)

Rulings that outlive a relay. Newest last. Each line: date, source, the ruling, where it lives in code.

## 2026-10-19 - sun-1 (Derik), Leagues slice 3 (draft league linked to a player league)
- EXPIRED /join CODE STAYS DEAD. An expired or revoked draft invite never becomes a live door into
  the linked league; a non-member sees "This invite has expired, ask the owner for a new code."
  A league member is still taken to the league's Draft tab. Code: lib/leagues/draftLink.js joinDoor,
  lib/fantasy/inviteCode.js REFUSALS.expired.
- BOTS SWITCH: stored now (player_leagues.bots_on, owner only, default OFF); it governs the shared
  league draft from slice 4. A member's private mock still fills every other seat with bots.
- MUST-DO BEFORE THE 2027 KEEPER IMPORT: next season's Fantrax import must attach to the SAME player
  league (match on external_league_id, set draft_configs.league_id), so keepers and members carry
  over. Today lib/fantrax/import.js always inserts a new, unlinked config (recon slice 3e).

## 2026-10-19 - mon-5 (Derik), NBA opening-night email to the full list (ONE-OFF)
- ONE-OFF EXCEPTION to the 15 Oct rule (the morning email goes only to the active-player audience:
  30-day players, <14-day accounts, /you opt-ins). Tue 20 Oct 2026 ONLY, the NBA opening-night
  morning email also goes, once, to every other account with an address (Group B), except:
  unsubscribed (incl. anyone since the 15 Oct arcade email), hard bounces, complaints, house and
  owner accounts, Morning email OFF at /you, and anyone in the morning audience (Group A).
- From Wed 21 Oct the daily email is the active-player audience only again; the code refuses any
  day but 2026-10-20.
- B's mail = the same Tue email (same subject) without YOUR MOVE or the personal block; footer
  "You're getting this because you have a Sportsvyn account." + one-click unsubscribe (RFC 8058).
- Sent from 15:05Z after A finishes, 50 a minute, through A's per-user-per-day ledger (no doubles,
  a rerun sends nothing); stops itself on complaints > 1 or B hard bounces > 5%. Kill switch
  BROADCAST_NBA_OPENER (default OFF). Code: lib/email/nbaOpener.js, app/api/cron/nba-opener.

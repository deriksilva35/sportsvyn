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

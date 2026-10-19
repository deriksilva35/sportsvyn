# mon-5 - NBA opener email to the full list (Tue 20 Oct), HELD FOR GO

Branch nba-opener @ 8792f49 (pushed). 35ba02c built by the previous session (killed by the 20:12Z
droplet reboot mid-suite); taken over per "no silent finishes": DEV orphan sweep found nothing from
the killed run; commit reviewed; 8792f49 adds ONE SEND PER ADDRESS (an address A mails, or mailed
today through another account, or a second B account on one address, is not B; holds across batches).

- Group A 44 (40 active, 4 new), unchanged, morning cron 15:00Z.
- Group B 251 on PROD (read via scripts/morning-email.mjs --b --count --prod, as Tue). Exclusions in
  the WHERE clause: unsubscribed (email_opted_out_at, covers post-15 Oct), hard bounces, complaints,
  is_house, owner list, Morning email OFF at /you, A by id and by address, today's ledger.
- Mail: same subject ("NBA opening night: 3 games tonight - make your picks"); no YOUR MOVE / personal
  block; footer "You're getting this because you have a Sportsvyn account." + unsubscribe + postal.
- Send: Vercel cron /api/cron/nba-opener "5-45 15 20 10 *", one batch of 50 per firing, >= 60 s apart,
  only after A's run finished with nothing 'sending'; same ledger (source morning-email, why nba-opener).
- Stop: complaints > 1 (A+B, today's message ids) or B hard bounces > 5% -> stop row, alert email,
  every later firing sends nothing. Kill switch BROADCAST_NBA_OPENER (Vercel env), default off;
  refuses any day but 2026-10-20.
- Links: droplet-signed unsubscribe probed on sportsvyn.com with sentinel 999999999: valid GET/POST
  accepted, tampered refused.
- Suite 6546/0 on 8792f49 (810 s). decisions.md entry is in the branch.
- Test: ONE B mail to derik@sportsvyn.com 20:34:38Z, Resend 01a155df-92ef-73e9-9172-9179bf8014a5.

AT GO (before 15:00Z Tue): set BROADCAST_NBA_OPENER=on in Vercel production; merge nba-opener to main
(re-run suite on the merge), preview READY, production deploy READY (the cron + env need the build).
Turn it off again after Tue (the code refuses other days regardless).

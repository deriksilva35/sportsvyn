# Crew log - one line per crew action, newest last
- 2026-10-22 thu-3: CI skips the suite for docs-only changes (docs/**, crew/README.md, root *.md); the required check "SPORTSVŶN test suite" still reports, as a one-step pass on ubuntu-latest. Everything else, crew/bin and crew/lib included, runs the full suite.
- 2026-10-22 thu-3 proof: this docs-only PR (docs/CREW-LOG.md only) took the skip path of "SPORTSVŶN test suite".
- 2026-10-22 thu-3 follow-up: crew/agents/**, crew/project.yaml and crew/NOTES.md now count as docs for the CI suite skip (crew/bin/** and crew/lib/** stay code); proved by the crew/agents/README.md PR.
- 2026-10-22 crew/ made canonical; Drive archived (CrewOS adapter spec 3a)
- 2026-10-22 crew day-1 fixes: Watcher v1.5.2, Data Keeper v1.5.1, Fixer v1.5.1, project.yaml v1.5.3

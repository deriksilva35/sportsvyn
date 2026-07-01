@AGENTS.md

## Remote Dev Environment (considered-cc droplet)

This repo is cloned on an always-on DigitalOcean droplet (host: considered-cc,
IP 165.227.30.35, user: derik) at ~/projects/sportsvyn, in addition to the Mac.
The droplet runs Claude Code on the Max subscription, inside tmux, reachable
from phone/laptop/desktop via Remote Control (Claude app -> Code tab).

Rules for any CC session running ON the droplet:
- The droplet is a PULL-ONLY mirror. Origin of truth for commits is wherever
  the work is actively done; use `git pull` to sync, and only push deliberate,
  reviewed work.
- NEVER commit the droplet's regenerated package-lock.json. It was rebuilt on
  Linux and contains platform-specific (linux-x64) native binaries that differ
  from the Mac lockfile. Leave lockfiles out of any droplet commit.
- Do not commit .env / .env.local — secrets were scp'd in and are gitignored.
- node_modules on the droplet is Linux-native; never commit it.

Restart the droplet's Remote Control session for this repo with:
  tmux new -d -s cc-sportsvyn 'cd ~/projects/sportsvyn && claude --remote-control --name sportsvyn'

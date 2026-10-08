# ~/crew/lib/common.sh - shared by ~/crew/bin/*. READ-ONLY tools: nothing here writes anywhere.
set -euo pipefail
CREW="$HOME/crew"; SECRETS="$CREW/secrets"; RELEASE="$HOME/deploy/sportsvyn/current"
VERCEL_PROJECT=prj_dnWLrT1wn34YScbMwQgtGT3WYVoE; VERCEL_TEAM=team_zIjdhUJZ8BmNah6Bqx00je4P; VERCEL_SCOPE=deriksilva35s-projects
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
die() { echo "$(basename "$0"): $*" >&2; exit 2; }
# The CLI's own login (refreshed by any CLI call); the token never leaves this host.
vercel_token() { vercel whoami >/dev/null 2>&1 || true; python3 -c "import json;print(json.load(open('$HOME/.local/share/com.vercel.cli/auth.json'))['token'])"; }
# DB target: PROD through crew_reader by default; --dev for DEV's crew_reader.
db_env() {
  local which="${1:-prod}" f="$SECRETS/crew-reader-$which.url"
  [ -r "$f" ] || die "no crew_reader URL for $which ($f) - the PROD role waits for Derik's GO; try --dev"
  set -a; . "$f"; set +a
  if [ "$which" = prod ]; then export CREW_DB_URL="$CREW_PROD_DATABASE_URL"; else export CREW_DB_URL="$CREW_DEV_DATABASE_URL"; fi
}

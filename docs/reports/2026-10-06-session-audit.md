# Session-start audit (tue-1 item 5) - 6 Oct 2026

Nothing was changed. These are measurements, plus a proposal.

## What loads every session (estimates at ~4 chars/token)
| Source | Size | ~Tokens |
|---|---|---|
| CLAUDE.md (repo) | 21.4 KB, 368 lines | ~5,400 |
| AGENTS.md (imported) | 0.3 KB | ~80 |
| Memory index MEMORY.md (31 files behind it) | 4.8 KB | ~1,200 |
| Deferred MCP tool-name list (~410 names) | ~16 KB | ~4,000-5,000 |
| MCP server instruction blocks (Docs, Expedia, Higgsfield, Supabase, Vercel, Zapier) | ~7 KB | ~1,800 |
| **Total of these** | | **~12,500-13,500** |

## MCP servers this repo uses
- **claude.ai Vercel**: used. list_deployments, create_deployment by SHA for
  previews of already-pushed commits, web_fetch_vercel_url.
- **Not used in this repo:** Gmail, Google Drive, Google Calendar, Higgsfield,
  Intuit QuickBooks, Expedia, Zapier, Supabase (the DB is Neon), GoDaddy, Resend,
  Runway, Claude Docs.
- **Plugins:** data (amplitude, bigquery, hex, definite - failing to connect),
  design (figma, intercom), engineering (datadog, github, pagerduty),
  productivity (asana, atlassian, clickup, linear, monday, notion, slack),
  pdf-viewer.

## Estimated saving if trimmed to Vercel only
- Roughly 5,000-6,000 tokens per session start: most of the tool-name list and
  5 of the 6 instruction blocks.
- Real but not dramatic. CLAUDE.md is the single largest item.

## Why I did not apply it
- I could not verify the configuration keys. The `claude` binary is not
  executable from the agent shell, so `claude plugin list` / `claude mcp list`
  could not run.
- The documentation lookup returned keys without citations, and one of them
  (`disabledMcpServers` with tool-name globs) looked guessed.
- A wrong key does nothing, or worse, removes the Vercel connector, which the
  preview gate depends on.

## Proposal for Derik (two minutes, interactive)
1. In a sportsvyn session, run `/mcp` and disable every claude.ai connector
   except Vercel.
   Note: `/mcp` changes persist to ~/.claude.json, which is user-wide, not
   per project.
2. Run `/plugin`, then the Installed tab, and disable data, design,
   engineering, productivity and pdf-viewer for this project.
   That writes `enabledPlugins` with the exact `name@marketplace` ids.
3. Or, for every claude.ai connector at once: env `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
   That would also drop Vercel, and the preview gate would then use the
   `vercel` CLI only, which works except for building a preview by SHA.

## Also found
- ~/.claude/settings.json `autoMode.environment` describes a different project
  (trick-shot-lab: Godot, Supabase, cc-trickshot) and applies to every repo,
  including this one.
- The auto-mode classifier therefore reasons about sportsvyn with the wrong
  context: no Neon, no droplet services, no PROD scripts.
- Worth rewriting or scoping per project. Not changed.

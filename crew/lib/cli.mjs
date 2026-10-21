// crew/lib/cli.mjs - the table crew/bin/<name> shims dispatch through. One place decides how each
// script's output and failure look, so the contract (crew/README.md) cannot drift per script.
import { runCli } from './common.mjs';

/** name -> [module, runCli options]. board-state prints ONLY its state line and nothing on error. */
export const SCRIPTS = Object.freeze({
  'app-errors': ['./appErrors.mjs', {}],
  'vercel-errors': ['./vercelErrors.mjs', {}],
  'retention-status': ['./retentionStatus.mjs', {}],
  'provider-health': ['./providerHealth.mjs', {}],
  'cost-watch': ['./costWatch.mjs', {}],
  'latest-deploy': ['./latestDeploy.mjs', {}],
  'board-state': ['./boardState.mjs', { silentOnError: true, summaryFn: (s) => s }],
  'data-keeper': ['./dataKeeper.mjs', { deadlineMs: null }],
});

export async function run(name, opts = {}) {
  const entry = SCRIPTS[name];
  if (!entry) { process.stdout.write(`SUMMARY ${name} status=error reason=unknown-script\n`); process.exit(2); }
  const mod = await import(entry[0]);
  return runCli(name, mod.main, { ...entry[1], ...opts });
}

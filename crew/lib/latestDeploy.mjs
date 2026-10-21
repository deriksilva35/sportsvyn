// crew/lib/latestDeploy.mjs - latest-deploy: the newest PRODUCTION deployment of the sportsvyn
// Vercel project (pinned in vercel.mjs; only that project's data is returned).
import { parseArgs, requireToken, fetchJson } from './common.mjs';
import { VERCEL_API, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, vercelHeaders } from './vercel.mjs';

/** PURE. Vercel's state -> READY | ERROR | BUILDING (QUEUED/INITIALIZING count as BUILDING); CANCELED passes through. */
export function normalizeState(s) {
  const v = String(s ?? '').toUpperCase();
  if (v === 'READY' || v === 'ERROR' || v === 'CANCELED') return v;
  return 'BUILDING';
}

/** PURE. deployment object (v6 list item) -> summary fields + exit code. */
export function summarize(d) {
  if (!d) return { summary: { status: 'ok', deploy_id: '-', state: '-', commit: '-', created: '-' }, code: 0 };
  const state = normalizeState(d.state ?? d.readyState);
  const sha = d.meta?.githubCommitSha ?? '';
  return {
    summary: {
      status: state === 'ERROR' ? 'regression' : 'ok',
      deploy_id: d.uid ?? d.id ?? '-',
      state,
      commit: sha ? sha.slice(0, 7) : '-',
      created: d.created ? new Date(d.created).toISOString().replace(/\.\d{3}Z$/, 'Z') : '-',
    },
    code: state === 'ERROR' ? 1 : 0,
  };
}

export async function main({ argv, env, fetchImpl }) {
  parseArgs(argv, []);
  const token = requireToken('vercel.token', 'Vercel token', env);
  const url = `${VERCEL_API}/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&target=production&limit=1`;
  const body = await fetchJson(url, { headers: vercelHeaders(token), label: 'vercel deployments', fetchImpl });
  const { summary, code } = summarize(body?.deployments?.[0]);
  return { lines: [`latest production deployment: ${summary.deploy_id} ${summary.state} ${summary.commit}`], summary, code };
}

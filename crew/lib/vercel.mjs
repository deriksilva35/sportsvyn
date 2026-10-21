// crew/lib/vercel.mjs - the ONE Vercel project crew/bin may read. The token is account-wide and
// cannot be scoped, so the isolation is here: every call is pinned to this project and team, and
// scripts return only that project's data. Ids came from the previous common.sh (project
// "sportsvyn", team slug deriksilva35s-projects); no .vercel/project.json exists in the repo.
export const VERCEL_API = 'https://api.vercel.com';
export const VERCEL_WEB = 'https://vercel.com';
export const VERCEL_PROJECT_NAME = 'sportsvyn';
export const VERCEL_PROJECT_ID = 'prj_dnWLrT1wn34YScbMwQgtGT3WYVoE';
export const VERCEL_TEAM_ID = 'team_zIjdhUJZ8BmNah6Bqx00je4P';
export const VERCEL_TEAM_SLUG = 'deriksilva35s-projects';

export const vercelHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

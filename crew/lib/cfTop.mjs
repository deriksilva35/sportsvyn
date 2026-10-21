// crew/lib/cfTop.mjs - cf-top [window_min=60]: Cloudflare traffic for the sportsvyn.com zone.
// The token is read-only analytics; the zone is looked up BY NAME (sportsvyn.com) so nothing but
// that zone's data can be returned. Output carries counts, ASN numbers and paths - never client
// IPs or user agents.
import { parseArgs, requireToken, fetchJson, SetupError } from './common.mjs';

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const CF_ZONE_NAME = 'sportsvyn.com';
export const ARGS = [{ name: 'window_min', default: 60, min: 1, max: 1440 }];

const BLOCK = new Set(['block']);
const CHALLENGE = new Set(['challenge', 'js_challenge', 'managed_challenge', 'jschallenge', 'managedchallenge']);

export const GQL = `query($z:String!,$s:Time!,$e:Time!){viewer{zones(filter:{zoneTag:$z}){
 total:httpRequestsAdaptiveGroups(limit:1,filter:{datetime_geq:$s,datetime_leq:$e}){count}
 asn:httpRequestsAdaptiveGroups(limit:1,filter:{datetime_geq:$s,datetime_leq:$e},orderBy:[count_DESC]){count dimensions{clientAsn}}
 path:httpRequestsAdaptiveGroups(limit:1,filter:{datetime_geq:$s,datetime_leq:$e},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
 fw:firewallEventsAdaptiveGroups(limit:50,filter:{datetime_geq:$s,datetime_leq:$e}){count dimensions{action}}
}}}`;

/** PURE. The zone object out of a graphql response -> summary fields (always exit 0). */
export function summarize(windowMin, zone) {
  const z = zone ?? {};
  const fw = z.fw ?? [];
  const sum = (set) => fw.filter((g) => set.has(String(g.dimensions?.action ?? '').toLowerCase())).reduce((a, g) => a + Number(g.count ?? 0), 0);
  const asn = z.asn?.[0]?.dimensions?.clientAsn;
  const path = z.path?.[0]?.dimensions?.clientRequestPath;
  return {
    summary: {
      status: 'ok',
      window_min: windowMin,
      requests: Number(z.total?.[0]?.count ?? 0),
      blocked: sum(BLOCK),
      challenged: sum(CHALLENGE),
      top_asn: asn ?? '-',
      top_path: path ? String(path).split('?')[0] : '-',
    },
    code: 0,
  };
}

export async function main({ argv, env, fetchImpl, now = Date.now() }) {
  const [windowMin] = parseArgs(argv, ARGS);
  const token = requireToken('cloudflare.token', 'Cloudflare token', env);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const zones = await fetchJson(`${CF_API}/zones?name=${CF_ZONE_NAME}&per_page=1`, { headers, label: 'cloudflare zones', fetchImpl });
  const zoneId = zones?.result?.[0]?.id;
  if (!zoneId) throw new SetupError(`zone ${CF_ZONE_NAME} not visible to this token`, 'auth');
  const body = JSON.stringify({ query: GQL, variables: { z: zoneId, s: new Date(now - windowMin * 60_000).toISOString(), e: new Date(now).toISOString() } });
  const r = await fetchJson(`${CF_API}/graphql`, { method: 'POST', headers, body, label: 'cloudflare graphql', fetchImpl });
  if (r?.errors?.length) throw new SetupError(`cloudflare graphql: ${String(r.errors[0]?.message ?? 'error').slice(0, 120)}`, 'api');
  const { summary, code } = summarize(windowMin, r?.data?.viewer?.zones?.[0]);
  return { lines: [`cloudflare ${CF_ZONE_NAME}, last ${windowMin} min`], summary, code };
}

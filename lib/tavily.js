// lib/tavily.js - minimal Tavily research client for the topic_draft pipeline.
//
// searchTavily(queries) runs each planned query through Tavily's /search
// (advanced depth), dedupes results by URL across all queries, ranks them by
// source authority (tier 1 highest), and drops forums / social. If
// TAVILY_API_KEY is unset it logs a warning and returns [] - the pipeline then
// runs on the internal envelope alone (degraded, NOT failed).

const TAVILY_URL = 'https://api.tavily.com/search';

// Source-authority tiers. Tier 1: wire services + the most authoritative sports
// desks + governing bodies. Tier 2: major national outlets. Everything else is
// tier 3. Forums / social are dropped entirely (return null).
const TIER_1 = [
  'bbc.com', 'bbc.co.uk', 'espn.com', 'theathletic.com', 'nytimes.com',
  'reuters.com', 'apnews.com',
  'fifa.com', 'uefa.com', 'conmebol.com', 'concacaf.com', 'thefa.com',
];
const TIER_2 = [
  'theguardian.com', 'skysports.com', 'goal.com', 'marca.com', 'as.com',
  'lequipe.fr', 'gazzetta.it', 'kicker.de', 'football-italia.net',
  'washingtonpost.com', 'si.com', 'cbssports.com', 'nbcsports.com',
  'independent.co.uk', 'telegraph.co.uk', 'mirror.co.uk',
];
const DROP = [
  'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'quora.com', 'medium.com', 'tiktok.com', 'youtube.com', 'wikipedia.org',
];

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function tierOf(url) {
  const host = hostOf(url);
  if (!host) return null;
  if (DROP.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  if (TIER_1.some((d) => host === d || host.endsWith(`.${d}`))) return 1;
  if (TIER_2.some((d) => host === d || host.endsWith(`.${d}`))) return 2;
  return 3;
}

async function searchOne(query, apiKey) {
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: 8,
    }),
  });
  if (!res.ok) {
    console.warn(`tavily: query "${query}" returned HTTP ${res.status}`);
    return [];
  }
  const json = await res.json();
  return Array.isArray(json?.results) ? json.results : [];
}

// searchTavily(queries: string[]) -> [{ url, title, snippet, score, tier }]
// Sorted tier asc (1 first), then Tavily relevance score desc.
export async function searchTavily(queries) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('tavily: TAVILY_API_KEY unset - research stage degraded, running on internal envelope only');
    return [];
  }
  const list = Array.isArray(queries) ? queries.filter(Boolean) : [];
  if (list.length === 0) return [];

  const settled = await Promise.allSettled(list.map((q) => searchOne(q, apiKey)));
  const byUrl = new Map();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const hit of r.value) {
      const url = hit?.url;
      if (!url) continue;
      const tier = tierOf(url);
      if (tier == null) continue; // dropped (forum/social)
      const existing = byUrl.get(url);
      const score = typeof hit.score === 'number' ? hit.score : 0;
      // Keep the highest-scoring instance of a duplicated URL.
      if (!existing || score > existing.score) {
        byUrl.set(url, {
          url,
          title: hit.title ?? '',
          snippet: (hit.content ?? '').slice(0, 600),
          score,
          tier,
        });
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => (a.tier - b.tier) || (b.score - a.score));
}

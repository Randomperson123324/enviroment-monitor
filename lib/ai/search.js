/**
 * Web search through Tavily — the one tool that reaches outside this app.
 * Docs: https://docs.tavily.com/api-reference/endpoint/search
 *
 * Tavily rather than a raw search engine because it returns short extracted
 * answers with their source URLs, which is what a model needs: a page of HTML
 * would have to be fetched, stripped and truncated before it fit in the context,
 * and the truncation is where citations get lost.
 *
 * Off unless the user turns it on (see the search toggle in the assistant) *and*
 * a key is configured. Two conditions, because each covers a different mistake:
 * a missing key is a deployment state, while the toggle is consent — questions
 * about this room's own sensors have no business leaving the building.
 */
import config from '@/config';

export function searchConfigured() {
  return Boolean(config.ai.search.apiKey);
}

/**
 * One search → { query, answer, results:[{title,url,snippet}] }.
 * Never throws for the model's benefit — the caller wraps failures into a tool
 * result, since "the search failed" is something the assistant should say out
 * loud rather than something that should kill the whole turn.
 */
export async function webSearch(query) {
  const { apiKey, baseUrl, maxResults, timeoutMs, depth } = config.ai.search;
  if (!apiKey) return { available: false, reason: 'ไม่มี TAVILY_API_KEY' };

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: depth,
      max_results: maxResults,
      // Tavily's own one-line synthesis. Cheap, and it gives the model something
      // to disagree with rather than only raw snippets.
      include_answer: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tavily ${res.status}: ${detail.slice(0, 160)}`);
  }

  const data = await res.json();
  return {
    query,
    answer: data.answer ?? null,
    results: (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? null,
      url: r.url ?? null,
      // Trimmed on purpose: whole pages would crowd out the sensor data the
      // model also needs this turn.
      snippet: String(r.content ?? '').slice(0, 500),
    })),
  };
}

/**
 * Web search + page fetch for the research stage.
 * Pages that fail to open are dropped, never summarised from a snippet.
 */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface PageText {
  url: string;
  title: string;
  text: string;
}

export interface Search {
  search(query: string, limit?: number): Promise<SearchHit[]>;
  open(url: string): Promise<PageText | null>;
}

/** Source policy: a reputation weight per domain. Unknown domains get 0.4. */
export function domainReputation(url: string): number {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/\.(edu|gov)$/.test(host) || /\.(ac|edu|gov)\.[a-z]{2}$/.test(host)) return 0.95;
  if (/(nasa\.gov|nih\.gov|noaa\.gov|who\.int|europa\.eu)$/.test(host)) return 0.95;
  if (/(britannica\.com|nature\.com|science\.org|sciencedirect\.com|springer\.com|wiley\.com|royalsociety\.org|plos\.org)$/.test(host)) return 0.9;
  if (/(wikipedia\.org)$/.test(host)) return 0.75;
  if (/(smithsonianmag\.com|nationalgeographic\.com|scientificamerican\.com|newscientist\.com|bbc\.co\.uk|bbc\.com|nytimes\.com|theguardian\.com|reuters\.com|apnews\.com)$/.test(host)) return 0.7;
  if (/(quora\.com|reddit\.com|answers\.com|medium\.com|blogspot\.|wordpress\.com|pinterest\.)/.test(host)) return 0.2;
  return 0.4;
}

export class TavilySearch implements Search {
  constructor(private apiKey: string, private f: typeof fetch = fetch) {}

  async search(query: string, limit = 8): Promise<SearchHit[]> {
    const res = await this.f("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: limit, include_answer: false }),
    });
    if (!res.ok) throw new Error(`search failed: ${res.status}`);
    const data = (await res.json()) as { results: { url: string; title: string; content: string }[] };
    return data.results.map((r) => ({ url: r.url, title: r.title, snippet: r.content }));
  }

  async open(url: string): Promise<PageText | null> {
    const res = await this.f("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, urls: [url] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results: { url: string; raw_content: string }[] };
    const r = data.results[0];
    if (!r?.raw_content) return null;
    return { url, title: url, text: r.raw_content.slice(0, 40_000) };
  }
}

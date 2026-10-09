import Exa from "exa-js";

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

export class ExaSearch implements Search {
  private exa: Exa;
  constructor(apiKey: string) {
    this.exa = new Exa(apiKey);
  }

  async search(query: string, limit = 8): Promise<SearchHit[]> {
    const res = await this.exa.search(query, { numResults: limit, type: "auto", contents: { highlights: true } });
    return res.results.map((r) => ({ url: r.url, title: r.title ?? r.url, snippet: r.highlights.join(" … ") }));
  }

  async open(url: string): Promise<PageText | null> {
    try {
      const res = await this.exa.getContents([url], { text: { maxCharacters: 40_000 } });
      const r = res.results[0];
      if (!r?.text) return null;
      return { url, title: r.title ?? url, text: r.text };
    } catch {
      return null;
    }
  }
}

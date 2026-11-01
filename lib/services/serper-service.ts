import type { SerperResult } from "@/lib/types/crawler";
import { isUrlExcluded } from "@/lib/utils/crawler-filters";

const SERPER_ENDPOINT = "https://google.serper.dev/search";

type SerperOrganicItem = {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
};

function isAllowedUrl(url: string, excludeDomains: string[] = []) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !isUrlExcluded(url, excludeDomains);
  } catch {
    return false;
  }
}

export class SerperService {
  private apiKey = process.env.SERPER_API_KEY;

  async searchDork(query: string, pages: number, excludeDomains: string[] = []): Promise<SerperResult[]> {
    if (!this.apiKey) throw new Error("Missing SERPER_API_KEY.");

    const results: SerperResult[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const response = await fetch(SERPER_ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          page,
          num: 10,
          tbs: "qdr:y",
        }),
      });

      if (!response.ok) {
        throw new Error(`Serper error ${response.status}: ${await response.text()}`);
      }

      const payload = (await response.json()) as { organic?: SerperOrganicItem[] };
      for (const item of payload.organic ?? []) {
        if (!item.link || !isAllowedUrl(item.link, excludeDomains)) continue;
        results.push({
          url: item.link,
          title: item.title,
          snippet: item.snippet,
          position: item.position,
          raw: { ...item, dork: query, page, tbs: "qdr:y" },
        });
      }
    }

    return results;
  }

  async searchMany(
    dorks: string[],
    pagesPerDork: number,
    excludeDomains: string[] = [],
  ): Promise<SerperResult[]> {
    const byUrl = new Map<string, SerperResult>();
    for (const dork of dorks) {
      const results = await this.searchDork(dork, pagesPerDork, excludeDomains);
      for (const result of results) byUrl.set(result.url, result);
    }
    return [...byUrl.values()];
  }
}

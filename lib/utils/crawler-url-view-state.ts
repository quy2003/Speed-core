import type { UrlDepthFilter } from "@/lib/utils/forum-url-filter";
import { parseUrlDepthFilter } from "@/lib/utils/forum-url-filter";
import type { UrlPatternFilter } from "@/lib/utils/url-pattern-filter";
import { parseUrlPatternFilter } from "@/lib/utils/url-pattern-filter";

export const CRAWLER_URL_VIEW_STATE_KEY = "speed-core.crawler-url-view-state";

export type CrawlerRegisterFilter = "all" | "has_register" | "no_register";

export type CrawlerUrlViewState = {
  search: string;
  urlDepth: UrlDepthFilter | UrlDepthFilter[];
  urlPattern: UrlPatternFilter | UrlPatternFilter[];
  cms: string;
  jobId: string | null;
  registerFilter: CrawlerRegisterFilter;
};

export const DEFAULT_CRAWLER_URL_VIEW_STATE: CrawlerUrlViewState = {
  search: "",
  urlDepth: "all",
  urlPattern: "all",
  cms: "All CMS",
  jobId: null,
  registerFilter: "all",
};

function parseDepthState(value: unknown): UrlDepthFilter[] {
  if (Array.isArray(value)) {
    return value.map((item) => parseUrlDepthFilter(typeof item === "string" ? item : null)).filter((item) => item !== "all");
  }
  const parsed = parseUrlDepthFilter(typeof value === "string" ? value : null);
  return parsed === "all" ? [] : [parsed];
}

function parsePatternState(value: unknown): UrlPatternFilter[] {
  if (Array.isArray(value)) {
    return value.map((item) => parseUrlPatternFilter(typeof item === "string" ? item : null)).filter((item) => item !== "all");
  }
  const parsed = parseUrlPatternFilter(typeof value === "string" ? value : null);
  return parsed === "all" ? [] : [parsed];
}

export function parseCrawlerUrlViewState(raw: string | null): CrawlerUrlViewState {
  if (!raw) return { ...DEFAULT_CRAWLER_URL_VIEW_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<CrawlerUrlViewState>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      urlDepth: parseDepthState(parsed.urlDepth),
      urlPattern: parsePatternState(parsed.urlPattern),
      cms: typeof parsed.cms === "string" ? parsed.cms : "All CMS",
      jobId: typeof parsed.jobId === "string" && parsed.jobId.trim() ? parsed.jobId : null,
      registerFilter:
        parsed.registerFilter === "has_register" || parsed.registerFilter === "no_register"
          ? parsed.registerFilter
          : "all",
    };
  } catch {
    return { ...DEFAULT_CRAWLER_URL_VIEW_STATE };
  }
}

export function loadCrawlerUrlViewState(): CrawlerUrlViewState {
  if (typeof window === "undefined") return { ...DEFAULT_CRAWLER_URL_VIEW_STATE };
  return parseCrawlerUrlViewState(window.localStorage.getItem(CRAWLER_URL_VIEW_STATE_KEY));
}

export function saveCrawlerUrlViewState(state: CrawlerUrlViewState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CRAWLER_URL_VIEW_STATE_KEY, JSON.stringify(state));
}

export function buildCrawlerResultsQueryParams(
  state: CrawlerUrlViewState,
  extra?: { page?: number; pageSize?: number },
) {
  const params = new URLSearchParams({
    search: state.search,
    cms: state.cms,
    urlDepth: Array.isArray(state.urlDepth) ? state.urlDepth.join(",") : state.urlDepth,
    urlPattern: Array.isArray(state.urlPattern) ? state.urlPattern.join(",") : state.urlPattern,
    registerFilter: state.registerFilter,
  });
  if (state.jobId) params.set("jobId", state.jobId);
  if (extra?.page) params.set("page", String(extra.page));
  if (extra?.pageSize) params.set("pageSize", String(extra.pageSize));
  return params;
}

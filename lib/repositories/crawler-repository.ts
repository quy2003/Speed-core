import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { CrawlJobRow, CrawlLogRow, CrawlResultRow, CrawledUrlResult } from "@/lib/types/crawler";
import { matchesAnyUrlDepth, parseUrlDepthFilters } from "@/lib/utils/forum-url-filter";
import { matchesAnyUrlPattern, parseUrlPatternFilters } from "@/lib/utils/url-pattern-filter";

export type ListResultsParams = {
  search?: string;
  cms?: string;
  page?: number;
  pageSize?: number;
  urlDepth?: string;
  urlPattern?: string;
  jobId?: string | null;
  registerFilter?: string;
};

type CrawlerStore = {
  jobs: CrawlJobRow[];
  logs: CrawlLogRow[];
  results: CrawlResultRow[];
};

const STORE_PATH = path.join(process.cwd(), ".data", "crawler-store.json");

let storeQueue = Promise.resolve();
let memoryCache: CrawlerStore | null = null;

function withStoreLock<T>(action: () => Promise<T>): Promise<T> {
  const next = storeQueue.then(action, action);
  storeQueue = next.then(() => {}, () => {});
  return next;
}

function now() {
  return new Date().toISOString();
}

function emptyStore(): CrawlerStore {
  return { jobs: [], logs: [], results: [] };
}

async function readStore(): Promise<CrawlerStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    if (!raw.trim()) return memoryCache ?? emptyStore();
    const parsed = JSON.parse(raw) as Partial<CrawlerStore>;
    const store: CrawlerStore = {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : (memoryCache?.jobs ?? []),
      logs: Array.isArray(parsed.logs) ? parsed.logs : (memoryCache?.logs ?? []),
      results: Array.isArray(parsed.results) ? parsed.results : (memoryCache?.results ?? []),
    };
    memoryCache = store;
    return store;
  } catch {
    return memoryCache ?? emptyStore();
  }
}

async function writeStore(store: CrawlerStore) {
  memoryCache = store;
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function normalizeSearch(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export class CrawlerRepository {
  async createJob(input: {
    dorks: string[];
    pagesPerDork: number;
    name: string | null;
    maxUrls: number;
    excludeDomains: string[];
    backlinkTargets: string[];
    backlinkSourceLimit: number;
    directUrls?: string[];
  }): Promise<CrawlJobRow> {
    return withStoreLock(async () => {
      const store = await readStore();
      const timestamp = now();
      const job: CrawlJobRow = {
        id: randomUUID(),
        created_at: timestamp,
        updated_at: timestamp,
        status: "queued",
        name: input.name,
        dorks: input.dorks,
        pages_per_dork: input.pagesPerDork,
        max_urls: input.maxUrls,
        exclude_domains: input.excludeDomains,
        backlink_targets: input.backlinkTargets,
        backlink_source_limit: input.backlinkSourceLimit,
        direct_urls: input.directUrls ?? [],
        total_urls: 0,
        processed_urls: 0,
        success_count: 0,
        failed_count: 0,
        error: null,
        metadata: {
          name: input.name,
          max_urls: input.maxUrls,
          exclude_domains: input.excludeDomains,
          backlink_targets: input.backlinkTargets,
          backlink_source_limit: input.backlinkSourceLimit,
          direct_urls: input.directUrls ?? [],
        },
      };

      store.jobs.unshift(job);
      await writeStore(store);
      return job;
    });
  }

  async updateJob(id: string, patch: Partial<CrawlJobRow>) {
    return withStoreLock(async () => {
      const store = await readStore();
      store.jobs = store.jobs.map((job) =>
        job.id === id
          ? {
              ...job,
              ...patch,
              updated_at: now(),
            }
          : job,
      );
      await writeStore(store);
    });
  }

  async getJob(id: string): Promise<CrawlJobRow | null> {
    const store = await readStore();
    return store.jobs.find((job) => job.id === id) ?? null;
  }

  async addLog(jobId: string, message: string, level: CrawlLogRow["level"] = "info", payload: Record<string, unknown> = {}) {
    return withStoreLock(async () => {
      const store = await readStore();
      store.logs.push({
        id: randomUUID(),
        created_at: now(),
        job_id: jobId,
        level,
        message,
        payload,
      });
      await writeStore(store);
    });
  }

  async getJobLogs(jobId: string): Promise<CrawlLogRow[]> {
    const store = await readStore();
    return store.logs
      .filter((log) => log.job_id === jobId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-500);
  }

  async upsertResult(jobId: string, result: CrawledUrlResult) {
    return withStoreLock(async () => {
      const store = await readStore();
      const existingIndex = store.results.findIndex((row) => row.url === result.url);
      const row: CrawlResultRow = {
        ...result,
        id: existingIndex >= 0 ? store.results[existingIndex].id : randomUUID(),
        created_at: existingIndex >= 0 ? store.results[existingIndex].created_at : now(),
        job_id: jobId,
      };

      if (existingIndex >= 0) store.results[existingIndex] = row;
      else store.results.unshift(row);

      await writeStore(store);
    });
  }

  async getExistingUrls(urls: string[]) {
    const lookup = new Set(urls.filter(Boolean));
    const store = await readStore();
    return new Set(store.results.filter((row) => lookup.has(row.url)).map((row) => row.url));
  }

  async getExistingDomains(domains: string[]) {
    const lookup = new Set(domains.filter(Boolean));
    const store = await readStore();
    return new Set(store.results.filter((row) => lookup.has(row.domain)).map((row) => row.domain));
  }

  async listResults(params: ListResultsParams) {
    const store = await readStore();
    const search = normalizeSearch(params.search);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const filtered = store.results
      .filter((row) => !params.jobId || row.job_id === params.jobId)
      .filter((row) => matchesAnyUrlDepth(row.url, parseUrlDepthFilters(params.urlDepth)))
      .filter((row) => matchesAnyUrlPattern(row.url, parseUrlPatternFilters(params.urlPattern)))
      .filter((row) => {
        if (!search) return true;
        return (
          row.url.toLowerCase().includes(search) ||
          row.domain.toLowerCase().includes(search) ||
          (row.title ?? "").toLowerCase().includes(search)
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const from = (page - 1) * pageSize;
    return { rows: filtered.slice(from, from + pageSize), count: filtered.length };
  }

  async getResultsByIds(ids: string[]) {
    const lookup = new Set(ids);
    const store = await readStore();
    return store.results.filter((row) => lookup.has(row.id));
  }

  async listManualReviewResults({ page = 1, pageSize = 20 }: Omit<ListResultsParams, "cms">) {
    const from = (page - 1) * pageSize;
    return { rows: [] as CrawlResultRow[], count: 0, page: from };
  }

  async listReviewCandidateResults() {
    return { rows: [] as CrawlResultRow[], count: 0 };
  }

  async deleteResults(ids: string[]) {
    return withStoreLock(async () => {
      const lookup = new Set(ids);
      const store = await readStore();
      store.results = store.results.filter((row) => !lookup.has(row.id));
      await writeStore(store);
    });
  }
}

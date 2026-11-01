"use server";

import { CrawlerRepository } from "@/lib/repositories/crawler-repository";
import { normalizeDorks, runCrawlJob } from "@/lib/services/crawl-job-runner";
import { normalizeExcludeDomains } from "@/lib/utils/crawler-filters";

export async function startCrawlJobAction(input: {
  dorks: string;
  pagesPerDork: number;
  name?: string;
  maxUrls?: number;
  excludeDomains?: string;
  backlinkTargets?: string;
  backlinkSourceLimit?: number;
}) {
  try {
    const dorks = normalizeDorks(input.dorks);
    const pagesPerDork = Math.max(1, Math.min(20, Number(input.pagesPerDork) || 20));
    const maxUrls = Math.max(10, Math.min(2000, Number(input.maxUrls) || 500));
    const excludeDomains = normalizeExcludeDomains(input.excludeDomains ?? "");
    const name = input.name?.trim().slice(0, 120) || null;

    if (dorks.length === 0) {
      return { ok: false as const, error: "Vui long nhap it nhat 1 tu khoa Google." };
    }

    const repo = new CrawlerRepository();
    const job = await repo.createJob({
      dorks,
      pagesPerDork,
      name,
      maxUrls,
      excludeDomains,
      backlinkTargets: [],
      backlinkSourceLimit: 100,
      directUrls: [],
    });
    await repo.addLog(job.id, "Job da vao queue.");

    void runCrawlJob(job.id);

    return { ok: true as const, jobId: job.id };
  } catch (error) {
    return { ok: false as const, error: formatCrawlerActionError(error) };
  }
}

export async function recrawlResultsAction(input: { ids: string[]; name?: string }) {
  try {
    const ids = Array.isArray(input.ids) ? input.ids.filter((id) => typeof id === "string" && id.trim()) : [];
    if (ids.length === 0) {
      return { ok: false as const, error: "Hay chon it nhat 1 URL de recrawl." };
    }

    const repo = new CrawlerRepository();
    const rows = await repo.getResultsByIds(ids.slice(0, 200));
    const seen = new Set<string>();
    const urls = rows
      .map((row) => row.url)
      .filter((url) => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });

    if (urls.length === 0) {
      return { ok: false as const, error: "Khong tim thay URL hop le de recrawl." };
    }

    const job = await repo.createJob({
      dorks: [],
      pagesPerDork: 1,
      name: input.name?.trim().slice(0, 120) || `Recrawl ${urls.length} URL`,
      maxUrls: Math.max(10, Math.min(2000, urls.length)),
      excludeDomains: [],
      backlinkTargets: [],
      backlinkSourceLimit: 100,
      directUrls: urls,
    });
    await repo.addLog(job.id, "Recrawl job da vao queue.");

    void runCrawlJob(job.id);

    return { ok: true as const, jobId: job.id };
  } catch (error) {
    return { ok: false as const, error: formatCrawlerActionError(error) };
  }
}

export async function cancelCrawlJobAction(jobId: string) {
  try {
    if (!jobId?.trim()) {
      return { ok: false as const, error: "Khong co job dang chay." };
    }

    const repo = new CrawlerRepository();
    const job = await repo.getJob(jobId);
    if (!job) {
      return { ok: false as const, error: "Job khong ton tai." };
    }

    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return { ok: false as const, error: "Job da ket thuc, khong the dung." };
    }

    await repo.updateJob(jobId, { status: "cancelled" });
    await repo.addLog(jobId, "Da nhan lenh dung crawl.", "warn");

    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: formatCrawlerActionError(error) };
  }
}

function formatCrawlerActionError(error: unknown) {
  const message = errorToMessage(error);

  if (message.includes("crawl_jobs") || message.includes("schema cache")) {
    return "Thieu bang crawler trong Supabase. Hay chay file supabase/migrations/000_apply_crawler.sql trong Supabase SQL Editor.";
  }

  return message || "Khong the thuc hien crawler action.";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return errorToMessage(error.message);
  if (typeof error === "string") return error.trim();
  if (typeof error === "number" || typeof error === "boolean") return String(error);

  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.error_description, record.details, record.hint, record.code]
      .flatMap((value) => {
        const message = errorToMessage(value);
        return message ? [message] : [];
      });

    if (parts.length > 0) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown object error";
    }
  }

  return "";
}


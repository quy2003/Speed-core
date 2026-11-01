import { CrawlerRepository } from "@/lib/repositories/crawler-repository";
import { SerperService } from "@/lib/services/serper-service";
import type { CrawledUrlResult, SerperResult } from "@/lib/types/crawler";

async function isJobCancelled(repo: CrawlerRepository, jobId: string) {
  const job = await repo.getJob(jobId);
  return job?.status === "cancelled";
}

function formatJobError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value) => typeof value === "string" && value.trim())
      .map(String);
    if (parts.length > 0) return parts.join(" | ");
  }
  return typeof error === "string" && error.trim() ? error : "Unknown job error";
}

function formatWarnError(error: unknown) {
  const message = formatJobError(error);
  return message.length > 220 ? `${message.slice(0, 220)}...` : message;
}

export async function runCrawlJob(jobId: string) {
  const repo = new CrawlerRepository();
  const serper = new SerperService();

  try {
    const job = await repo.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    if (job.status === "cancelled") return;

    await repo.updateJob(jobId, { status: "running" });

    const jobLabel = job.name?.trim() || jobId.slice(0, 8);
    const excludeDomains = job.exclude_domains ?? [];
    await repo.addLog(
      jobId,
      `Bat dau "${jobLabel}": ${job.dorks.length} tu khoa, ${job.pages_per_dork} trang/tu khoa, toi da ${job.max_urls} domain.`,
    );

    if (job.dorks.length === 0) {
      throw new Error("Vui long nhap it nhat 1 tu khoa Google.");
    }

    const serperResults = await serper.searchMany(job.dorks, job.pages_per_dork, excludeDomains);
    const foundByUrl = new Map<string, SerperResult>();

    for (const result of serperResults) {
      if (!result.url) continue;
      foundByUrl.set(result.url, result);
    }

    const found = [...foundByUrl.values()];

    await repo.addLog(
      jobId,
      `Google/Serper tra ve ${serperResults.length} URL, con ${found.length} URL sau khi loai trung trong job.`,
    );

    if (await isJobCancelled(repo, jobId)) {
      await repo.addLog(jobId, "Job da dung truoc khi luu ket qua.", "warn");
      return;
    }

    let existingUrls = new Set<string>();

    try {
      existingUrls = await repo.getExistingUrls(found.map((item) => item.url).filter(Boolean));
    } catch (error) {
      await repo.addLog(
        jobId,
        `Khong kiem tra duoc URL trung trong database, tiep tuc luu. Loi: ${formatWarnError(error)}`,
        "warn",
      );
    }

    const newResults = existingUrls.size > 0
      ? found.filter((item) => !existingUrls.has(item.url))
      : found;

    if (existingUrls.size > 0) {
      await repo.addLog(jobId, `Bo qua ${existingUrls.size} URL da co trong bang ket qua.`);
    }

    const urls = newResults.slice(0, job.max_urls);
    await repo.updateJob(jobId, { total_urls: urls.length });
    await repo.addLog(jobId, `Luu ${urls.length} URL/domain moi. Khong mo trang, khong doc CMS/email/chi so.`);

    let processed = 0;

    for (const item of urls) {
      if (await isJobCancelled(repo, jobId)) {
        await repo.addLog(jobId, `Dung sau ${processed}/${urls.length} URL.`, "warn");
        return;
      }

      const result = serperResultToCrawlResult(item);
      await repo.upsertResult(jobId, result);

      processed += 1;
      await repo.updateJob(jobId, {
        processed_urls: processed,
        success_count: processed,
        failed_count: 0,
      });
      await repo.addLog(jobId, `OK ${result.domain} - ${result.url}`);
    }

    if (await isJobCancelled(repo, jobId)) {
      await repo.addLog(jobId, "Job da dung.", "warn");
      return;
    }

    await repo.updateJob(jobId, { status: "completed" });
    await repo.addLog(jobId, `Hoan tat. Da luu ${processed} URL/domain duy nhat.`);
  } catch (error) {
    if (await isJobCancelled(repo, jobId)) {
      await repo.addLog(jobId, "Job da dung.", "warn");
      return;
    }

    const message = formatJobError(error);
    await repo.updateJob(jobId, { status: "failed", error: message });
    await repo.addLog(jobId, message, "error");
  }
}

export function normalizeDorks(input: unknown) {
  if (typeof input !== "string") return [];
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function serperResultToCrawlResult(item: SerperResult): CrawledUrlResult {
  return {
    url: item.url,
    domain: getDomain(item.url),
    title: item.title ?? null,
    cms_type: "Unknown",
    emails: [],
    phones: [],
    status: "success",
    error: null,
    crawl_time: 0,
    html_snippet: item.snippet ?? null,
    raw_serper_data: {
      ...item.raw,
      source: "serper-url-only",
      snippet: item.snippet,
      position: item.position,
    },
  };
}

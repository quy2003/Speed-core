import { BacklinksShService } from "./backlinks-sh-service";
import { PlaywrightCrawlerService } from "./playwright-crawler";
import { BacklinkOpportunityRepository } from "../repositories/backlink-opportunity-repository";
import { getDomainFromUrl } from "../utils/domain";
import { getBacklinkCandidateFromRaw } from "../utils/backlink-candidate";
import type { SerperResult } from "@/lib/types/crawler";

function parseTimestampOrNull(val: string | undefined | null): string | null {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function runBacklinkOpportunityJob(jobId: string): Promise<void> {
  const repo = new BacklinkOpportunityRepository();
  const backlinksService = new BacklinksShService();
  const crawler = new PlaywrightCrawlerService();

  console.log(`Starting Opportunity Job ${jobId}`);

  try {
    // 1. Load job
    const job = await repo.getJob(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found`);
      return;
    }

    if (job.status === "cancelled") {
      console.log(`Job ${jobId} was already cancelled`);
      return;
    }

    // 2. Load project & competitors
    const project = await repo.getProject(job.project_id);
    if (!project) {
      await repo.updateJob(jobId, { status: "failed", error: "Project not found" });
      await repo.addLog(jobId, "Project not found. Job failed.", "error");
      return;
    }

    const competitors = await repo.listCompetitors(job.project_id);
    if (competitors.length === 0) {
      await repo.updateJob(jobId, { status: "failed", error: "No competitors found in project" });
      await repo.addLog(jobId, "Project has no competitors configured. Job failed.", "error");
      return;
    }

    // Update status to running
    await repo.updateJob(jobId, { status: "running" });
    await repo.addLog(jobId, `Bắt đầu quét cơ hội backlink cho dự án "${project.name}"...`);

    const sourceLimit = Number(job.metadata.source_limit ?? 100);
    const customExclude = Array.isArray(job.metadata.exclude_domains) ? (job.metadata.exclude_domains as string[]) : [];
    const excludeDomains = [project.my_domain, ...customExclude];

    await repo.addLog(jobId, `Tham số quét: limit = ${sourceLimit} link/đối thủ. Loại trừ domain: ${excludeDomains.join(", ")}`);

    // 3. Fetch sources from backlinks.sh for each competitor
    const competitorDomains = competitors.map((c) => c.domain);
    await repo.addLog(jobId, `Tìm link nguồn từ ${competitorDomains.length} đối thủ cạnh tranh...`);

    // Map to keep track of SerperResult cache by URL
    const serperResultCache = new Map<string, SerperResult>();

    for (const competitor of competitorDomains) {
      // Check cancellation
      const currentJob = await repo.getJob(jobId);
      if (currentJob?.status === "cancelled") {
        await repo.addLog(jobId, "Tiến trình quét bị hủy bởi người dùng.", "warn");
        return;
      }

      try {
        await repo.addLog(jobId, `Đang gọi API backlinks.sh lấy danh sách backlink của đối thủ: ${competitor}`);
        const results = await backlinksService.findSources(competitor, sourceLimit, excludeDomains);
        
        await repo.addLog(jobId, `Đã tìm thấy ${results.length} active backlink của ${competitor}`);
        
        for (const res of results) {
          serperResultCache.set(res.url, res);
          // Save to backlink_source_links
          const item = res.raw as any;
          await repo.upsertSourceLink({
            project_id: project.id,
            competitor_domain: competitor,
            source_url: res.url,
            source_domain: getDomainFromUrl(res.url),
            target_url: item.target_url || null,
            is_active: item.is_active !== false,
            first_seen: parseTimestampOrNull(item.first_seen),
            last_seen: parseTimestampOrNull(item.last_seen),
            raw_data: item,
          });
        }
      } catch (err: any) {
        await repo.addLog(jobId, `Lỗi khi lấy backlink cho đối thủ ${competitor}: ${err.message}`, "warn");
      }
    }

    // 4. Gather unique source URLs for this job/project
    const uniqueUrls = await repo.getUniqueSourceUrls(project.id);
    const totalSources = uniqueUrls.length;
    await repo.updateJob(jobId, { total_sources: totalSources });
    await repo.addLog(jobId, `Tổng hợp có ${totalSources} liên kết nguồn duy nhất cần crawl và phân tích.`);

    if (totalSources === 0) {
      await repo.updateJob(jobId, { status: "completed" });
      await repo.addLog(jobId, "Không có link nguồn nào để crawl. Tiến trình kết thúc.");
      return;
    }

    // Load all source links in memory to calculate competitor metrics efficiently
    const allSourceLinks = await repo.listSourceLinksForProject(project.id);

    // Helper to calculate competitor count and list for a URL/domain
    const getCompetitorInfo = (url: string) => {
      const domain = getDomainFromUrl(url);
      const matchedCompetitors = allSourceLinks
        .filter((sl) => sl.source_url === url || sl.source_domain === domain)
        .map((sl) => sl.competitor_domain);
      const uniqueCompetitors = [...new Set(matchedCompetitors)];
      return {
        competitors: uniqueCompetitors,
        competitorCount: uniqueCompetitors.length,
      };
    };

    // 5. Crawl each source_url
    let processed = 0;
    let success = 0;
    let failed = 0;
    let dbUpdatePromise = Promise.resolve();

    const queueDbUpdate = (patch: Partial<any>, logMsg?: string, logLevel: "info" | "warn" | "error" = "info") => {
      dbUpdatePromise = dbUpdatePromise.then(async () => {
        if (logMsg) {
          await repo.addLog(jobId, logMsg, logLevel);
        }
        await repo.updateJob(jobId, patch);
      }).catch(err => {
        console.error("Failed to update job status or add log:", err);
      });
    };

    const processUrl = async (url: string) => {
      // Check cancellation before starting
      const currentJob = await repo.getJob(jobId);
      if (currentJob?.status === "cancelled") {
        return;
      }

      processed++;
      const localProcessed = processed;

      queueDbUpdate({}, `[${localProcessed}/${totalSources}] Đang crawl và phân tích: ${url}`);

      let serperResult = serperResultCache.get(url);
      if (!serperResult) {
        serperResult = {
          url,
          title: getDomainFromUrl(url),
          snippet: "Backlink source",
          raw: {},
        };
      }

      try {
        const crawlResult = await crawler.crawl(serperResult);
        
        // Check cancellation again
        const jobStatus = await repo.getJob(jobId);
        if (jobStatus?.status === "cancelled") return;

        const compInfo = getCompetitorInfo(url);
        const candidate = getBacklinkCandidateFromRaw(crawlResult.raw_serper_data) || {
          is_candidate: false,
          status: "unlikely",
          score: 0,
          site_type: "Unknown",
          evidence: [],
          registration_urls: [],
          login_urls: [],
          submit_urls: [],
          profile_urls: [],
          note: "No candidate data extracted.",
        };

        const crawlTime = crawlResult.crawl_time;
        const crawlStatus = crawlResult.status;

        await repo.upsertOpportunity({
          project_id: project.id,
          job_id: jobId,
          source_url: url,
          source_domain: crawlResult.domain,
          title: crawlResult.title,
          cms_type: crawlResult.cms_type,
          site_type: candidate.site_type || "Unknown",
          score: candidate.score || 0,
          competitor_count: compInfo.competitorCount,
          competitors: compInfo.competitors,
          registration_urls: candidate.registration_urls || [],
          login_urls: candidate.login_urls || [],
          submit_urls: candidate.submit_urls || [],
          profile_urls: candidate.profile_urls || [],
          emails: crawlResult.emails.map((e) => ({ value: e.value, source: e.source })),
          phones: crawlResult.phones.map((p) => ({ value: p.value, source: p.source })),
          crawl_status: crawlStatus,
          error: crawlResult.error,
          crawl_time: crawlTime,
          html_snippet: crawlResult.html_snippet,
          raw_candidate: candidate as any,
          raw_crawl_data: crawlResult.raw_serper_data || {},
          last_crawled_at: new Date().toISOString(),
        });

        if (crawlStatus === "success") {
          success++;
          queueDbUpdate(
            { processed_sources: localProcessed, success_count: success, failed_count: failed },
            `Crawl thành công: ${url} (CMS: ${crawlResult.cms_type}, Site Type: ${candidate.site_type}, Score: ${candidate.score})`
          );
        } else {
          failed++;
          queueDbUpdate(
            { processed_sources: localProcessed, success_count: success, failed_count: failed },
            `Crawl không thành công hoặc cần review thủ công: ${url} - Error: ${crawlResult.error}`,
            "warn"
          );
        }
      } catch (err: any) {
        failed++;
        queueDbUpdate(
          { processed_sources: localProcessed, success_count: success, failed_count: failed },
          `Lỗi khi crawl ${url}: ${err.message}`,
          "error"
        );

        // Save opportunity as failed
        const compInfo = getCompetitorInfo(url);
        await repo.upsertOpportunity({
          project_id: project.id,
          job_id: jobId,
          source_url: url,
          source_domain: getDomainFromUrl(url),
          title: null,
          cms_type: "Unknown",
          site_type: "Unknown",
          score: 0,
          competitor_count: compInfo.competitorCount,
          competitors: compInfo.competitors,
          registration_urls: [],
          login_urls: [],
          submit_urls: [],
          profile_urls: [],
          emails: [],
          phones: [],
          crawl_status: "failed",
          error: err.message,
          crawl_time: 0,
          html_snippet: null,
          raw_candidate: {},
          raw_crawl_data: {},
          last_crawled_at: new Date().toISOString(),
        }).catch(() => {});
      }
    };

    const concurrency = 10;
    const urlQueue = [...uniqueUrls];
    
    const workers = Array(Math.min(concurrency, urlQueue.length))
      .fill(null)
      .map(async () => {
        while (urlQueue.length > 0) {
          const currentJob = await repo.getJob(jobId);
          if (currentJob?.status === "cancelled") {
            break;
          }
          const nextUrl = urlQueue.shift();
          if (nextUrl) {
            await processUrl(nextUrl);
          }
        }
      });

    await Promise.all(workers);
    await dbUpdatePromise;

    // Check cancellation one final time
    const finalJob = await repo.getJob(jobId);
    if (finalJob?.status === "cancelled") {
      await repo.addLog(jobId, "Tiến trình quét bị hủy bởi người dùng.", "warn");
      return;
    }

    // 6. Complete job
    await repo.updateJob(jobId, { status: "completed" });
    await repo.addLog(jobId, `🎉 Hoàn thành quét cơ hội backlink! Thành công: ${success}, Thất bại: ${failed}.`);

  } catch (err: any) {
    console.error("Runner error:", err);
    try {
      await repo.updateJob(jobId, { status: "failed", error: err.message });
      await repo.addLog(jobId, `❌ Tiến trình quét gặp lỗi hệ thống: ${err.message}`, "error");
    } catch {}
  } finally {
    // 7. Close Playwright crawler
    await crawler.close();
  }
}

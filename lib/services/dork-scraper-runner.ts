import { SerperDorkScraper } from "./serper-dork-scraper";
import { PlaywrightCrawlerService } from "./playwright-crawler";
import { DorkScraperRepository } from "../repositories/dork-scraper-repository";
import { getDomainFromUrl } from "../utils/domain";
import type { SerperResult } from "@/lib/types/crawler";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Map to hold running dork scraper tasks to prevent duplicate concurrent runs
const runningJobs = new Set<string>();

export async function runDorkScraperJob(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) {
    console.log(`Dork Scraper Job ${jobId} is already running.`);
    return;
  }
  
  runningJobs.add(jobId);
  const repo = new DorkScraperRepository();
  const searcher = new SerperDorkScraper();
  const crawler = new PlaywrightCrawlerService();

  console.log(`Starting Dork Scraper Job ${jobId}`);

  try {
    // 1. Fetch job & project
    const job = await repo.getJob(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found`);
      return;
    }

    if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
      console.log(`Job ${jobId} is already in state: ${job.status}`);
      return;
    }

    const project = await repo.getProject(job.project_id);
    if (!project) {
      await repo.updateJob(jobId, { status: "failed", error: "Không tìm thấy dự án tương ứng." });
      return;
    }

    // Set job to running
    await repo.updateJob(jobId, { status: "running" });

    // 2. Generate search queries by combining keywords and dorks
    const queries: string[] = [];
    for (const kw of project.keywords) {
      for (const dork of project.dorks) {
        // If keyword is present, prepend it, e.g. "crypto inurl:viewtopic.php"
        const cleanKw = kw.trim();
        const cleanDork = dork.trim();
        if (cleanKw) {
          queries.push(`${cleanKw} ${cleanDork}`);
        } else {
          queries.push(cleanDork);
        }
      }
    }

    if (queries.length === 0) {
      // If no keywords or dorks, just push the dorks directly if any
      if (project.dorks.length > 0) {
        queries.push(...project.dorks);
      }
    }

    if (queries.length === 0) {
      await repo.updateJob(jobId, { status: "failed", error: "Không có câu lệnh dork hoặc từ khóa chủ đề nào được thiết lập." });
      return;
    }

    // Determine max results from metadata (defaults to 100)
    const maxResults = 1000; // Deep search limit

    // 3. Search and gather unique URLs
    const uniqueUrls = new Set<string>();
    const uniqueSerperResults: SerperResult[] = [];

    for (const q of queries) {
      // Check cancellation
      const checkJob = await repo.getJob(jobId);
      if (checkJob?.status === "cancelled") {
        console.log("Job was cancelled by user.");
        return;
      }

      try {
        const results = await searcher.searchDorkDeep(q, maxResults, project.exclude_domains || []);
        for (const res of results) {
          if (!res.url) continue;
          
          if (!uniqueUrls.has(res.url)) {
            uniqueUrls.add(res.url);
            uniqueSerperResults.push(res);
          }
        }
      } catch (err: any) {
        console.error(`Error searching query: "${q}":`, err.message);
      }
    }

    const totalResults = uniqueSerperResults.length;
    await repo.updateJob(jobId, { total_results: totalResults });

    console.log(`Discovered ${totalResults} unique URLs from Google Dorking.`);

    if (totalResults === 0) {
      await repo.updateJob(jobId, { status: "completed" });
      return;
    }

    // 4. Crawl each domain to analyze its CMS type
    let processed = 0;
    let dbUpdatePromise = Promise.resolve();

    const queueDbUpdate = (patch: Partial<any>) => {
      dbUpdatePromise = dbUpdatePromise.then(async () => {
        await repo.updateJob(jobId, patch);
      }).catch(err => {
        console.error("Failed to update job status:", err);
      });
    };

    const processForum = async (res: SerperResult) => {
      const checkJob = await repo.getJob(jobId);
      if (checkJob?.status === "cancelled") {
        return;
      }

      processed++;
      const localProcessed = processed;
      const domain = getDomainFromUrl(res.url);
      console.log(`[${localProcessed}/${totalResults}] Crawling discovered forum: ${domain} (${res.url})...`);

      try {
        const crawlResult = await crawler.crawl(res);
        
        // Check cancellation again
        const jobStatus = await repo.getJob(jobId);
        if (jobStatus?.status === "cancelled") return;

        const publishDate = typeof res.raw["date"] === "string" ? res.raw["date"] : null;
        
        await repo.upsertDiscoveredForum({
          project_id: project.id,
          domain,
          source_url: res.url,
          title: crawlResult.title,
          cms_type: crawlResult.cms_type,
          score: crawlResult.cms_type !== "Unknown" ? 80 : 20,
          publish_date: publishDate,
        });
      } catch (err: any) {
        console.error(`Error crawling domain ${domain}:`, err.message);
        
        const jobStatus = await repo.getJob(jobId);
        if (jobStatus?.status === "cancelled") return;

        const publishDate = typeof res.raw["date"] === "string" ? res.raw["date"] : null;
        await repo.upsertDiscoveredForum({
          project_id: project.id,
          domain,
          source_url: res.url,
          title: null,
          cms_type: "Unknown",
          score: 10,
          publish_date: publishDate,
        }).catch(() => {});
      }

      queueDbUpdate({ processed_results: localProcessed });
    };

    const concurrency = 10;
    const forumQueue = [...uniqueSerperResults];
    
    const workers = Array(Math.min(concurrency, forumQueue.length))
      .fill(null)
      .map(async () => {
        while (forumQueue.length > 0) {
          const currentJob = await repo.getJob(jobId);
          if (currentJob?.status === "cancelled") {
            break;
          }
          const nextRes = forumQueue.shift();
          if (nextRes) {
            await processForum(nextRes);
          }
        }
      });

    await Promise.all(workers);
    await dbUpdatePromise;

    // 5. Complete job
    await repo.updateJob(jobId, { status: "completed" });
    console.log(`🎉 Job Dork Scraper ${jobId} finished successfully!`);

  } catch (err: any) {
    console.error(`Error executing job ${jobId}:`, err);
    await repo.updateJob(jobId, { status: "failed", error: err.message || "Lỗi hệ thống khi cào dork." });
  } finally {
    runningJobs.delete(jobId);
    await crawler.close();
  }
}

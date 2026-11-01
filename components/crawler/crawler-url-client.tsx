"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Copy, Download, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { cancelCrawlJobAction, startCrawlJobAction } from "@/app/crawler-url/actions";
import { Button, Input, Panel, Textarea } from "@/components/ui";
import type { CrawlJobRow, CrawlResultRow } from "@/lib/types/crawler";
import { buildCrawlerResultsQueryParams } from "@/lib/utils/crawler-url-view-state";
import { URL_DEPTH_OPTIONS, type UrlDepthFilter } from "@/lib/utils/forum-url-filter";
import { URL_PATTERN_OPTIONS, type UrlPatternFilter } from "@/lib/utils/url-pattern-filter";

const DEFAULT_DORKS = [
  'intitle:"forum" "register"',
  'inurl:register "forum"',
  '"powered by xenforo" "register"',
  '"powered by vBulletin" "register"',
  '"powered by phpBB" "register"',
].join("\n");

const DEFAULT_PAGES_PER_DORK = 20;
const PAGE_SIZE = 100;

function externalUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return errorToMessage(error.message);
  if (typeof error === "string") return error.trim();
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const parts: string[] = [record.message, record.error_description, record.details, record.hint, record.code]
      .map(errorToMessage)
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown object error";
    }
  }
  return "Unknown error";
}

function toggleFilterValue<T extends string>(current: T[], value: T) {
  if (value === "all") return [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function selectedFilterLabel<T extends string>(options: { value: T; label: string }[], selected: T[]) {
  if (selected.length === 0) return options[0]?.label ?? "Tat ca";
  if (selected.length === 1) return options.find((option) => option.value === selected[0])?.label ?? selected[0];
  return `Da chon ${selected.length}`;
}

function MultiFilter<T extends string>({
  options,
  selected,
  onToggle,
  title,
  className,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  title: string;
  className?: string;
}) {
  return (
    <details className={`group relative ${className ?? ""}`}>
      <summary
        title={title}
        className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-[#1f2b3a] bg-[#0d141d] px-3 text-sm text-white outline-none transition hover:bg-[#111b29] group-open:border-primary/70"
      >
        <span className="truncate">{selectedFilterLabel(options, selected)}</span>
        <span className="text-muted">⌄</span>
      </summary>
      <div className="absolute left-0 top-10 z-30 w-full rounded-md border border-border bg-[#0b111b] p-2 shadow-xl">
        {options.map((option) => {
          const checked = option.value === "all" ? selected.length === 0 : selected.includes(option.value);
          return (
            <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-white hover:bg-[#101823]">
              <input type="checkbox" checked={checked} onChange={() => onToggle(option.value)} />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

export function CrawlerUrlClient() {
  const [jobName, setJobName] = useState("");
  const [dorks, setDorks] = useState(DEFAULT_DORKS);
  const [maxUrls, setMaxUrls] = useState(50);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<CrawlJobRow | null>(null);
  const [rows, setRows] = useState<CrawlResultRow[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [urlDepth, setUrlDepth] = useState<UrlDepthFilter[]>([]);
  const [urlPattern, setUrlPattern] = useState<UrlPatternFilter[]>([]);
  const [resultJobId, setResultJobId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isCancelling, startCancelTransition] = useTransition();

  const isJobActive = job?.status === "running" || job?.status === "queued";
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const progress = useMemo(() => {
    if (!job || job.total_urls === 0) return 0;
    return Math.round((job.processed_urls / job.total_urls) * 100);
  }, [job]);

  function currentResultsParams(pageOverride = page, searchOverride = search) {
    return buildCrawlerResultsQueryParams(
      {
        search: searchOverride,
        urlDepth,
        urlPattern,
        cms: "All CMS",
        jobId: resultJobId,
        registerFilter: "all",
      },
      {
        page: pageOverride,
        pageSize: PAGE_SIZE,
      },
    );
  }

  async function loadResults(pageOverride = page, searchOverride = search) {
    const response = await fetch(`/api/crawler/results?${currentResultsParams(pageOverride, searchOverride).toString()}`);
    const data = (await response.json()) as { rows: CrawlResultRow[]; count: number; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Khong tai duoc ket qua.");
    setRows(data.rows);
    setCount(data.count);
    setSelected([]);
  }

  useEffect(() => {
    void loadResults().catch((err: unknown) => setError(errorToMessage(err)));
  }, [page, resultJobId, urlDepth, urlPattern]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      void loadResults(1, search).catch((err: unknown) => setError(errorToMessage(err)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!jobId) return;
    let notFoundCount = 0;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/crawler/jobs/${jobId}`);
        if (!response.ok) {
          if (response.status === 404) {
            notFoundCount += 1;
            if (notFoundCount >= 4) {
              window.clearInterval(timer);
              await loadResults();
            }
          }
          return;
        }
        notFoundCount = 0;
        const data = (await response.json()) as { job: CrawlJobRow };
        setJob(data.job);
        await loadResults();
        if (["completed", "failed", "cancelled"].includes(data.job.status)) window.clearInterval(timer);
      } catch {
        // network error, continue polling next tick
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [jobId, page, search, resultJobId, urlDepth, urlPattern]);

  function startJob() {
    setError(null);
    startTransition(async () => {
      const result = await startCrawlJobAction({
        dorks,
        pagesPerDork: DEFAULT_PAGES_PER_DORK,
        name: jobName,
        maxUrls,
        excludeDomains: "",
      });
      if (!result.ok) {
        setError(errorToMessage(result.error));
        return;
      }

      setJobId(result.jobId);
      setResultJobId(result.jobId);
      setPage(1);

      const response = await fetch(`/api/crawler/jobs/${result.jobId}`);
      const data = (await response.json()) as { job: CrawlJobRow };
      if (response.ok) {
        setJob(data.job);
      }
    });
  }

  function stopJob() {
    if (!jobId) return;
    setError(null);
    startCancelTransition(async () => {
      const result = await cancelCrawlJobAction(jobId);
      if (!result.ok) {
        setError(errorToMessage(result.error));
        return;
      }
      const response = await fetch(`/api/crawler/jobs/${jobId}`);
      const data = (await response.json()) as { job: CrawlJobRow };
      if (response.ok) {
        setJob(data.job);
      }
    });
  }

  async function deleteSelected() {
    if (selected.length === 0) return;
    const response = await fetch("/api/crawler/results", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selected }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(errorToMessage(data.error ?? "Khong xoa duoc ket qua."));
      return;
    }
    await loadResults();
  }

  async function copySelectedUrls() {
    const selectedSet = new Set(selected);
    const urls = rows.filter((row) => selectedSet.has(row.id)).map((row) => row.url);
    if (urls.length === 0) return;
    await navigator.clipboard.writeText(urls.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function downloadExport() {
    setError(null);
    setIsExporting(true);
    try {
      const response = await fetch(exportUrl);
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(errorToMessage(data?.error ?? "Khong tai duoc file XLSX."));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "urls-domains.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorToMessage(err));
    } finally {
      setIsExporting(false);
    }
  }

  const exportUrl = `/api/crawler/export?${buildCrawlerResultsQueryParams({
    search,
    urlDepth,
    urlPattern,
    cms: "All CMS",
    jobId: resultJobId,
    registerFilter: "all",
  }).toString()}`;

  function updateDepthFilter(value: UrlDepthFilter) {
    setUrlDepth((current) => toggleFilterValue(current, value));
    setPage(1);
  }

  function updatePatternFilter(value: UrlPatternFilter) {
    setUrlPattern((current) => toggleFilterValue(current, value));
    setPage(1);
  }

  return (
    <>
      <section>
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-semibold">Ten du an</label>
              <Input
                value={jobName}
                onChange={(event) => setJobName(event.target.value)}
                placeholder="VD: Forum crypto tuan nay"
                className="w-full"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">Max domain</label>
              <Input
                type="number"
                min={10}
                max={2000}
                value={maxUrls}
                onChange={(event) => setMaxUrls(Math.max(10, Math.min(2000, Number(event.target.value) || 500)))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-muted">Moi domain chi lay 1 URL dau tien tim thay.</p>
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Tu khoa Google / Dork</h3>
                <p className="mt-0.5 text-xs text-muted">
                  App chi tim 20 trang dau tren Google qua Serper trong 1 nam gan day, lay URL va domain, roi loai domain trung. Khong mo trang de doc CMS, email hay chi so.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setDorks(DEFAULT_DORKS)} title="Khoi phuc mac dinh">
                <RotateCcw size={16} /> Mac dinh
              </Button>
            </div>
            <Textarea
              value={dorks}
              onChange={(event) => setDorks(event.target.value.split(/\r?\n/).slice(0, 10).join("\n"))}
              className="mt-3 h-72 w-full"
              placeholder={'"forum" "register"\n"crypto forum" "sign up"'}
            />
            <div className="mt-3 flex justify-end">
              <Button onClick={startJob} disabled={isPending || isJobActive} className="min-w-44" title="Bat dau quet URL/domain">
                {isPending ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                Bat dau quet
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            {jobId && (!job || isJobActive) && (
              <Button variant="danger" onClick={stopJob} disabled={isCancelling} className="min-w-36">
                {isCancelling ? <RefreshCw size={16} className="animate-spin" /> : <Square size={16} />}
                Dung
              </Button>
            )}
            {job && (
              <div className="text-sm text-muted">
                {job.name ? <span className="font-medium text-white">{job.name}</span> : null}
                {job.name ? " · " : null}
                <span className={job.status === "running" ? "text-primary" : job.status === "cancelled" ? "text-amber-300" : undefined}>
                  {job.status}
                </span>
                {" · "}
                {job.processed_urls}/{job.total_urls} · {progress}%
              </div>
            )}
          </div>
          {error && <div className="mt-4 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</div>}
        </Panel>
      </section>

      <Panel className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Ket qua ({count})</h2>
            <p className="text-sm text-muted">Chi hien thi URL va domain. Moi domain chi giu mot dong.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MultiFilter
              options={URL_DEPTH_OPTIONS}
              selected={urlDepth}
              onToggle={updateDepthFilter}
              title="Loc theo do sau URL"
              className="min-w-[210px]"
            />
            <MultiFilter
              options={URL_PATTERN_OPTIONS}
              selected={urlPattern}
              onToggle={updatePatternFilter}
              title="Loc URL co chua mau"
              className="min-w-[240px]"
            />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tim URL / domain" className="w-64" />
            {resultJobId ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setResultJobId(null);
                  setPage(1);
                }}
                title="Dang loc theo job hien tai"
              >
                Job hien tai x
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={downloadExport} disabled={isExporting}>
              {isExporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
              XLSX
            </Button>
          </div>
        </div>

        <div className="mt-7 w-full overflow-x-auto rounded-md border border-border">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-[#101722] text-left text-muted">
              <tr>
                <th className="sticky left-0 z-10 w-10 bg-[#101722] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])}
                    />
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[#0b111b] text-red-300 transition hover:bg-[#111b29] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Xoa URL da chon"
                      disabled={selected.length === 0}
                      onClick={deleteSelected}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </th>
                <th className="min-w-[420px] whitespace-nowrap px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span>URL</span>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-[#0b111b] px-2 text-xs font-semibold text-white transition hover:bg-[#111b29] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Copy URL da chon"
                      disabled={selected.length === 0}
                      onClick={copySelectedUrls}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Da copy" : `Copy${selected.length > 0 ? ` (${selected.length})` : ""}`}
                    </button>
                  </div>
                </th>
                <th className="min-w-[220px] whitespace-nowrap px-3 py-3">Domain</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="h-20 text-center text-muted">
                    Chua co du lieu.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-panel px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td className="max-w-[620px] px-3 py-3">
                      <a
                        href={externalUrl(row.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-white underline-offset-2 hover:text-primary hover:underline"
                        title={row.url}
                      >
                        {row.url}
                      </a>
                      {row.title ? (
                        <div className="truncate text-xs text-muted" title={row.title}>
                          {row.title}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <span className="block truncate font-medium text-white" title={row.domain}>
                        {row.domain}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted">
          <Button variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
            Truoc
          </Button>
          <span>
            Trang {page}/{totalPages}
          </span>
          <Button variant="ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
            Sau
          </Button>
        </div>
      </Panel>
    </>
  );
}

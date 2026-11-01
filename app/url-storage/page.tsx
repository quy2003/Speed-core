"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Check, Copy, Download, Filter, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Panel, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "speed-core.url-storage";
const PAGE_SIZE = 250;

type UrlItem = {
  id: string;
  url: string;
  addedAt: string;
};

type MatchMode = "all" | "any";

function splitLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitTerms(input: string) {
  return input
    .split(/[\n,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeUrlKey(url: string) {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function getPathSegmentCount(urlStr: string): number {
  try {
    let formatted = urlStr.trim();
    if (!/^https?:\/\//i.test(formatted)) {
      formatted = "https://" + formatted;
    }
    const parsed = new URL(formatted);
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (!pathname) return 0;
    return pathname.split("/").filter(Boolean).length;
  } catch {
    let clean = urlStr.trim().replace(/^https?:\/\//i, "");
    const firstSlash = clean.indexOf("/");
    if (firstSlash === -1) return 0;
    const pathPart = clean.slice(firstSlash).split("?")[0].split("#")[0].replace(/^\/+|\/+$/g, "");
    if (!pathPart) return 0;
    return pathPart.split("/").filter(Boolean).length;
  }
}

function makeUrlItem(url: string): UrlItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url,
    addedAt: new Date().toISOString(),
  };
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function UrlStoragePage() {
  const [bulkUrls, setBulkUrls] = useState("");
  const [items, setItems] = useState<UrlItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [includeTerms, setIncludeTerms] = useState("");
  const [excludeTerms, setExcludeTerms] = useState("");
  const [matchMode, setMatchMode] = useState<MatchMode>("all");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDomainOnly, setShowDomainOnly] = useState(true);
  const [showOnePath, setShowOnePath] = useState(true);
  const [showMultiPath, setShowMultiPath] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setItems(stored ? (JSON.parse(stored) as UrlItem[]) : []);
    } catch {
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      setMessage("Trình duyệt không còn đủ dung lượng để lưu thêm URL.");
    }
  }, [items, loaded]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    caseSensitive,
    excludeTerms,
    includeTerms,
    items.length,
    matchMode,
    showDomainOnly,
    showOnePath,
    showMultiPath,
  ]);

  const filteredItems = useMemo(() => {
    const includes = splitTerms(includeTerms);
    const excludes = splitTerms(excludeTerms);
    const includeNeedles = caseSensitive ? includes : includes.map((term) => term.toLowerCase());
    const excludeNeedles = caseSensitive ? excludes : excludes.map((term) => term.toLowerCase());

    return items.filter((item) => {
      const haystack = caseSensitive ? item.url : item.url.toLowerCase();

      const includeOk =
        includeNeedles.length === 0 ||
        (matchMode === "all"
          ? includeNeedles.every((term) => haystack.includes(term))
          : includeNeedles.some((term) => haystack.includes(term)));
      const excludeOk = excludeNeedles.every((term) => !haystack.includes(term));

      if (!includeOk || !excludeOk) return false;

      const segments = getPathSegmentCount(item.url);
      if (segments === 0 && !showDomainOnly) return false;
      if (segments === 1 && !showOnePath) return false;
      if (segments >= 2 && !showMultiPath) return false;

      return true;
    });
  }, [
    caseSensitive,
    excludeTerms,
    includeTerms,
    items,
    matchMode,
    showDomainOnly,
    showOnePath,
    showMultiPath,
  ]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = filteredItems.filter((item) => selectedIdSet.has(item.id));
  const exportItems = selectedItems.length > 0 ? selectedItems : filteredItems;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filteredItems.slice(pageStart, pageStart + PAGE_SIZE);
  const pageIds = pageItems.map((item) => item.id);
  const selectedPageCount = pageIds.filter((id) => selectedIdSet.has(id)).length;
  const allPageSelected = pageItems.length > 0 && selectedPageCount === pageItems.length;

  function addUrls() {
    const urls = splitLines(bulkUrls);
    if (urls.length === 0) {
      setMessage("Chưa có URL nào để thêm.");
      return;
    }

    const seen = new Set(items.map((item) => normalizeUrlKey(item.url)));
    const newItems: UrlItem[] = [];
    let duplicateCount = 0;

    for (const url of urls) {
      const key = normalizeUrlKey(url);
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      newItems.push(makeUrlItem(url));
    }

    if (newItems.length > 0) {
      setItems((current) => [...newItems, ...current]);
      setBulkUrls("");
    }

    setMessage(`Đã thêm ${newItems.length} URL${duplicateCount > 0 ? `, bỏ qua ${duplicateCount} URL trùng.` : "."}`);
  }

  function deleteUrl(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
    setMessage("Đã xóa URL khỏi kho.");
  }

  function deleteSelectedUrls() {
    if (selectedIds.length === 0) return;
    const ids = new Set(selectedIds);
    setItems((current) => current.filter((item) => !ids.has(item.id)));
    setSelectedIds([]);
    setMessage(`Đã xóa ${ids.size} URL đã chọn khỏi kho.`);
  }

  function toggleUrlSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return [...next];
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      if (allPageSelected) return current.filter((id) => !pageIds.includes(id));
      const next = new Set(current);
      for (const id of pageIds) next.add(id);
      return [...next];
    });
  }

  function selectAllFiltered() {
    setSelectedIds(filteredItems.map((item) => item.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function clearFilters() {
    setIncludeTerms("");
    setExcludeTerms("");
    setMatchMode("all");
    setCaseSensitive(false);
    setShowDomainOnly(true);
    setShowOnePath(true);
    setShowMultiPath(true);
    setMessage("Đã xóa bộ lọc.");
  }

  async function copyFilteredUrls() {
    await navigator.clipboard.writeText(exportItems.map((item) => item.url).join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function exportFilteredUrls() {
    const rows = exportItems.map((item, index) => ({
      STT: index + 1,
      URL: item.url,
      "Ngày thêm": formatDate(item.addedAt),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 8 }, { wch: 90 }, { wch: 22 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "URL");
    XLSX.writeFile(workbook, `url-storage-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <AppShell title="Kho URL">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Kho lưu trữ URL</h1>
          <p className="mt-1 text-sm text-muted">Lưu danh sách URL và lọc nhanh theo ký tự hoặc chuỗi bạn cần tìm.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-3">
          <div className="rounded-md border border-border bg-panel px-3 py-2">
            <div className="text-lg font-semibold text-white">{items.length}</div>
            <div className="text-xs text-muted">Tổng URL</div>
          </div>
          <div className="rounded-md border border-border bg-panel px-3 py-2">
            <div className="text-lg font-semibold text-primary">{filteredItems.length}</div>
            <div className="text-xs text-muted">Đang khớp</div>
          </div>
          <div className="rounded-md border border-border bg-panel px-3 py-2">
            <div className="text-lg font-semibold text-white">{splitTerms(includeTerms).length}</div>
            <div className="text-xs text-muted">Điều kiện</div>
          </div>
        </div>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel>
            <h2 className="text-base font-semibold">Thêm URL</h2>
            <p className="mt-1 text-sm text-muted">Mỗi dòng một URL. Hệ thống tự bỏ qua URL bị trùng.</p>
            <Textarea
              aria-label="Danh sách URL"
              className="mt-5 h-48 w-full"
              placeholder={"https://example.com/forum/thread-1\nhttps://example.com/register\nhttps://domain.com/category/seo"}
              spellCheck={false}
              value={bulkUrls}
              onChange={(event) => {
                setBulkUrls(event.target.value);
                setMessage("");
              }}
            />
            <Button type="button" className="mt-3" onClick={addUrls}>
              <Plus size={16} />
              Thêm vào kho
            </Button>
            {message ? <p className="mt-3 text-sm text-primary">{message}</p> : null}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel>
            <div className="flex items-center gap-2">
              <Filter size={17} className="text-primary" />
              <h2 className="text-base font-semibold">Bộ lọc URL</h2>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <label htmlFor="include-terms" className="mb-1 block text-sm font-semibold">
                  URL phải chứa
                </label>
                <Textarea
                  id="include-terms"
                  className="h-24 w-full"
                  placeholder={"forum\nregister\n/viewtopic.php"}
                  spellCheck={false}
                  value={includeTerms}
                  onChange={(event) => setIncludeTerms(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted">Nhập mỗi dòng một chuỗi, hoặc phân tách bằng dấu phẩy.</p>
              </div>

              <div>
                <label htmlFor="exclude-terms" className="mb-1 block text-sm font-semibold">
                  Loại URL chứa
                </label>
                <Textarea
                  id="exclude-terms"
                  className="h-20 w-full"
                  placeholder={"login\n/wp-admin\nprivacy"}
                  spellCheck={false}
                  value={excludeTerms}
                  onChange={(event) => setExcludeTerms(event.target.value)}
                />
              </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-2">
                <div>
                  <label htmlFor="match-mode" className="mb-1 block text-sm font-semibold">
                    Cách khớp
                  </label>
                  <Select id="match-mode" className="w-full" value={matchMode} onChange={(event) => setMatchMode(event.target.value as MatchMode)}>
                    <option value="all">Chứa tất cả</option>
                    <option value="any">Chứa một trong các chuỗi</option>
                  </Select>
                </div>
                <label className="flex h-9 items-center gap-2 self-end rounded-md border border-border bg-[#0b111b] px-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#00d17d]"
                    checked={caseSensitive}
                    onChange={(event) => setCaseSensitive(event.target.checked)}
                  />
                  Phân biệt hoa thường
                </label>
              </div>

              <Button type="button" variant="ghost" onClick={clearFilters}>
                Xóa bộ lọc
              </Button>
            </div>
          </Panel>
        </div>

        <Panel className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Kết quả lọc</h2>
              <p className="mt-1 text-sm text-muted">
                Đang hiển thị {filteredItems.length} / {items.length} URL.
                {filteredItems.length > PAGE_SIZE ? ` Bảng đang xem ${pageItems.length} URL/trang.` : ""}
                {selectedItems.length > 0 ? ` Đã chọn ${selectedItems.length} URL để tải xuống.` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-border bg-[#0b111b] px-4 py-2 rounded-md">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#00d17d] rounded border-border"
                  checked={showDomainOnly}
                  onChange={(event) => setShowDomainOnly(event.target.checked)}
                />
                <span>Chỉ có domain</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#00d17d] rounded border-border"
                  checked={showOnePath}
                  onChange={(event) => setShowOnePath(event.target.checked)}
                />
                <span>Domain + 1 path</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 hover:text-white">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#00d17d] rounded border-border"
                  checked={showMultiPath}
                  onChange={(event) => setShowMultiPath(event.target.checked)}
                />
                <span>Còn lại có lớn hơn 2 path</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={selectAllFiltered} disabled={filteredItems.length === 0}>
                Chọn tất cả kết quả
              </Button>
              <Button type="button" variant="ghost" onClick={clearSelection} disabled={selectedItems.length === 0}>
                Bỏ chọn
              </Button>
              <Button type="button" variant="ghost" onClick={copyFilteredUrls} disabled={exportItems.length === 0}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Đã copy" : "Copy"}
              </Button>
              <Button type="button" variant="ghost" onClick={exportFilteredUrls} disabled={exportItems.length === 0}>
                <Download size={16} />
                Xuất Sheet
              </Button>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[36px_minmax(0,1fr)_132px_44px] border-b border-border px-2 py-3 text-sm font-semibold text-muted">
              <label className="flex items-center justify-center" title="Chọn tất cả URL trên trang này">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#00d17d]"
                  checked={allPageSelected}
                  onChange={toggleAllVisible}
                />
              </label>
              <div className="flex items-center gap-2">
                <span>URL</span>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-[#0b111b] px-2 text-xs font-semibold text-red-300 transition hover:bg-[#111b29] disabled:cursor-not-allowed disabled:opacity-45"
                  title="Xóa các URL đã chọn"
                  disabled={selectedItems.length === 0}
                  onClick={deleteSelectedUrls}
                >
                  <Trash2 size={13} />
                  Xóa đã chọn{selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
                </button>
              </div>
              <span>Ngày thêm</span>
              <span></span>
            </div>
            {filteredItems.length > 0 ? (
              <div className="max-h-[640px] divide-y divide-border overflow-auto">
                {pageItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-[36px_minmax(0,1fr)_132px_44px] items-center gap-2 px-2 py-3 text-sm">
                    <label className="flex items-center justify-center" title="Chọn URL này">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#00d17d]"
                        checked={selectedIdSet.has(item.id)}
                        onChange={() => toggleUrlSelection(item.id)}
                      />
                    </label>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium text-white hover:text-primary hover:underline"
                      title={item.url}
                    >
                      {item.url}
                    </a>
                    <span className="text-xs text-muted">{formatDate(item.addedAt)}</span>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[#0b111b]",
                        "text-red-300 transition hover:bg-[#111b29]",
                      )}
                      title="Xóa URL"
                      onClick={() => deleteUrl(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid h-32 place-items-center px-4 text-center text-sm text-muted">
                Chưa có URL nào khớp với bộ lọc hiện tại.
              </div>
            )}
          </div>
          {filteredItems.length > PAGE_SIZE ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span>
                Trang {safePage} / {pageCount} · Dòng {pageStart + 1}-{Math.min(pageStart + pageItems.length, filteredItems.length)} trên {filteredItems.length}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1}>
                  Trước
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={safePage === pageCount}>
                  Sau
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </AppShell>
  );
}

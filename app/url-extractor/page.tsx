"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Check, Copy, Download, ExternalLink, Filter, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Panel, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { getDomainFromUrl } from "@/lib/utils/domain";

type UrlItem = {
  id: string;
  url: string;
  domain: string;
};

function splitLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function UrlExtractorPage() {
  const [bulkUrls, setBulkUrls] = useState("");
  const [items, setItems] = useState<UrlItem[]>([]);
  const [message, setMessage] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Frequency filter state: "all" or exact number of occurrences (1 to 6)
  const [selectedFreq, setSelectedFreq] = useState<"all" | number>("all");

  function handleAddUrls(append: boolean) {
    const urls = splitLines(bulkUrls);
    if (urls.length === 0) {
      setMessage("Vui lòng nhập ít nhất một URL.");
      return;
    }

    const newItems: UrlItem[] = urls.map((url) => {
      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        url,
        domain: getDomainFromUrl(url),
      };
    });

    if (append) {
      setItems((current) => [...current, ...newItems]);
      setMessage(`Đã nạp thêm ${newItems.length} URL.`);
    } else {
      setItems(newItems);
      setMessage(`Đã nạp mới ${newItems.length} URL.`);
    }
    setBulkUrls("");
  }

  function deleteItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setMessage("Đã xóa URL.");
  }

  function clearAll() {
    setItems([]);
    setBulkUrls("");
    setSelectedFreq("all");
    setMessage("Đã xóa sạch danh sách.");
  }

  // Calculate domain occurrences in the whole loaded list
  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.domain) {
        counts[item.domain] = (counts[item.domain] || 0) + 1;
      }
    }
    return counts;
  }, [items]);

  // Filter items based on exact domain frequency selection
  const filteredItems = useMemo(() => {
    if (selectedFreq === "all") return items;
    return items.filter((item) => {
      if (!item.domain) return false;
      const count = domainCounts[item.domain] || 0;
      return count === selectedFreq;
    });
  }, [items, selectedFreq, domainCounts]);

  async function copyAllUrls() {
    if (filteredItems.length === 0) return;
    const text = filteredItems.map((item) => item.url).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1600);
  }

  async function copyAllDomains() {
    if (filteredItems.length === 0) return;
    const text = filteredItems.map((item) => item.domain).filter(Boolean).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedDomain(true);
    window.setTimeout(() => setCopiedDomain(false), 1600);
  }

  function exportToExcel() {
    if (filteredItems.length === 0) return;
    const rows = filteredItems.map((item, index) => ({
      STT: index + 1,
      URL: item.url,
      Domain: item.domain,
      "Tần suất xuất hiện": domainCounts[item.domain] || 0,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 8 }, { wch: 80 }, { wch: 40 }, { wch: 20 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "URL_Domain");
    XLSX.writeFile(workbook, `url-extracted-domains-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const freqOptions: ("all" | number)[] = ["all", 1, 2, 3, 4, 5, 6];

  return (
    <AppShell title="Nạp URL & Trích domain">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Nạp danh sách URL</h1>
          <p className="mt-1 text-sm text-muted">Nạp danh sách các đường dẫn (URL) để xem cột Domain tương ứng.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-md border border-border bg-panel px-4 py-2">
            <div className="text-xl font-semibold text-white">{items.length}</div>
            <div className="text-xs text-muted">Tổng số URL nạp</div>
          </div>
          <div className="rounded-md border border-border bg-panel px-4 py-2">
            <div className="text-xl font-semibold text-primary">
              {new Set(items.map((i) => i.domain).filter(Boolean)).size}
            </div>
            <div className="text-xs text-muted">Domain duy nhất</div>
          </div>
        </div>
      </div>

      <div className="mt-7 space-y-6">
        {/* Top Section: Full Width Input Box */}
        <Panel>
          <h2 className="text-base font-semibold">Nhập danh sách URL</h2>
          <p className="mt-1 text-xs text-muted">Dán danh sách liên kết của bạn vào ô dưới đây (mỗi liên kết một dòng).</p>
          <Textarea
            aria-label="Nhập danh sách URL"
            className="mt-4 h-48 w-full font-mono text-sm"
            placeholder={"https://example.com/chuyen-muc/tin-tuc-123\nhttps://sub.domain.com/category/product\nhttp://forum.site.org/index.php"}
            spellCheck={false}
            value={bulkUrls}
            onChange={(e) => {
              setBulkUrls(e.target.value);
              setMessage("");
            }}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" onClick={() => handleAddUrls(false)}>
              <Plus size={16} />
              Nạp mới (Xóa danh sách cũ)
            </Button>
            <Button type="button" variant="ghost" onClick={() => handleAddUrls(true)}>
              <Plus size={16} />
              Nạp thêm (Giữ danh sách cũ)
            </Button>
            {message && <span className="self-center text-sm text-primary">{message}</span>}
          </div>
        </Panel>

        {/* Middle Section: Frequency Selector Tabs */}
        <Panel className="py-4 px-6 bg-[#0b121f] border border-border">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Filter size={17} className="text-primary" />
              <span>Lọc số lần domain xuất hiện:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {freqOptions.map((opt) => {
                const isActive = selectedFreq === opt;
                const label = opt === "all" ? "Tất cả" : `${opt} lần`;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSelectedFreq(opt)}
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-semibold transition",
                      isActive
                        ? "bg-primary text-black font-bold"
                        : "border border-border bg-[#0d1420] text-slate-300 hover:bg-[#152033] hover:text-white"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* Bottom Section: Full Width Results list */}
        <Panel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Danh sách kết quả</h2>
              <p className="text-xs text-muted">
                {filteredItems.length > 0
                  ? `Đang hiển thị ${filteredItems.length} / ${items.length} URL.`
                  : "Chưa có URL nào khớp với điều kiện lọc."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={copyAllUrls}
                disabled={filteredItems.length === 0}
                className="h-8 text-xs px-2"
              >
                {copiedUrl ? <Check size={14} /> : <Copy size={14} />}
                {copiedUrl ? "Đã copy URL" : "Copy URL"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={copyAllDomains}
                disabled={filteredItems.length === 0}
                className="h-8 text-xs px-2"
              >
                {copiedDomain ? <Check size={14} /> : <Copy size={14} />}
                {copiedDomain ? "Đã copy Domain" : "Copy Domain"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={exportToExcel}
                disabled={filteredItems.length === 0}
                className="h-8 text-xs px-2"
              >
                <Download size={14} />
                Xuất Excel (Sheet)
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={clearAll}
                disabled={items.length === 0}
                className="h-8 text-xs px-2"
              >
                <Trash2 size={14} />
                Xóa toàn bộ
              </Button>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[60px_minmax(0,2fr)_minmax(0,1fr)_120px_60px] border-b border-border bg-[#0b111b] px-4 py-3 text-xs font-semibold text-muted">
              <span>STT</span>
              <span>URL gốc</span>
              <span>Tên miền (Domain)</span>
              <span className="text-center">Số lần xuất hiện</span>
              <span className="text-center">Hành động</span>
            </div>
            {filteredItems.length > 0 ? (
              <div className="max-h-[600px] divide-y divide-border overflow-auto font-mono text-sm">
                {filteredItems.map((item, idx) => {
                  const freq = domainCounts[item.domain] || 0;
                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-[60px_minmax(0,2fr)_minmax(0,1fr)_120px_60px] items-center gap-2 px-4 py-2.5 hover:bg-[#070c14]"
                    >
                      <span className="text-xs text-muted">{idx + 1}</span>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <a
                          href={item.url.startsWith("http") ? item.url : `https://${item.url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-white hover:text-primary hover:underline"
                          title={item.url}
                        >
                          {item.url}
                        </a>
                        <ExternalLink size={12} className="text-slate-500 shrink-0" />
                      </div>
                      <span className="truncate text-slate-300 font-semibold" title={item.domain}>
                        {item.domain || "—"}
                      </span>
                      <span className="text-center text-primary font-bold">
                        {freq}
                      </span>
                      <div className="flex justify-center">
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[#0b111b] text-red-300 transition hover:bg-[#111b29]"
                          title="Xóa dòng này"
                          onClick={() => deleteItem(item.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid h-32 place-items-center px-4 text-center text-sm text-muted">
                Không tìm thấy URL nào khớp với số lần xuất hiện đã chọn.
              </div>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

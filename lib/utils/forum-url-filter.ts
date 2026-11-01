export type UrlDepthFilter = "all" | "domain_only" | "domain_plus_one" | "deep";

export const URL_DEPTH_OPTIONS: { value: UrlDepthFilter; label: string }[] = [
  { value: "all", label: "Tat ca URL" },
  { value: "domain_only", label: "1. Trang chu domain" },
  { value: "domain_plus_one", label: "2. URL co 1 path" },
  { value: "deep", label: "3. URL con lai" },
];

export function getUrlPathSegments(url: string) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") return [];
    return pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

export function matchesUrlDepth(url: string, filter: UrlDepthFilter) {
  if (filter === "all") return true;

  const segments = getUrlPathSegments(url);
  if (filter === "domain_only") return segments.length === 0;
  if (filter === "domain_plus_one") return segments.length === 1;
  if (filter === "deep") return segments.length >= 2;
  return true;
}

export function parseUrlDepthFilter(value: string | null | undefined): UrlDepthFilter {
  if (value === "domain_only" || value === "domain_plus_one" || value === "deep") return value;
  return "all";
}

export function parseUrlDepthFilters(value: string | null | undefined): UrlDepthFilter[] {
  const filters = String(value ?? "")
    .split(",")
    .map((item) => parseUrlDepthFilter(item.trim()))
    .filter((item): item is Exclude<UrlDepthFilter, "all"> => item !== "all");
  return [...new Set(filters)];
}

export function matchesAnyUrlDepth(url: string, filters: UrlDepthFilter[]) {
  if (filters.length === 0 || filters.includes("all")) return true;
  return filters.some((filter) => matchesUrlDepth(url, filter));
}

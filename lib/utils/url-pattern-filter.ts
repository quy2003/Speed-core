export type UrlPatternFilter = "all" | "forum_path" | "viewforum" | "viewtopic";

export const URL_PATTERN_OPTIONS: { value: UrlPatternFilter; label: string }[] = [
  { value: "all", label: "Tat ca mau URL" },
  { value: "forum_path", label: "1. Chua /forum/" },
  { value: "viewforum", label: "2. Chua /viewforum.php?f=" },
  { value: "viewtopic", label: "3. Chua viewtopic.php?t=" },
];

export function parseUrlPatternFilter(value: string | null | undefined): UrlPatternFilter {
  if (value === "forum_path" || value === "viewforum" || value === "viewtopic") return value;
  return "all";
}

export function parseUrlPatternFilters(value: string | null | undefined): UrlPatternFilter[] {
  const filters = String(value ?? "")
    .split(",")
    .map((item) => parseUrlPatternFilter(item.trim()))
    .filter((item): item is Exclude<UrlPatternFilter, "all"> => item !== "all");
  return [...new Set(filters)];
}

export function matchesUrlPattern(url: string, filter: UrlPatternFilter) {
  if (filter === "all") return true;

  const lowerUrl = url.toLowerCase();
  if (filter === "forum_path") return lowerUrl.includes("/forum/");
  if (filter === "viewforum") return lowerUrl.includes("/viewforum.php?f=");
  if (filter === "viewtopic") return lowerUrl.includes("viewtopic.php?t=");
  return true;
}

export function matchesAnyUrlPattern(url: string, filters: UrlPatternFilter[]) {
  if (filters.length === 0 || filters.includes("all")) return true;
  return filters.some((filter) => matchesUrlPattern(url, filter));
}

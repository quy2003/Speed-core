export const DEFAULT_EXCLUDE_DOMAINS = [
  "google.com", "google.com.vn", "google.co.uk", "google.co.jp", "google.fr", "google.de", "google.it", "google.es", "google.ca", "google.com.au",
  "bing.com", "yahoo.com", "yandex.ru", "duckduckgo.com", "baidu.com", "yandex.com"
];

export function normalizeExcludeDomains(input: unknown): string[] {
  if (typeof input !== "string") return [];
  const seen = new Set<string>();

  return input
    .split(/[\r\n,;]+/)
    .map((line) =>
      line
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0],
    )
    .filter((domain) => {
      if (!domain || !domain.includes(".")) return false;
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    })
    .slice(0, 100);
}

export function isHostnameExcluded(hostname: string, excludeDomains: string[]) {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return excludeDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function isHomepageUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr.trim());
    const path = url.pathname.toLowerCase();
    return path === "" || path === "/" || path === "/index.html" || path === "/index.php" || path === "/index.htm";
  } catch {
    return false;
  }
}

export function isUrlExcluded(url: string, excludeDomains: string[]) {
  if (isHomepageUrl(url)) {
    return true;
  }
  const mergedExcludes = [...new Set([...DEFAULT_EXCLUDE_DOMAINS, ...excludeDomains])];
  try {
    const hostname = new URL(url).hostname;
    return isHostnameExcluded(hostname, mergedExcludes);
  } catch {
    return true;
  }
}

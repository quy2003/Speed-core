import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { CrawlerRepository } from "@/lib/repositories/crawler-repository";
import type { CrawlerRegisterFilter } from "@/lib/utils/crawler-url-view-state";
import { parseUrlDepthFilter } from "@/lib/utils/forum-url-filter";

function parseRegisterFilter(value: string | null): CrawlerRegisterFilter {
  if (value === "has_register" || value === "no_register") return value;
  return "all";
}

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const repo = new CrawlerRepository();
    const { rows } = await repo.listResults({
      page: 1,
      pageSize: 2000,
      search: searchParams.get("search") ?? "",
      cms: searchParams.get("cms") ?? "All CMS",
      urlDepth: parseUrlDepthFilter(searchParams.get("urlDepth")),
      urlPattern: searchParams.get("urlPattern") ?? "all",
      jobId: searchParams.get("jobId"),
      registerFilter: parseRegisterFilter(searchParams.get("registerFilter")),
    });

    const sheet = XLSX.utils.json_to_sheet(
      rows.map((row) => ({
        URL: row.url,
        Domain: row.domain,
        Title: row.title ?? "",
        "Created at": row.created_at,
      })),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "urls");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="urls-domains.xlsx"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

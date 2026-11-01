import { NextResponse } from "next/server";
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
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "10");

    const data = await repo.listResults({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
      search: searchParams.get("search") ?? "",
      cms: searchParams.get("cms") ?? "All CMS",
      urlDepth: parseUrlDepthFilter(searchParams.get("urlDepth")),
      urlPattern: searchParams.get("urlPattern") ?? "all",
      jobId: searchParams.get("jobId"),
      registerFilter: parseRegisterFilter(searchParams.get("registerFilter")),
    });

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ rows: [], count: 0, error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "No ids provided" }, { status: 400 });
    }

    const repo = new CrawlerRepository();
    await repo.deleteResults(ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

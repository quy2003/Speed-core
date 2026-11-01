import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next({ request });
}

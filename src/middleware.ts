import { NextResponse, type NextRequest } from "next/server";

// Cheap edge gate: bounce signed-out visitors to /login. Real session validation happens server-side.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("att_session");
  const { pathname, search } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname === "/forgot";
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|manifest.webmanifest|icon|robots.txt).*)"],
};

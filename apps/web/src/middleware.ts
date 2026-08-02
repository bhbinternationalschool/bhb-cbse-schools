import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/home", "/fees", "/students", "/attendance", "/library"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!needsAuth) return NextResponse.next();

  const session = request.cookies.get("bhb_demo_session")?.value;
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/home/:path*",
    "/fees/:path*",
    "/students/:path*",
    "/attendance/:path*",
    "/library/:path*",
  ],
};

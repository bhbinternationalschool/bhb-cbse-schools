import { NextResponse, type NextRequest } from "next/server";
import { verifySessionCookieEdge } from "@/lib/sessionCookieEdge";

const PROTECTED_PREFIXES = [
  "/home",
  "/masters",
  "/fees",
  "/students",
  "/staff",
  "/attendance",
  "/library",
  "/admissions",
  "/store",
  "/inventory",
  "/transport",
  "/accounts",
  "/trust",
  "/comms",
  "/payroll",
  "/exams",
  "/certificates",
  "/documents",
  "/reports",
  "/modules",
  "/vault",
  "/timetable",
  "/homework",
  "/ptm",
  "/student-leave",
  "/gallery",
  "/news",
  "/notices",
  "/purchase",
  "/rte",
  "/field",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!needsAuth) return NextResponse.next();

  const raw = request.cookies.get("bhb_demo_session")?.value;
  // Presence alone used to be enough to reach page shells — a cookie
  // edited in devtools (or just copy-pasted) would render before any
  // deeper RBAC check ran. Verify the HMAC here so a forged cookie is
  // rejected at the edge instead.
  const session = await verifySessionCookieEdge(raw);
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    const res = NextResponse.redirect(login);
    if (raw) res.cookies.delete("bhb_demo_session");
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/home/:path*",
    "/masters/:path*",
    "/fees/:path*",
    "/students/:path*",
    "/staff/:path*",
    "/attendance/:path*",
    "/library/:path*",
    "/admissions/:path*",
    "/store/:path*",
    "/inventory/:path*",
    "/transport/:path*",
    "/accounts/:path*",
    "/trust/:path*",
    "/comms/:path*",
    "/payroll/:path*",
    "/exams/:path*",
    "/certificates/:path*",
    "/documents/:path*",
    "/reports/:path*",
    "/modules/:path*",
    "/vault/:path*",
    "/timetable/:path*",
    "/homework/:path*",
    "/ptm/:path*",
    "/student-leave/:path*",
    "/gallery/:path*",
    "/news/:path*",
    "/notices/:path*",
    "/purchase/:path*",
    "/rte/:path*",
    "/field/:path*",
  ],
};

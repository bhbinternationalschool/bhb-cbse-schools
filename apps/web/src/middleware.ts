import { NextResponse, type NextRequest } from "next/server";

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
    "/masters/:path*",
    "/fees/:path*",
    "/students/:path*",
    "/staff/:path*",
    "/attendance/:path*",
    "/library/:path*",
    "/admissions/:path*",
    "/store/:path*",
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

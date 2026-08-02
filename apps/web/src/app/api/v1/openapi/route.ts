import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "BHB School ERP API",
    version: "1.0.0",
    description: "Versioned REST API for BHB International School ERP",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health": {
      get: { summary: "Integration health", tags: ["ops"] },
    },
    "/principal/snapshot": {
      get: { summary: "Principal cockpit KPIs", tags: ["principal"] },
    },
    "/fees/ledger/{studentId}": {
      get: { summary: "Student fee ledger (open dues)", tags: ["fees"] },
    },
    "/attendance/mark": {
      post: { summary: "Bulk mark section attendance", tags: ["attendance"] },
    },
    "/library/issue": {
      post: { summary: "Issue a library book", tags: ["library"] },
    },
    "/library/return": {
      post: { summary: "Return a library book", tags: ["library"] },
    },
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "bhb_demo_session" },
      bearerApiKey: { type: "http", scheme: "bearer", bearerFormat: "bhb_…" },
    },
  },
  security: [{ sessionCookie: [] }, { bearerApiKey: [] }],
} as const;

export async function GET() {
  return NextResponse.json(SPEC);
}

/**
 * The morning note on the books — draft only.
 *
 * Follows the house shape for AI routes: staff session plus the module
 * permission, the deterministic layer computes the findings, the model writes
 * the connecting prose, and the route saves nothing. The caller reports
 * accepted / edited / rejected against the returned generationId.
 *
 * Needs only `accounts:view`. Reading a summary of the books is a read, and an
 * auditor should be able to do it.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateLedgerBriefJson } from "@/lib/aiLlm.server";
import { ledgerCockpit } from "@/lib/ledger/controls.server";
import { TENANT } from "@/lib/types";
import type { LedgerBriefFacts, LedgerBriefLanguage } from "@/lib/ledgerBriefAi";

export const runtime = "nodejs";

function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}₹${(abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;

  let body: { asOf?: string; fyFrom?: string; language?: LedgerBriefLanguage };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const asOf = body.asOf || new Date().toISOString().slice(0, 10);
  const fyFrom = body.fyFrom || `${new Date(asOf).getUTCFullYear()}-04-01`;

  const cockpit = await ledgerCockpit({ asOf, fyFrom });
  if (!cockpit.ok) {
    return NextResponse.json({ ok: false, error: cockpit.error }, { status: 422 });
  }

  const facts: LedgerBriefFacts = {
    schoolName: TENANT.name,
    asOf,
    position: {
      cash: rupees(cockpit.cashPaise),
      bank: rupees(cockpit.bankPaise),
      payables: rupees(cockpit.payablesPaise),
      receivables: rupees(cockpit.receivablesPaise),
      surplusThisYear: rupees(cockpit.surplusThisYearPaise),
    },
    findings: cockpit.anomalies.map((a) => ({
      code: a.code,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
    })),
  };

  const gen = await generateLedgerBriefJson({
    facts,
    language: body.language === "hi" ? "hi" : "en",
  });

  // The findings go back either way. If the model is unavailable or its draft
  // was rejected, the reader still gets everything that was actually computed —
  // the prose is the optional part, not the substance.
  if (!gen.ok) {
    return NextResponse.json({
      ok: true,
      draft: null,
      aiError: gen.error,
      cockpit,
    });
  }

  return NextResponse.json({
    ok: true,
    draft: gen.draft,
    generationId: gen.generationId,
    engine: gen.engine,
    cockpit,
  });
}

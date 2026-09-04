import { NextResponse } from "next/server";
import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchHouseholdVouchersFromDb, fetchFeeVouchersFromDb } from "@/lib/feesNormalized.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { classLabelForStudent } from "@/lib/parentPortal";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { archiveToDrive } from "@/lib/driveArchive.server";
import { receiptArchiveFileName, receiptArchiveFolder } from "@/lib/driveArchive";
import { renderReceiptPdf } from "@/lib/receiptPdf.server";
import { resolveSchoolHeader } from "@/lib/receiptArchive.server";
import type { CollectionVoucher } from "@/lib/fees";

export const runtime = "nodejs";

/**
 * GET /api/v1/receipts/:voucherId/pdf — the receipt as a PDF.
 *
 * A parent gets their own household's receipts; staff with fees.view get
 * any. Served from the Drive archive when the sweep has been there, else
 * rendered now and archived on the way out, so the next request is a read.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ voucherId: string }> },
) {
  try {
    const ctx = await resolveApiAuth(request);
    const { voucherId } = await params;

    let voucher: CollectionVoucher | undefined;
    if (ctx.session.persona === "parent") {
      if (!ctx.session.householdId) throw new ApiError("forbidden", "Parent session required", 403);
      const { vouchers, ok } = await fetchHouseholdVouchersFromDb(ctx.session.householdId);
      if (!ok) throw new ApiError("server_error", "Receipts are unavailable right now", 503);
      voucher = vouchers.find((v) => v.id === voucherId);
    } else {
      assertPermission(ctx, "fees", "view");
      const { vouchers, ok } = await fetchFeeVouchersFromDb();
      if (!ok) throw new ApiError("server_error", "Receipts are unavailable right now", 503);
      voucher = vouchers.find((v) => v.id === voucherId);
    }
    if (!voucher) throw new ApiError("not_found", "Receipt not found", 404);
    const fileName = receiptArchiveFileName(voucher.receiptNo, !!voucher.voidedAt);
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=300",
    };

    const tctx = await getServerTenantContext();
    if (tctx) {
      const { data } = await tctx.sb
        .from("drive_archive")
        .select("drive_file_id")
        .eq("tenant_id", tctx.tenantId)
        .eq("kind", "receipt")
        .eq("ref", voucher.id)
        .neq("drive_file_id", "")
        .maybeSingle();
      const id = (data as { drive_file_id?: string } | null)?.drive_file_id;
      if (id) {
        const content = await getDriveFileContent(id);
        if (content.ok) return new Response(content.body, { headers });
        console.warn("[receipt-pdf] drive read failed, rendering instead", content.error);
      }
    }

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const masters = loadMasters();
    const hh = sis.households.find((h) => h.id === voucher!.householdId);
    const pdf = await renderReceiptPdf(voucher, {
      school: await resolveSchoolHeader(masters),
      guardianName: hh?.guardianName || "",
      householdCode: hh?.code || "",
      studentLabel: (id, fallback) => {
        const s = sis.students.find((x) => x.id === id);
        if (!s) return fallback || id;
        const cls = classLabelForStudent(s, masters);
        return cls ? `${s.fullName} · ${cls}` : s.fullName;
      },
    });
    void archiveToDrive({
      kind: "receipt",
      ref: voucher.id,
      folderPath: receiptArchiveFolder(voucher.academicYearCode, voucher.collectionDate),
      fileName,
      mimeType: "application/pdf",
      data: pdf,
    }).catch(() => null);
    return new NextResponse(new Uint8Array(pdf), { headers });
  } catch (e) {
    return apiErr(e);
  }
}

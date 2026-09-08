import { fetchFeeVouchersFromDb } from "@/lib/feesNormalized.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { classLabelForStudent } from "@/lib/parentPortal";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { receiptArchiveFileName } from "@/lib/driveArchive";
import { renderReceiptPdf } from "@/lib/receiptPdf.server";
import { resolveSchoolHeader } from "@/lib/receiptArchive.server";
import { verifyReceiptLinkToken } from "@/lib/receiptLinkToken.server";

export const runtime = "nodejs";

/**
 * GET /api/fees/receipt-pdf/:voucherId?exp=…&sig=… — the receipt PDF, for Meta.
 *
 * WhatsApp attaches a document by URL: Meta's own servers fetch the file and
 * put it above the template body. Meta cannot hold a session, so the ordinary
 * `/api/v1/receipts/:id/pdf` route is unreachable to it.
 *
 * This is the only unauthenticated way to a receipt, and it is narrow on
 * purpose: the link is signed against ONE voucher id and expires in fifteen
 * minutes. It is minted at the moment of sending and fetched seconds later.
 *
 * A wrong or stale signature gets 403 and nothing else — never a hint about
 * whether that receipt exists, because the response to a guessed id must not
 * tell the guesser they guessed well.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ voucherId: string }> },
) {
  const { voucherId } = await params;
  const url = new URL(request.url);
  const verdict = verifyReceiptLinkToken(
    voucherId,
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );
  if (!verdict.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { vouchers, ok } = await fetchFeeVouchersFromDb();
    if (!ok) return new Response("Receipts unavailable", { status: 503 });
    const voucher = vouchers.find((v) => v.id === voucherId);
    if (!voucher) return new Response("Forbidden", { status: 403 });

    const fileName = receiptArchiveFileName(voucher.receiptNo, !!voucher.voidedAt);
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      // The link dies with the token; nothing about it should be shared or
      // kept by a cache in between.
      "Cache-Control": "private, no-store",
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
      }
    }

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const masters = loadMasters();
    const hh = sis.households.find((h) => h.id === voucher.householdId);
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
    return new Response(new Uint8Array(pdf), { headers });
  } catch (e) {
    console.warn(
      "[receipt-pdf-public] render failed",
      e instanceof Error ? e.message : String(e),
    );
    return new Response("Receipt could not be rendered", { status: 500 });
  }
}

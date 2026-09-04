/**
 * The receipt sweep: every voucher in the database that has no PDF in
 * Drive yet gets one. Runs from Cloud Scheduler and from the office by
 * hand; idempotent through drive_archive, bounded per run so a cold start
 * on Cloud Run never times out on the backlog.
 */
import { fetchFeeVouchersFromDb } from "@/lib/feesNormalized.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { classLabelForStudent } from "@/lib/parentPortal";
import { archiveToDrive, archivedRefs } from "@/lib/driveArchive.server";
import { receiptArchiveFileName, receiptArchiveFolder } from "@/lib/driveArchive";
import {
  RECEIPT_CONTACT_EMAIL,
  renderReceiptPdf,
  schoolCrestPng,
  type ReceiptSchoolHeader,
} from "@/lib/receiptPdf.server";
import { schoolIdentity, schoolStatutoryLine } from "@/lib/schoolIdentity";
import { schoolWhatsAppContact } from "@/lib/schoolWhatsApp.server";
import { CONTACT } from "@/lib/publicOrgProfile";
import { TENANT } from "@/lib/types";

/**
 * The header every receipt in this run shares. Phone and UDISE come from
 * Masters → School profile when filled in there, else the tenant config;
 * the WhatsApp number is the one the bot answers on (asked of Meta, cached);
 * the email is the office mailbox by instruction, never the director's.
 */
export async function resolveSchoolHeader(masters: ReturnType<typeof loadMasters>): Promise<ReceiptSchoolHeader> {
  const p = schoolIdentity(masters);
  const real = (v: string | null | undefined) => (v ?? "").trim();
  const wa = await schoolWhatsAppContact().catch(() => null);
  const whatsapp = wa?.display || real(p.whatsapp) || real(TENANT.whatsappNumber) || CONTACT.phone || "";
  return {
    logoPng: schoolCrestPng(),
    phone: real(p.phone) || real(p.mobile) || real(TENANT.officePhone) || CONTACT.phone || "",
    whatsapp,
    email: RECEIPT_CONTACT_EMAIL,
    website: (real(p.website) || CONTACT.website).replace(/^https?:\/\//, ""),
    statutoryLine: schoolStatutoryLine(masters),
  };
}

export type ReceiptSweepResult = {
  ok: boolean;
  error?: string;
  total: number;
  alreadyArchived: number;
  archived: number;
  failed: number;
  remaining: number;
  failures: { receiptNo: string; error: string }[];
};

export async function archivePendingReceipts(opts: { limit?: number } = {}): Promise<ReceiptSweepResult> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const empty = { total: 0, alreadyArchived: 0, archived: 0, failed: 0, remaining: 0, failures: [] };

  const done = await archivedRefs("receipt");
  if (!done) return { ok: false, error: "Could not read the archive index", ...empty };

  const fetched = await fetchFeeVouchersFromDb();
  if (!fetched.ok) return { ok: false, error: "Could not read receipts", ...empty };

  // Oldest first, so the archive fills in the order the books were written.
  const pending = fetched.vouchers
    .filter((v) => !done.has(v.id))
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const batch = pending.slice(0, limit);

  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  const sis = loadSis();
  const masters = loadMasters();
  const studentById = new Map(sis.students.map((s) => [s.id, s]));
  const householdById = new Map(sis.households.map((h) => [h.id, h]));
  const school = await resolveSchoolHeader(masters);

  let archived = 0;
  const failures: { receiptNo: string; error: string }[] = [];
  for (const v of batch) {
    const hh = householdById.get(v.householdId);
    let pdf: Buffer;
    try {
      pdf = await renderReceiptPdf(v, {
        school,
        guardianName: hh?.guardianName || "",
        householdCode: hh?.code || "",
        studentLabel: (id, fallback) => {
          const s = studentById.get(id);
          if (!s) return fallback || id;
          const cls = classLabelForStudent(s, masters);
          return cls ? `${s.fullName} · ${cls}` : s.fullName;
        },
      });
    } catch (e) {
      failures.push({ receiptNo: v.receiptNo, error: e instanceof Error ? e.message : "render failed" });
      continue;
    }
    const r = await archiveToDrive({
      kind: "receipt",
      ref: v.id,
      folderPath: receiptArchiveFolder(v.academicYearCode, v.collectionDate),
      fileName: receiptArchiveFileName(v.receiptNo, !!v.voidedAt),
      mimeType: "application/pdf",
      data: pdf,
    });
    if (r.ok) archived++;
    else failures.push({ receiptNo: v.receiptNo, error: r.error });
  }

  return {
    ok: true,
    total: fetched.vouchers.length,
    alreadyArchived: fetched.vouchers.length - pending.length,
    archived,
    failed: failures.length,
    remaining: pending.length - batch.length,
    failures,
  };
}

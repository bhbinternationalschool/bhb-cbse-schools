import "server-only";

/**
 * UDISE+ documents over WhatsApp — the side that touches the world.
 *
 * A parent sends a photo of an Aadhaar card, birth certificate or address
 * proof. This module:
 *   1. downloads the media from Meta and reads it with Gemini vision;
 *   2. works out which child it belongs to (one child: obvious; several:
 *      the name on the document or in the caption decides — never a guess);
 *   3. files the image in the child's document vault (Drive + `docs` slot);
 *   4. applies the corrections the pure planner allowed, through the same
 *      revision-guarded push every other SIS write uses, with an audit row;
 *   5. thanks the parent in their language (inside the 24h window they just
 *      opened) and tells the office what arrived and what to change on the
 *      UDISE+ portal — WhatsApp text first, the approved template when the
 *      staff member's own window is shut, plus push and the ERP inbox.
 *
 * Failure is quiet towards the parent and loud towards the office: an
 * unreadable photo is still filed and flagged, never silently dropped.
 */

import { loadServerMasters } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import { diffForAudit } from "@/lib/auditRedaction";
import { documentProxyUrl } from "@/lib/documentsRouting";
import { uploadFileToDrive } from "@/lib/googleDrive.server";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { patchMirrorHousehold } from "@/lib/parentHousehold.server";
import { fetchServerBlob } from "@/lib/serverBlob";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis, normalizeStudent, type Household, type SisStudent, type StudentDocFile } from "@/lib/sis";
import { pushSisToDb, rowToStudent } from "@/lib/sisNormalized.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { updateHouseholdContactInDb, updateStudentDocsInDb } from "@/lib/sisProfile.server";
import { TENANT } from "@/lib/types";
import {
  DOC_TYPE_LABEL,
  UDISE_DOC_EXTRACT_PROMPT,
  UDISE_DOC_EXTRACT_SYSTEM,
  compareNames,
  parseUdiseDocExtract,
  planUdiseCorrections,
  renderOfficeAlert,
  renderParentAck,
  type UdiseCorrectionPlan,
  type UdiseDocExtract,
  matchPaymentToReceipts,
  renderPaymentProofAck,
  renderPaymentProofOfficeAlert,
  type ReceiptForMatch,
} from "@/lib/udiseDocIntakeAi";
import { buildWaTemplateBodyComponent, sendWaWithFailover, sendWhatsAppText } from "@/lib/waSend";
import { normalizeWaTemplatesState, resolveTemplateForSend, templateVariablePositions, type WaTemplatesState } from "@/lib/waTemplates";
import { sendPushToSubjects } from "@/lib/webPush.server";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/;

export type UdiseDocIntakeResult = {
  /** False when this was not a document we should have handled; the caller falls back to the normal bot. */
  handled: boolean;
  ok: boolean;
  reason?: string;
  studentIds: string[];
  applied: number;
  held: number;
};

function extensionFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function classLabel(s: SisStudent, masters: Awaited<ReturnType<typeof loadServerMasters>>): string {
  const c = (masters.classes ?? []).find((x) => x.id === s.classId)?.name ?? "—";
  const sec = (masters.sections ?? []).find((x) => x.id === s.sectionId)?.name ?? "";
  return sec ? `${c}-${sec}` : c;
}

/**
 * Which child the document is about. Returns [] when it cannot be decided —
 * the office is told, the parent is asked to add the child's name.
 * A parent's own Aadhaar belongs to every child of the family.
 */
export function resolveTargetChildren(input: { children: SisStudent[]; extract: UdiseDocExtract; caption: string }): SisStudent[] {
  const { children, extract, caption } = input;
  if (!children.length) return [];
  if (extract.person === "father" || extract.person === "mother") return children;
  if (children.length === 1) return children;
  const byName = (name: string) => children.filter((c) => compareNames(c.fullName, name) !== "different");
  if (extract.nameOnDoc) {
    const hit = byName(extract.nameOnDoc);
    if (hit.length === 1) return hit;
  }
  if (caption) {
    const hit = children.filter((c) => {
      const first = (c.fullName || "").split(/\s+/)[0]?.toLowerCase() ?? "";
      return first.length >= 3 && caption.toLowerCase().includes(first);
    });
    if (hit.length === 1) return hit;
  }
  return [];
}

/** The student as the database holds it right now — revision included, so the guarded push can refuse a stale write. */
async function freshStudent(studentId: string): Promise<SisStudent | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).eq("id", studentId).maybeSingle();
  if (error || !data) return null;
  return rowToStudent(data as Parameters<typeof rowToStudent>[0]);
}

function applyPlanToStudent(s: SisStudent, plan: UdiseCorrectionPlan): SisStudent {
  const patch: Partial<SisStudent> = {};
  for (const c of plan.changes) {
    if (!c.apply || c.target !== "student") continue;
    switch (c.field) {
      case "fullName":
        patch.fullName = c.after;
        break;
      case "dob":
        patch.dob = c.after;
        break;
      case "gender":
        patch.gender = c.after as SisStudent["gender"];
        break;
      case "fatherName":
        patch.fatherName = c.after;
        break;
      case "motherName":
        patch.motherName = c.after;
        break;
      case "aadhaarNumber":
        patch.aadhaarNumber = c.after;
        patch.aadhaarLast4 = c.after.slice(-4);
        // A card we have SEEN is "received"; only the UDISE+ portal makes it verified.
        if (s.aadhaarVerification !== "verified_udise" || s.aadhaarLast4 !== c.after.slice(-4)) patch.aadhaarVerification = "received";
        break;
      case "fatherAadhaarNumber":
        patch.fatherAadhaarNumber = c.after;
        patch.fatherAadhaarVerification = "received";
        break;
      case "motherAadhaarNumber":
        patch.motherAadhaarNumber = c.after;
        patch.motherAadhaarVerification = "received";
        break;
      default:
        break;
    }
  }
  return normalizeStudent({ ...s, ...patch });
}

/** Everyone who acts on a UDISE+ change: owner, principal, admin, office and accounts. */
export async function udiseOfficeStaff(): Promise<{ id: string; fullName: string; mobile: string }[]> {
  const masters = await loadServerMasters();
  const { loadServerRbac } = await import("@/lib/api/v1/auth");
  const { resolveSessionRoles } = await import("@/lib/rbac");
  const { staffSessionFor } = await import("@/lib/erpCommands.server");
  const rbac = await loadServerRbac();
  const want = new Set(["owner", "principal", "admin", "office", "accounts"]);
  const out: { id: string; fullName: string; mobile: string }[] = [];
  for (const staff of masters.staff ?? []) {
    if (staff.status !== "active") continue;
    const session = staffSessionFor(staff, masters);
    const roles = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (roles.some((r) => want.has(r))) out.push({ id: staff.id, fullName: staff.fullName, mobile: (staff.mobile || "").trim() });
  }
  return out;
}

/**
 * Tell the office. Text inside each staff member's own 24h window, the
 * `udise_doc_received` template outside it, a push either way, and one row
 * in the ERP inbox for the people who read neither.
 */
export async function alertOfficeOfUdiseDocument(input: {
  text: string;
  oneLine: string;
  variables: Record<string, string>;
  refId: string;
  href: string;
}): Promise<{ wa: number; pushed: number; notified: boolean }> {
  let wa = 0;
  let pushed = 0;
  let notified = false;
  let staff: Awaited<ReturnType<typeof udiseOfficeStaff>> = [];
  try {
    staff = await udiseOfficeStaff();
  } catch (e) {
    console.warn("[udise-intake] office roster failed", e);
  }

  try {
    const { state: rawReg } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const registry = normalizeWaTemplatesState(rawReg);
    const tpl = resolveTemplateForSend({ state: registry, familyKey: "udise_doc_received", language: "en" });
    for (const s of staff) {
      if (!s.mobile) continue;
      const r = await sendWaWithFailover({ primaryMobile: s.mobile, body: input.text, clientMessageId: `udise_doc_${input.refId}_${s.id}` });
      if (r.ok) {
        wa += 1;
        continue;
      }
      if (tpl.ok && /24h|window/i.test(r.error || "")) {
        const positions = templateVariablePositions(tpl.template, input.variables);
        const t = await sendWaWithFailover({
          primaryMobile: s.mobile,
          template: {
            name: tpl.template.metaName,
            language: tpl.template.metaLanguage || tpl.template.language,
            components: [buildWaTemplateBodyComponent(Object.keys(positions).sort((x, y) => Number(x) - Number(y)), positions)],
          },
          fromPhoneNumberId: tpl.sender?.phoneNumberId,
          clientMessageId: `udise_doc_${input.refId}_${s.id}_t`,
        });
        if (t.ok) wa += 1;
        else console.warn("[udise-intake] office template send failed", s.fullName, t.error);
      } else {
        console.warn("[udise-intake] office WA failed", s.fullName, r.error, tpl.ok ? "" : "(no approved udise_doc_received template)");
      }
    }
  } catch (e) {
    console.warn("[udise-intake] office WA failed", e);
  }

  try {
    if (staff.length) {
      const res = await sendPushToSubjects(
        "staff",
        staff.map((s) => s.id),
        { title: "UDISE+ document received", body: input.oneLine.slice(0, 160), url: input.href, data: { kind: "udise_doc", id: input.refId } },
      );
      pushed = res.sent;
    }
  } catch (e) {
    console.warn("[udise-intake] push failed", e);
  }

  try {
    // Read-append-write: pushNotificationsDeskToDb deletes rows absent from
    // the state it is given, so a one-item state would wipe the inbox.
    const { fetchNotificationsDeskFromDb, pushNotificationsDeskToDb } = await import("@/lib/notificationsNormalized.server");
    const read = await fetchNotificationsDeskFromDb();
    if (read.ok) {
      const already = read.bundle.items.some((n) => n.sourceId === input.refId);
      if (!already) {
        const item = {
          id: `nf_udise_${input.refId}`,
          title: "UDISE+ document received",
          body: input.text.slice(0, 280),
          kind: "system" as const,
          href: input.href,
          audience: "staff" as const,
          sourceId: input.refId,
          createdAt: new Date().toISOString(),
          readBy: [] as string[],
        };
        const w = await pushNotificationsDeskToDb({ version: 1 as const, items: [item, ...read.bundle.items].slice(0, 300) });
        notified = w.ok;
      } else notified = true;
    }
  } catch (e) {
    console.warn("[udise-intake] notification failed", e);
  }
  return { wa, pushed, notified };
}

/**
 * A photo or PDF from a KNOWN family. Returns `handled: false` only when the
 * message should go on to the ordinary bot (unsupported type, no vision
 * model) — once we have read the file, the parent hears from us here.
 */
/** Put a file in the child's Drive folder; returns the proxy-free Drive note or null. */
async function fileDocumentInDrive(input: { base64: string; mimeType: string; studentId: string; name: string }): Promise<string | null> {
  const ext = input.mimeType === "application/pdf" ? "pdf" : input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  const up = await uploadFileToDrive({
    folderPath: ["students", input.studentId],
    fileName: `${input.name}.${ext}`,
    mimeType: input.mimeType,
    data: Buffer.from(input.base64, "base64"),
  });
  if (!up.ok) {
    console.warn("[udise-intake] drive upload failed", up.error);
    return null;
  }
  return `Drive: students/${input.studentId}/${input.name}.${ext}`;
}

/**
 * This family's receipts, flattened for matching, and what they still owe.
 * Read-only; the fee book is never touched from here.
 */
async function householdReceiptsAndDues(householdId: string): Promise<{ receipts: ReceiptForMatch[]; openDuesPaise: number }> {
  try {
    const { ensureFeesHydratedServer } = await import("@/lib/feesPersistence.server");
    const { loadFees, computeHouseholdDues, openFeeDues } = await import("@/lib/fees");
    const { currentAcademicYearCode } = await import("@/lib/masters");
    await ensureFeesHydratedServer();
    const fees = loadFees();
    const masters = await loadServerMasters();
    const ay = currentAcademicYearCode(masters);
    const receipts: ReceiptForMatch[] = (fees.vouchers ?? [])
      .filter((v) => v.householdId === householdId && !v.voidedAt)
      .map((v) => ({
        receiptNo: v.receiptNo,
        collectionDate: v.collectionDate,
        totalPaise: v.totalPaise,
        refs: [
          ...(v.tenders ?? []).map((t) => t.ref).filter(Boolean),
          v.transactionId,
          v.receiptNo,
          v.schoolReceiptNo,
        ].filter(Boolean) as string[],
      }));
    const dues = openFeeDues(
      computeHouseholdDues(householdId, loadSis(), masters, fees, { includeFuture: false, academicYearCode: ay }).flatMap((r) => r.dues),
    ).filter((d) => d.balancePaise > 0);
    return { receipts, openDuesPaise: dues.reduce((s, d) => s + d.balancePaise, 0) };
  } catch (e) {
    console.warn("[udise-intake] fee lookup failed", e);
    return { receipts: [], openDuesPaise: 0 };
  }
}

export async function captureUdiseDocumentFromWhatsApp(input: {
  mediaId: string;
  mimeType?: string;
  fileName?: string;
  caption: string;
  mobile10: string;
  household: Household;
  waMessageId?: string;
}): Promise<UdiseDocIntakeResult> {
  const none: UdiseDocIntakeResult = { handled: false, ok: false, studentIds: [], applied: 0, held: 0 };
  const hinted = (input.mimeType || "").toLowerCase();
  if (hinted && !ALLOWED.test(hinted)) return { ...none, reason: "unsupported_type" };

  const { geminiConfigured, generateGeminiVisionJson } = await import("@/lib/erpAiGemini.server");
  if (!geminiConfigured()) return { ...none, reason: "no_vision" };

  const { fetchWaMediaAsDataUrl } = await import("@/lib/waInboundMedia.server");
  const media = await fetchWaMediaAsDataUrl(input.mediaId);
  if (!media.ok) return { ...none, reason: media.error };
  const m = media.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) return { ...none, reason: "bad_media" };
  const mimeType = m[1]!.toLowerCase();
  const base64 = m[2]!;
  if (!ALLOWED.test(mimeType)) return { ...none, reason: "unsupported_type" };
  if (Math.floor((base64.length * 3) / 4) > MAX_BYTES) return { ...none, reason: "too_large" };

  await ensureSisHydratedServer();
  const masters = await loadServerMasters();
  const hh = input.household;
  const language = waTemplateLanguageFor(hh);
  const children = loadSis().students.filter((s) => s.householdId === hh.id && s.status === "active");
  const refId = `${input.waMessageId || input.mediaId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(-40) || String(Date.now());

  let extract: UdiseDocExtract | null = null;
  try {
    const r = await generateGeminiVisionJson({ system: UDISE_DOC_EXTRACT_SYSTEM, prompt: UDISE_DOC_EXTRACT_PROMPT, base64, mimeType, maxTokens: 700 });
    if (r.ok) extract = parseUdiseDocExtract(r.text);
  } catch (e) {
    console.warn("[udise-intake] vision failed", e);
  }
  if (!extract) {
    extract = { docType: "other", person: "unknown", nameOnDoc: "", dob: "", aadhaarNumber: "", gender: "", fatherName: "", motherName: "", address: "", pincode: "", payment: null, missing: ["all"], notes: "The document could not be read." };
  }

  const targets = resolveTargetChildren({ children, extract, caption: input.caption || "" });
  const label = DOC_TYPE_LABEL[extract.docType];

  // ── A payment the parent is showing us ──
  //
  // Handled before the which-child question, because money is paid by a
  // HOUSEHOLD: a UPI screenshot says nothing about which sibling it is for,
  // and asking would be a silly reply to "I have already paid". Nothing is
  // ever posted to the fee book from a photograph — the office is told
  // where to look and a person decides.
  if (extract.docType === "payment_proof" && extract.payment) {
    const first = targets[0] ?? children[0];
    const fileUrl = await fileDocumentInDrive({
      base64,
      mimeType,
      studentId: first?.id || hh.id,
      name: `payment-proof-${new Date().toISOString().slice(0, 10)}`,
    });
    const { receipts, openDuesPaise } = await householdReceiptsAndDues(hh.id);
    const match = matchPaymentToReceipts({
      amountPaise: extract.payment.amountPaise,
      dateIso: extract.payment.dateIso,
      reference: extract.payment.reference,
      receipts,
    });
    const childName = first?.fullName || hh.guardianName || "your child";
    await sendWhatsAppText({
      toMobile: input.mobile10,
      body: renderPaymentProofAck({ payment: extract.payment, match, childName, language }),
      clientMessageId: `udise_ack_${refId}`,
    }).catch((e) => console.warn("[udise-intake] payment ack failed", e));

    const alert = renderPaymentProofOfficeAlert({
      payment: extract.payment,
      match,
      childName,
      classLabel: first ? classLabel(first, masters) : "—",
      guardianName: hh.guardianName,
      openDuesPaise,
      fileUrl,
    });
    await alertOfficeOfUdiseDocument({
      text: alert.text,
      oneLine: alert.oneLine,
      variables: {
        docLabel: "Payment proof",
        childName,
        classLabel: first ? classLabel(first, masters) : "—",
        changes: alert.oneLine.slice(0, 900),
        guardianName: hh.guardianName || "Parent",
        schoolName: TENANT.nameDisplay,
      },
      refId,
      href: "/fees?tab=receipts",
    });
    return { handled: true, ok: true, studentIds: first ? [first.id] : [], applied: 0, held: 0 };
  }

  if (!targets.length) {
    // Several children and no way to tell whose. Nothing is written; the
    // office gets the file's description, the parent is asked to say which
    // child. Better one more message than a certificate on the wrong child.
    const names = children.map((c) => c.fullName.split(/\s+/)[0]).filter(Boolean).join(" / ");
    const ask =
      language === "hi"
        ? `📄 ${label} मिला, धन्यवाद 🙏\n\nयह किस बच्चे का है? कृपया फ़ोटो दोबारा भेजें और साथ में बच्चे का नाम लिखें (${names}).`
        : `📄 ${label} received, thank you 🙏\n\nWhich child is this for? Please send the photo again with the child's name in the message (${names}).`;
    await sendWhatsAppText({ toMobile: input.mobile10, body: ask, clientMessageId: `udise_ack_${refId}` }).catch(() => null);
    await alertOfficeOfUdiseDocument({
      text: `📄 *${label} received* from ${hh.guardianName || "a parent"} (${hh.code || hh.id}) — could not tell which child (${names}). Name on document: "${extract.nameOnDoc || "—"}". Parent asked to resend with the child's name. Nothing written.`,
      oneLine: `${label} from ${hh.guardianName || "a parent"}: child not identified`,
      variables: { docLabel: label, childName: names || "—", classLabel: "—", changes: "Child not identified; parent asked to resend with the name", guardianName: hh.guardianName || "Parent", schoolName: TENANT.nameDisplay },
      refId,
      href: "/students?tab=udise",
    });
    return { handled: true, ok: false, reason: "child_ambiguous", studentIds: [], applied: 0, held: 0 };
  }

  let applied = 0;
  let held = 0;
  const officeTexts: string[] = [];
  const portalAll: string[] = [];
  let householdUpdated: Household | null = null;
  const updatedStudents: SisStudent[] = [];
  let firstPlan: UdiseCorrectionPlan | null = null;
  let firstChild = targets[0]!;

  for (const [idx, target] of targets.entries()) {
    const current = (await freshStudent(target.id)) ?? target;
    const plan = planUdiseCorrections({
      extract,
      student: {
        id: current.id,
        fullName: current.fullName,
        dob: current.dob,
        gender: current.gender,
        aadhaarNumber: current.aadhaarNumber,
        aadhaarLast4: current.aadhaarLast4,
        fatherName: current.fatherName,
        motherName: current.motherName,
        fatherAadhaarNumber: current.fatherAadhaarNumber,
        motherAadhaarNumber: current.motherAadhaarNumber,
      },
      // The address is written once, on the household, from the first pass.
      household: idx === 0 ? { address: hh.address, pincode: hh.pincode } : null,
    });
    if (idx === 0) {
      firstPlan = plan;
      firstChild = current;
    }

    // 1. File the document. A parent's Aadhaar has no vault slot of its own;
    //    it is kept under the first child's folder and named for the parent.
    let fileUrl: string | null = null;
    const slot = plan.person === "child" ? plan.docKey : null;
    if (idx === 0 || slot) {
      const stamp = new Date().toISOString().slice(0, 10);
      const who = plan.person === "father" ? "father-aadhaar" : plan.person === "mother" ? "mother-aadhaar" : slot || "document";
      const fileName = `${who}-${stamp}.${extensionFor(mimeType)}`;
      const data = Buffer.from(base64, "base64");
      const up = await uploadFileToDrive({ folderPath: ["students", current.id], fileName, mimeType, data });
      if (!up.ok) {
        console.warn("[udise-intake] drive upload failed", up.error);
        officeTexts.push(`⚠️ The file could not be stored in Drive (${up.error}); it is still in WhatsApp → Inbox → Media.`);
      } else if (slot) {
        const prev = current.docs[slot];
        const entry: StudentDocFile = {
          ...prev,
          status: prev.status === "verified" ? "verified" : "received",
          fileName,
          mimeType,
          size: data.length,
          fileUrl: documentProxyUrl("student", current.id, slot),
          driveFileId: up.driveFileId,
          uploadedAt: new Date().toISOString(),
          submittedBy: hh.guardianName || "Parent (WhatsApp)",
          submittedAt: new Date().toISOString(),
        };
        const docs = { ...current.docs, [slot]: entry };
        const saved = await updateStudentDocsInDb(current.id, docs);
        if (saved.ok) {
          current.docs = docs;
          fileUrl = entry.fileUrl;
        } else officeTexts.push(`⚠️ Vault entry not saved (${saved.error}); the file is in Drive.`);
      } else officeTexts.push(`📁 Filed in Drive under students/${current.id} as ${fileName}.`);
    }

    // 2. Corrections on the student, through the guarded push.
    const studentChanges = plan.changes.filter((c) => c.apply && c.target === "student");
    if (studentChanges.length) {
      const before = current;
      const after = applyPlanToStudent(current, plan);
      const push = await pushSisToDb({ households: [], students: [after] });
      if (push.ok && push.studentCount >= 1) {
        applied += studentChanges.length;
        updatedStudents.push({ ...after, revisionAt: push.studentVersions?.[after.id] ?? after.revisionAt });
        const d = diffForAudit(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
        void writeAudit({
          module: "sis",
          action: "edit",
          entityType: "student",
          entityId: after.id,
          summary: `${label} from parent on WhatsApp: ${d.changedFields.join(", ")}`,
          before: d.before,
          after: d.after,
        }).catch(() => null);
      } else {
        for (const c of studentChanges) c.apply = false;
        plan.flags.push(`The record changed while this was being read (${push.ok ? "no row" : push.error || "push refused"}); corrections are listed for the office, none written.`);
      }
    }

    // 3. Address on the household, once.
    const hhChanges = plan.changes.filter((c) => c.apply && c.target === "household");
    if (hhChanges.length && idx === 0) {
      const next: Household = { ...hh };
      for (const c of hhChanges) {
        if (c.field === "address") next.address = c.after;
        if (c.field === "pincode") next.pincode = c.after;
      }
      const w = await updateHouseholdContactInDb(hh.id, {
        guardianName: next.guardianName,
        altMobile: next.altMobile,
        email: next.email,
        address: next.address,
        locality: next.locality,
        landmark: next.landmark,
        city: next.city,
        state: next.state,
        pincode: next.pincode,
      });
      if (w.ok) {
        applied += hhChanges.length;
        householdUpdated = { ...next, revisionAt: w.updatedAt };
        void writeAudit({ module: "sis", action: "edit", entityType: "household", entityId: hh.id, summary: `${label} from parent on WhatsApp: address`, before: { address: hh.address, pincode: hh.pincode }, after: { address: next.address, pincode: next.pincode } }).catch(() => null);
      } else {
        for (const c of hhChanges) c.apply = false;
        plan.flags.push(`Address not saved (${w.error}).`);
      }
    }

    held += plan.changes.filter((c) => !c.apply).length;
    const alert = renderOfficeAlert({ plan, childName: current.fullName, classLabel: classLabel(current, masters), guardianName: hh.guardianName, fileUrl });
    officeTexts.unshift(alert.text);
    portalAll.push(...alert.portalChanges);
  }

  if (householdUpdated || updatedStudents.length) patchMirrorHousehold(householdUpdated ?? hh, updatedStudents);

  // 4. The parent, in their language, inside the window they just opened.
  const ack = renderParentAck({ plan: firstPlan!, childName: targets.length > 1 && (firstPlan!.person === "father" || firstPlan!.person === "mother") ? targets.map((t) => t.fullName.split(/\s+/)[0]).join(", ") : firstChild.fullName, language });
  await sendWhatsAppText({ toMobile: input.mobile10, body: ack, clientMessageId: `udise_ack_${refId}` }).catch((e) => console.warn("[udise-intake] parent ack failed", e));

  // 5. The office.
  const summary = `${label} for ${targets.map((t) => t.fullName).join(", ")}: ${applied} field${applied === 1 ? "" : "s"} updated${held ? `, ${held} for review` : ""}`;
  const changesLine = portalAll.length ? portalAll.join("; ").slice(0, 900) : held ? "Nothing written; see the review list in the ERP" : "Nothing to change on the portal";
  await alertOfficeOfUdiseDocument({
    text: officeTexts.join("\n\n"),
    oneLine: summary,
    variables: { docLabel: label, childName: firstChild.fullName, classLabel: classLabel(firstChild, masters), changes: changesLine, guardianName: hh.guardianName || "Parent", schoolName: TENANT.nameDisplay },
    refId,
    href: `/students?tab=udise&student=${encodeURIComponent(firstChild.id)}`,
  });

  return { handled: true, ok: true, studentIds: targets.map((t) => t.id), applied, held };
}

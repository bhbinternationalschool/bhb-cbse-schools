/**
 * Which staff signature goes on which signing line of a printed document
 * (director, 15 Oct 2026 — follow-up to PR #677, which let teachers and the
 * principal put their signature on their staff-app profile).
 *
 * The rules, decided here so the print route, the parent results API and
 * every printed sheet agree:
 *
 *   - a line that says Principal gets THE principal's signature — the one
 *     active member of staff holding a Principal designation (never a Vice
 *     Principal). Two such people, or none, and the line stays blank. When
 *     the document names who signed as principal (a certificate's
 *     "Issued by"), that name must be the principal's, or the line stays
 *     blank: an old certificate is never signed by a later principal;
 *   - a line that says Class teacher gets the class teacher of THAT section
 *     and year (the primary one; two primaries or two unranked teachers and
 *     it stays blank). Where the document names the class teacher (a
 *     certificate), the signature is that named person's;
 *   - a line where a named person signs (a TC's "Checked by") gets that
 *     person's signature — when exactly one active member of staff has the
 *     name;
 *   - any other line (Examination in-charge, Parent, Authorised signatory)
 *     stays blank. A missing signature is a blank line, never someone
 *     else's.
 *
 * Pure: no I/O (printSignatures.selftest.ts). Images are loaded on the
 * server (printSignatures.server.ts) and embedded as data URLs, so a print
 * or a PDF never has to fetch a private file, and a parent's copy never
 * holds a link into the staff file store.
 */

import type { Designation, StaffRecord } from "@/lib/foundationMasters";

export type SignatoryRole = "principal" | "class_teacher" | "none";

/** One signature ready to print: whose, and the image (a data: URL). */
export type PrintSignature = { staffId: string; name: string; src: string };

/** The signatures a document can carry; null = leave that line blank. */
export type PrintSignatureSet = {
  principal: PrintSignature | null;
  classTeacher: PrintSignature | null;
  checkedBy: PrintSignature | null;
};

export const NO_SIGNATURES: PrintSignatureSet = { principal: null, classTeacher: null, checkedBy: null };

/** Which documents may ask, and the module whose view grant they need. */
export const PRINT_SIGNATURE_DOCS = {
  certificate: "certificates",
  report_card: "exams",
  result_sheet: "exams",
  admit_card: "exams",
} as const;

export type PrintSignatureDoc = keyof typeof PRINT_SIGNATURE_DOCS;

export function isPrintSignatureDoc(v: string): v is PrintSignatureDoc {
  return Object.prototype.hasOwnProperty.call(PRINT_SIGNATURE_DOCS, v);
}

/**
 * Who signs a line, from what the line says. "Principal", "Signature of
 * Principal", "Principal / authorised" → principal; "Vice principal" →
 * nobody; "Class teacher", "Signature of Class Teacher" → class teacher.
 */
export function signatoryRoleForLabel(label: string): SignatoryRole {
  const t = (label || "").toLowerCase().replace(/[^a-zऀ-ॿ]+/g, " ").trim();
  if (!t) return "none";
  if (/\bvice\b/.test(t) || /\bdeputy\b/.test(t)) return "none";
  if (/\bclass teacher\b/.test(t) || /\bclass incharge\b/.test(t) || /\bclass in charge\b/.test(t)) return "class_teacher";
  if (/\bprincipal\b/.test(t) || t.includes("प्रधानाचार्य")) return "principal";
  return "none";
}

/** The signature a labelled line prints, or null (blank line). */
export function signatureForLabel(label: string, set: PrintSignatureSet | null | undefined): PrintSignature | null {
  if (!set) return null;
  const role = signatoryRoleForLabel(label);
  if (role === "principal") return set.principal;
  if (role === "class_teacher") return set.classTeacher;
  return null;
}

/* ── who ─────────────────────────────────────────────────────────────── */

type Book = {
  staff?: StaffRecord[] | null;
  designations?: Pick<Designation, "id" | "code" | "name" | "isActive">[] | null;
};

export function sameName(a: string, b: string): boolean {
  const n = (s: string) => (s || "").normalize("NFKC").toLowerCase().replace(/[.\s]+/g, " ").trim();
  return !!n(a) && n(a) === n(b);
}

function active(book: Book): StaffRecord[] {
  return (book.staff ?? []).filter((s) => s && s.status === "active");
}

function isPrincipalDesignation(d: Pick<Designation, "code" | "name">): boolean {
  const name = (d.name || "").toLowerCase();
  const code = (d.code || "").toUpperCase();
  if (/vice|deputy|\bvp\b/.test(name) || /^VP/.test(code)) return false;
  return /principal/.test(name) || /^PRIN/.test(code);
}

/** The one active principal, or null when there are none or several. */
export function strictPrincipal(book: Book): StaffRecord | null {
  const ids = new Set((book.designations ?? []).filter((d) => d && d.isActive !== false && isPrincipalDesignation(d)).map((d) => d.id));
  if (ids.size === 0) return null;
  const hits = active(book).filter((s) => !!s.designationId && ids.has(s.designationId));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * The class teacher of one section for one year: the single primary link,
 * else the single link. Ambiguous → null.
 */
export function strictClassTeacher(book: Book, classId: string, sectionId: string, academicYearCode: string): StaffRecord | null {
  if (!classId || !sectionId) return null;
  const hits: { s: StaffRecord; primary: boolean }[] = [];
  for (const s of active(book)) {
    const link = (s.classTeacherLinks ?? []).find(
      (l) => l.classId === classId && l.sectionId === sectionId && (!l.academicYearCode || !academicYearCode || l.academicYearCode === academicYearCode),
    );
    if (link) hits.push({ s, primary: !!link.isPrimary });
  }
  const primaries = hits.filter((h) => h.primary);
  if (primaries.length === 1) return primaries[0]!.s;
  if (primaries.length === 0 && hits.length === 1) return hits[0]!.s;
  return null;
}

/** The one active member of staff with this exact name, else null. */
export function staffByUniqueName(book: Book, name: string): StaffRecord | null {
  if (!(name || "").trim()) return null;
  const hits = active(book).filter((s) => sameName(s.fullName, name));
  return hits.length === 1 ? hits[0]! : null;
}

export type PrintSignatureRequest = {
  doc: PrintSignatureDoc;
  /** Section the document is for (report cards, result sheets). */
  classId?: string;
  sectionId?: string;
  academicYearCode?: string;
  /** The name the document prints under the principal's line, when it prints one. */
  principalName?: string;
  /** The class teacher the document names (certificates). */
  classTeacherName?: string;
  /** A TC's "Checked by" (certificates only). */
  checkedByName?: string;
  /** Which lines the document actually has; nothing else is resolved. */
  want: { principal?: boolean; classTeacher?: boolean; checkedBy?: boolean };
};

export type PrintSignatories = {
  principal: StaffRecord | null;
  classTeacher: StaffRecord | null;
  checkedBy: StaffRecord | null;
};

export function resolvePrintSignatories(book: Book, req: PrintSignatureRequest): PrintSignatories {
  let principal: StaffRecord | null = null;
  if (req.want.principal) {
    const p = strictPrincipal(book);
    const named = (req.principalName || "").trim();
    // A certificate always names who issued it; the principal signs only their own.
    if (req.doc === "certificate" && !named) principal = null;
    else principal = p && (!named || sameName(p.fullName, named)) ? p : null;
  }

  let classTeacher: StaffRecord | null = null;
  if (req.want.classTeacher) {
    const named = (req.classTeacherName || "").trim();
    if (req.classId && req.sectionId) {
      const t = strictClassTeacher(book, req.classId, req.sectionId, req.academicYearCode || "");
      classTeacher = t && (!named || sameName(t.fullName, named)) ? t : null;
    } else if (named) {
      classTeacher = staffByUniqueName(book, named);
    }
  }

  let checkedBy: StaffRecord | null = null;
  if (req.want.checkedBy && req.doc === "certificate") {
    checkedBy = staffByUniqueName(book, req.checkedByName || "");
  }

  return { principal, classTeacher, checkedBy };
}

/* ── where the image is ──────────────────────────────────────────────── */

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/;

/**
 * Where to read a stored signature from: a file in the private bucket under
 * staff/ (what the staff app and the web form store), or an old inline
 * PNG/JPEG/WebP data URL. Anything else — an expired signed link, another
 * site, an SVG — is not printed.
 */
export function signatureSource(url: string): { kind: "file"; path: string } | { kind: "data"; dataUrl: string } | null {
  const u = (url || "").trim();
  if (!u) return null;
  if (u.startsWith("data:")) return DATA_URL.test(u) ? { kind: "data", dataUrl: u } : null;
  const m = /^\/api\/file\/(staff\/[A-Za-z0-9._\-/]+)$/.exec(u);
  if (!m) return null;
  const path = m[1]!;
  if (path.includes("..") || path.includes("//")) return null;
  return { kind: "file", path };
}

/** The request as query parameters, the one place the client builds them. */
export function printSignatureQuery(req: PrintSignatureRequest): string {
  const q = new URLSearchParams();
  q.set("doc", req.doc);
  const want = [req.want.principal ? "principal" : "", req.want.classTeacher ? "classTeacher" : "", req.want.checkedBy ? "checkedBy" : ""].filter(Boolean);
  q.set("want", want.join(","));
  for (const k of ["classId", "sectionId", "academicYearCode", "principalName", "classTeacherName", "checkedByName"] as const) {
    const v = (req[k] || "").trim();
    if (v) q.set(k, v);
  }
  return q.toString();
}

export function parsePrintSignatureQuery(params: URLSearchParams): PrintSignatureRequest | null {
  const doc = params.get("doc") || "";
  if (!isPrintSignatureDoc(doc)) return null;
  const want = new Set((params.get("want") || "").split(",").map((s) => s.trim()));
  const s = (k: string) => (params.get(k) || "").trim().slice(0, 120);
  return {
    doc,
    classId: s("classId"),
    sectionId: s("sectionId"),
    academicYearCode: s("academicYearCode"),
    principalName: s("principalName"),
    classTeacherName: s("classTeacherName"),
    checkedByName: s("checkedByName"),
    want: { principal: want.has("principal"), classTeacher: want.has("classTeacher"), checkedBy: want.has("checkedBy") },
  };
}

/** Which lines a report card prints, from its template's signature labels. */
export function wantForLabels(labels: string[]): PrintSignatureRequest["want"] {
  const roles = new Set(labels.map(signatoryRoleForLabel));
  return { principal: roles.has("principal"), classTeacher: roles.has("class_teacher") };
}

/**
 * The signatures a certificate prints: the class teacher it names, the
 * TC's "Checked by", and the principal only when the principal is who it
 * was issued by. A void certificate is never signed.
 */
export function certificateSignatureRequest(issue: {
  kind: string;
  voidedAt: string | null;
  issuedBy: string;
  classTeacherName: string;
  tc: { checkedByName?: string } | null;
}): PrintSignatureRequest | null {
  if (issue.voidedAt) return null;
  const isTc = issue.kind === "tc";
  const checkedByName = isTc ? (issue.tc?.checkedByName || "").trim() : "";
  const classTeacherName = (issue.classTeacherName || "").trim();
  const principalName = (issue.issuedBy || "").trim();
  return {
    doc: "certificate",
    principalName,
    classTeacherName,
    checkedByName,
    // No "Issued by" name, no principal's signature: it must be theirs.
    want: { principal: !!principalName, classTeacher: !!classTeacherName, checkedBy: !!checkedByName },
  };
}

/** A report card's signatures: its section's class teacher and the principal, as its template's lines say. */
export function reportCardSignatureRequest(card: {
  student: { classId?: string; sectionId?: string };
  academicYearCode: string;
  presentation: { showSignatures: boolean; signatureLabels: string[] };
}): PrintSignatureRequest | null {
  const p = card.presentation;
  if (!p.showSignatures || p.signatureLabels.length === 0) return null;
  return {
    doc: "report_card",
    classId: card.student.classId || "",
    sectionId: card.student.sectionId || "",
    academicYearCode: card.academicYearCode,
    want: wantForLabels(p.signatureLabels),
  };
}

/** The class result sheet's three lines: Class teacher, Examination in-charge (blank), Principal. */
export const RESULT_SHEET_SIGNATURE_LABELS = ["Class teacher", "Examination in-charge", "Principal"] as const;

export function resultSheetSignatureRequest(sheet: { classId: string; sectionId: string; academicYearCode: string }): PrintSignatureRequest {
  return {
    doc: "result_sheet",
    classId: sheet.classId,
    sectionId: sheet.sectionId,
    academicYearCode: sheet.academicYearCode,
    want: wantForLabels([...RESULT_SHEET_SIGNATURE_LABELS]),
  };
}

/** An admit card's one line: Principal. */
export const ADMIT_CARD_SIGNATURE_REQUEST: PrintSignatureRequest = { doc: "admit_card", want: { principal: true } };

/**
 * One copy of each image per answer: `images[staffId]` gets the data URL and
 * the set keeps only who signs (src ""). A household's six report cards
 * then carry the principal's signature once, not six times.
 */
export function shareSignatureImages(set: PrintSignatureSet, images: Record<string, string>): PrintSignatureSet {
  const ref = (s: PrintSignature | null): PrintSignature | null => {
    if (!s) return null;
    images[s.staffId] = s.src;
    return { staffId: s.staffId, name: s.name, src: "" };
  };
  return { principal: ref(set.principal), classTeacher: ref(set.classTeacher), checkedBy: ref(set.checkedBy) };
}

/** The other half: put the shared images back on a card's set. A missing image is a blank line. */
export function withSignatureImages(set: PrintSignatureSet | null | undefined, images: Record<string, string> | null | undefined): PrintSignatureSet | null {
  if (!set) return null;
  const fill = (s: PrintSignature | null): PrintSignature | null => {
    const src = s ? images?.[s.staffId] || s.src : "";
    return s && src ? { ...s, src } : null;
  };
  return { principal: fill(set.principal), classTeacher: fill(set.classTeacher), checkedBy: fill(set.checkedBy) };
}

/**
 * May this sheet print now? While the signatures are outstanding: wait (a
 * copy printed now would have blank lines only because the answer was
 * slow). Answered — with images or with nobody's on file — or nothing to
 * sign: print. Could not be read: ask, and print without them only when
 * the person says so.
 */
export function printGate(
  status: "none" | "loading" | "ready" | "failed",
  printWithoutConfirmed = false,
): "wait" | "print" | "ask" {
  if (status === "loading") return "wait";
  if (status === "failed") return printWithoutConfirmed ? "print" : "ask";
  return "print";
}

export const PRINT_SIGNATURES_LOADING = "Loading signatures…";
export const PRINT_SIGNATURES_FAILED = "Signatures could not be loaded — print without them?";

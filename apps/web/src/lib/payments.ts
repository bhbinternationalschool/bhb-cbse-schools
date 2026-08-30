/**
 * UPI / payment links — create, share, confirm (demo localStorage).
 * Parent page can mark paid on same origin; counter can confirm manually.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  collectPayment,
  computeHouseholdDues,
  formatInr,
  isCollectionDateLocked,
  loadFees,
  openFeeDues,
  voucherLineFromDue,
  type FeeDueLine,
  type VoucherLine,
} from "@/lib/fees";
import {
  buildSchoolUpiPayUri,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  getSchoolMirrorSync,
  scheduleClientSchoolMirrorSync,
  setMirrorSlice,
} from "@/lib/schoolDataMirror";
import { loadSis } from "@/lib/sis";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type PaymentLinkStatus =
  | "open"
  | "paid"
  | "cancelled"
  | "expired";

export type PaymentLinkLine = {
  dueKey: string;
  studentId: string;
  studentName: string;
  label: string;
  kind: FeeDueLine["kind"];
  amountPaise: number;
};

export type PaymentLink = {
  id: string;
  /** Short public code e.g. PL-7K2M */
  code: string;
  householdId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  academicYearCode: string;
  amountPaise: number;
  lines: PaymentLinkLine[];
  status: PaymentLinkStatus;
  createdAt: string;
  createdBy: string;
  expiresOn: string;
  /** Demo UTR when paid */
  upiRef: string;
  paidAt: string | null;
  voucherId: string | null;
  receiptNo: string | null;
  note: string;
  /** Live PG checkout (Razorpay payment link short_url). */
  gatewayMode?: "demo" | "razorpay" | "cashfree";
  gatewayCheckoutUrl?: string;
  gatewayExternalId?: string;
};

export type PaymentsState = {
  version: 1;
  links: PaymentLink[];
};

const STORAGE_KEY = "bhb_payments_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `PL-${s}`;
}

export function emptyPaymentsState(): PaymentsState {
  return { version: 1, links: [] };
}

export function loadPayments(): PaymentsState {
  if (typeof window === "undefined") {
    const mirrored = getSchoolMirrorSync().payments as PaymentsState | null;
    if (mirrored && Array.isArray(mirrored.links)) {
      return {
        version: 1,
        links: mirrored.links.map(normalizeLink),
      };
    }
    return emptyPaymentsState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPaymentsState();
    const parsed = JSON.parse(raw) as PaymentsState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.links)) {
      return emptyPaymentsState();
    }
    return {
      version: 1,
      links: parsed.links.map(normalizeLink),
    };
  } catch {
    return emptyPaymentsState();
  }
}

export function savePayments(state: PaymentsState) {
  if (!assertModulePermission("fees", "edit", "savePayments")) return;

  if (typeof window === "undefined") {
    setMirrorSlice("payments", state);
    void import("@/lib/paymentsPersistence").then(({ schedulePaymentsSync }) => {
      schedulePaymentsSync(state);
    });
    return;
  }
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  scheduleClientSchoolMirrorSync({ payments: state });
  void import("@/lib/paymentsPersistence").then(({ schedulePaymentsSync }) => {
    schedulePaymentsSync(state);
  });
}

export function writePaymentsLocalRaw(state: PaymentsState) {
  if (typeof window === "undefined") {
    setMirrorSlice("payments", state);
    return;
  }
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  scheduleClientSchoolMirrorSync({ payments: state });
}

export function paymentsStateIsEmpty(state: PaymentsState): boolean {
  return (state.links?.length ?? 0) === 0;
}

const PAYMENTS_MIRROR_META = "bhb_payments_mirror_meta_v1";

function readPaymentsMirrorMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(PAYMENTS_MIRROR_META);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writePaymentsMirrorMeta(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PAYMENTS_MIRROR_META, JSON.stringify({ updatedAt: iso }));
}

export function hydratePaymentsFromMirror(
  raw: unknown,
  remoteAt: string,
  remoteIsNewer: boolean,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  const local = loadPayments();
  const localAt = readPaymentsMirrorMeta();
  const takeRemote =
    remoteIsNewer ||
    paymentsStateIsEmpty(local) ||
    !localAt ||
    (remoteAt && remoteAt > localAt);
  if (!takeRemote) return false;
  writePaymentsLocalRaw(raw as PaymentsState);
  writePaymentsMirrorMeta(remoteAt || new Date().toISOString());
  return true;
}

function normalizeLink(l: PaymentLink): PaymentLink {
  return {
    id: l.id || id("pl"),
    code: l.code || shortCode(),
    householdId: l.householdId || "",
    studentId: l.studentId || "",
    studentName: l.studentName || "",
    classLabel: l.classLabel || "",
    academicYearCode: l.academicYearCode || DEFAULT_AY,
    amountPaise: Math.max(0, Number(l.amountPaise) || 0),
    lines: Array.isArray(l.lines)
      ? l.lines.map((x) => ({
          dueKey: x.dueKey,
          studentId: x.studentId,
          studentName: x.studentName || "",
          label: x.label,
          kind: x.kind,
          amountPaise: Math.max(0, Number(x.amountPaise) || 0),
        }))
      : [],
    status: l.status || "open",
    createdAt: l.createdAt || new Date().toISOString(),
    createdBy: l.createdBy || "",
    expiresOn: l.expiresOn || plusDaysIso(7),
    upiRef: l.upiRef || "",
    paidAt: l.paidAt ?? null,
    voucherId: l.voucherId ?? null,
    receiptNo: l.receiptNo ?? null,
    note: l.note || "",
    gatewayMode: l.gatewayMode,
    gatewayCheckoutUrl: l.gatewayCheckoutUrl,
    gatewayExternalId: l.gatewayExternalId,
  };
}

export function getPaymentLink(
  linkId: string,
  state?: PaymentsState,
): PaymentLink | undefined {
  return (state ?? loadPayments()).links.find((l) => l.id === linkId);
}

export function getPaymentLinkByCode(
  code: string,
  state?: PaymentsState,
): PaymentLink | undefined {
  const c = code.trim().toUpperCase();
  return (state ?? loadPayments()).links.find(
    (l) => l.code.toUpperCase() === c,
  );
}

export function listPaymentLinks(state?: PaymentsState): PaymentLink[] {
  return [...(state ?? loadPayments()).links].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function openPaymentLinkCount(state?: PaymentsState): number {
  const today = todayIso();
  return (state ?? loadPayments()).links.filter(
    (l) => l.status === "open" && l.expiresOn >= today,
  ).length;
}

function refreshExpired(state: PaymentsState): PaymentsState {
  const today = todayIso();
  let changed = false;
  const links = state.links.map((l) => {
    if (l.status === "open" && l.expiresOn < today) {
      changed = true;
      return { ...l, status: "expired" as const };
    }
    return l;
  });
  if (!changed) return state;
  const next = { version: 1 as const, links };
  savePayments(next);
  return next;
}

export function duesToPaymentLines(dues: FeeDueLine[]): PaymentLinkLine[] {
  const sis = loadSis();
  return dues.map((d) => ({
    dueKey: d.dueKey,
    studentId: d.studentId,
    studentName:
      sis.students.find((s) => s.id === d.studentId)?.fullName ?? "Student",
    label: d.label,
    kind: d.kind,
    amountPaise: d.balancePaise,
  }));
}

export function createPaymentLink(input: {
  householdId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  dues: FeeDueLine[];
  createdBy: string;
  academicYearCode?: string;
  expiresInDays?: number;
  note?: string;
  /**
   * What the parent should actually pay, when that is less than the full
   * balance of the selected dues — a counter discount, or an amount the
   * clerk typed into the collect box.
   *
   * Without this the link was always raised for the GROSS balance: the
   * clerk granted a discount, sent the link, and the parent was asked for
   * the undiscounted figure. Allocated oldest-due-first, the same order a
   * part payment is applied at the counter, so the link's breakup matches
   * the receipt the payment will produce.
   */
  targetPaise?: number;
}):
  | { ok: true; link: PaymentLink }
  | { ok: false; error: string } {
  const open = openFeeDues(input.dues).filter((d) => d.balancePaise > 0);
  if (open.length === 0) {
    return { ok: false, error: "Select at least one open due" };
  }

  const gross = open.reduce((s, d) => s + d.balancePaise, 0);
  const target =
    input.targetPaise === undefined
      ? gross
      : Math.max(0, Math.min(Math.round(input.targetPaise), gross));
  if (target <= 0) {
    return { ok: false, error: "Amount must be positive" };
  }

  const ordered = [...open].sort((a, b) => {
    const byDue = a.dueOn.localeCompare(b.dueOn);
    return byDue !== 0 ? byDue : a.dueKey.localeCompare(b.dueKey);
  });

  let remain = target;
  const charged: FeeDueLine[] = [];
  for (const d of ordered) {
    if (remain <= 0) break;
    const take = Math.min(d.balancePaise, remain);
    if (take <= 0) continue;
    charged.push({ ...d, balancePaise: take });
    remain -= take;
  }

  const lines = duesToPaymentLines(charged);
  const amountPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (amountPaise <= 0) {
    return { ok: false, error: "Amount must be positive" };
  }

  const link = normalizeLink({
    id: id("pl"),
    code: shortCode(),
    householdId: input.householdId,
    studentId: input.studentId,
    studentName: input.studentName,
    classLabel: input.classLabel,
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    amountPaise,
    lines,
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    expiresOn: plusDaysIso(input.expiresInDays ?? 7),
    upiRef: "",
    paidAt: null,
    voucherId: null,
    receiptNo: null,
    note: input.note?.trim() ?? "",
  });

  const state = loadPayments();
  savePayments({ version: 1, links: [link, ...state.links] });
  return { ok: true, link };
}

export function patchPaymentLink(
  linkId: string,
  patch: Partial<
    Pick<
      PaymentLink,
      "gatewayMode" | "gatewayCheckoutUrl" | "gatewayExternalId"
    >
  >,
): PaymentLink | null {
  const state = loadPayments();
  const link = state.links.find((l) => l.id === linkId);
  if (!link) return null;
  const updated: PaymentLink = { ...link, ...patch };
  savePayments({
    version: 1,
    links: state.links.map((l) => (l.id === linkId ? updated : l)),
  });
  return updated;
}

export function cancelPaymentLink(linkId: string): boolean {
  const state = loadPayments();
  const link = state.links.find((l) => l.id === linkId);
  if (!link || link.status !== "open") return false;
  savePayments({
    version: 1,
    links: state.links.map((l) =>
      l.id === linkId ? { ...l, status: "cancelled" } : l,
    ),
  });
  return true;
}

/**
 * Resolve still-open balances for a link's due keys (amounts may shrink if
 * partially paid at counter meanwhile).
 */
export function resolveOpenLinesForLink(
  link: PaymentLink,
): { lines: VoucherLine[]; amountPaise: number } | { error: string } {
  const sis = loadSis();
  const masters = loadMasters();
  const fees = loadFees();
  const bundle = computeHouseholdDues(
    link.householdId,
    sis,
    masters,
    fees,
    { includeFuture: false },
  );
  const dues = bundle.flatMap((row) => row.dues);
  const byKey = new Map(dues.map((d) => [d.dueKey, d]));
  const voucherLines: VoucherLine[] = [];
  for (const snap of link.lines) {
    const live = byKey.get(snap.dueKey);
    if (!live || live.balancePaise <= 0) continue;
    const amount = Math.min(snap.amountPaise, live.balancePaise);
    if (amount <= 0) continue;
    const base = voucherLineFromDue(live, snap.studentName);
    voucherLines.push({ ...base, amountPaise: amount });
  }
  if (voucherLines.length === 0) {
    return {
      error:
        "Nothing left to collect — dues may already be paid at the counter",
    };
  }
  const amountPaise = voucherLines.reduce((s, l) => s + l.amountPaise, 0);
  return { lines: voucherLines, amountPaise };
}

export function applyPaymentLink(input: {
  linkId: string;
  cashierName: string;
  upiRef?: string;
  collectionDate?: string;
}):
  | { ok: true; link: PaymentLink; voucherId: string; receiptNo: string }
  | { ok: false; error: string } {
  const state = refreshExpired(loadPayments());
  const link = state.links.find((l) => l.id === input.linkId);
  if (!link) return { ok: false, error: "Payment link not found" };
  if (link.status === "paid") {
    return { ok: false, error: "Link already paid" };
  }
  if (link.status === "cancelled") {
    return { ok: false, error: "Link was cancelled" };
  }
  if (link.status === "expired" || link.expiresOn < todayIso()) {
    return { ok: false, error: "Link has expired" };
  }

  const resolved = resolveOpenLinesForLink(link);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const collectionDate = input.collectionDate || todayIso();
  const upiRef =
    input.upiRef?.trim() ||
    `UPI-${link.code}-${Date.now().toString(36).toUpperCase()}`;

  const result = collectPayment({
    householdId: link.householdId,
    lines: resolved.lines,
    tenders: [
      {
        mode: "upi",
        amountPaise: resolved.amountPaise,
        ref: upiRef,
        instrumentDate: collectionDate,
        bankName: "",
        // A real gateway holds this money until it settles, so the book puts
        // it in clearing rather than in a bank it has not reached. Demo links
        // carry no provider: nothing was captured, so nothing is in transit.
        gatewayProvider:
          link.gatewayMode === "cashfree" || link.gatewayMode === "razorpay"
            ? link.gatewayMode
            : "",
        realisation: "cleared",
      },
    ],
    cashierName: input.cashierName || link.createdBy || "UPI link",
    academicYearCode: link.academicYearCode,
    collectionDate,
    transactionDate: collectionDate,
    transactionId: upiRef,
    source: "payment_link",
    note: [
      link.note,
      `Paid via UPI link ${link.code}`,
    ]
      .filter(Boolean)
      .join(" · "),
    allowDuplicate: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const updated: PaymentLink = {
    ...link,
    status: "paid",
    upiRef,
    paidAt: new Date().toISOString(),
    voucherId: result.voucher.id,
    receiptNo: result.voucher.receiptNo,
    amountPaise: resolved.amountPaise,
  };

  savePayments({
    version: 1,
    links: state.links.map((l) => (l.id === link.id ? updated : l)),
  });

  return {
    ok: true,
    link: updated,
    voucherId: result.voucher.id,
    receiptNo: result.voucher.receiptNo,
  };
}

/** Parent demo: mark paid if link still open in this browser's storage. */
export function payPaymentLinkDemo(
  linkId: string,
):
  | { ok: true; link: PaymentLink; receiptNo: string }
  | { ok: false; error: string } {
  const result = applyPaymentLink({
    linkId,
    cashierName: "Parent UPI (demo)",
  });
  if (!result.ok) return result;
  return {
    ok: true,
    link: result.link,
    receiptNo: result.receiptNo,
  };
}

/* ——— Share payload (hash URL, same pattern as fee receipts) ——— */

export type PaymentSharePayload = {
  v: 1;
  linkId: string;
  code: string;
  studentName: string;
  classLabel: string;
  amountPaise: number;
  expiresOn: string;
  schoolName: string;
  lines: PaymentLinkLine[];
  upiVpa: string;
  /** Optional upi:// deep link for QR / intent */
  upiUri?: string;
  note: string;
};

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(raw: string): string {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildPaymentSharePayload(
  link: PaymentLink,
  schoolName: string,
  upiVpa = "bhbschool@upi",
  upiUri?: string,
): PaymentSharePayload {
  return {
    v: 1,
    linkId: link.id,
    code: link.code,
    studentName: link.studentName,
    classLabel: link.classLabel,
    amountPaise: link.amountPaise,
    expiresOn: link.expiresOn,
    schoolName,
    lines: link.lines,
    upiVpa,
    upiUri: upiUri || undefined,
    note: link.note,
  };
}

/** Prefer school collections UPI + upi:// QR intent on share pages. */
export function buildEnrichedPaymentSharePayload(
  link: PaymentLink,
  schoolName: string,
  masters?: MastersState | null,
): PaymentSharePayload {
  const upi = resolveSchoolCollectionsUpi(masters ?? loadMasters());
  const upiUri = buildSchoolUpiPayUri({
    vpa: upi.vpa,
    payeeName: upi.payeeName,
    amountPaise: link.amountPaise,
    note: `Fees ${link.code}`,
  });
  return buildPaymentSharePayload(link, schoolName, upi.vpa, upiUri);
}

export function encodePaymentSharePayload(payload: PaymentSharePayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodePaymentSharePayload(
  encoded: string,
): PaymentSharePayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as PaymentSharePayload;
    if (parsed?.v !== 1 || !parsed.linkId || !parsed.code) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildPaymentShareUrl(payload: PaymentSharePayload): string {
  if (typeof window === "undefined") return "";
  return buildPaymentShareUrlAbsolute(window.location.origin, payload);
}

export function buildPaymentShareUrlAbsolute(
  origin: string,
  payload: PaymentSharePayload,
): string {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}/pay/share#${encodePaymentSharePayload(payload)}`;
}

export function composeWhatsAppPaymentLinkMessage(
  link: PaymentLink,
  payUrl: string,
  schoolName: string,
  autoSettle = false,
): string {
  const lines = [
    `*${schoolName}*`,
    `Fee payment link · ${link.code}`,
    "",
    `${link.studentName}${link.classLabel ? ` (${link.classLabel})` : ""}`,
    `Amount: *${formatInr(link.amountPaise)}*`,
    `Valid till: ${link.expiresOn}`,
    "",
    autoSettle ? "Pay securely (UPI / card / netbanking):" : "Pay with GPay / UPI:",
    payUrl,
    "",
    ...(autoSettle
      ? ["Receipt comes automatically on WhatsApp after payment."]
      : [
          "1️⃣ Open link → pay in Google Pay / UPI",
          "2️⃣ Tap *Confirm paid* on the page for receipt",
        ]),
    "",
    "Or pay at school counter and share UTR.",
  ];
  return lines.join("\n");
}

export function whatsAppPaymentLinkUrl(
  mobile: string,
  message: string,
): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  if (typeof window !== "undefined") {
    void fetch("/api/wa/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ mobile: phone, body: message }],
      }),
    }).catch(() => null);
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** Soft check — fees still loaded for day-close awareness when applying. */
export function paymentLinkDayHint(date: string): string | null {
  if (isCollectionDateLocked(date, loadFees())) {
    return `Collection date ${date} is day-closed — reopen day-close or use another date`;
  }
  return null;
}

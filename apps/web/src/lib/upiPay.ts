/**
 * Paying someone by UPI from the ERP, and reading the payment back.
 *
 * Director, 7 Oct 2026: "when i make any payment from erp it's open gpay …
 * amount and note and person mobile number or upi id auto select and when i
 * made payment … system autofill UTR". Google Pay never hands a UTR back to a
 * web page, so the round trip is:
 *
 *   1. a `upi://pay` link (opens GPay / PhonePe / any UPI app on a phone, or
 *      as a QR code to scan from the phone when on a computer) with the
 *      payee, amount and a note already filled in;
 *   2. the person pays with their own PIN, in their own app;
 *   3. they upload the app's success screenshot; the ERP reads the UTR,
 *      amount, date and payee off it (Google Vision text, then the parser
 *      here) and checks them against the payment before filling the UTR.
 *
 * Pure: no I/O, tested on real-shaped screen text (upiPay.selftest).
 * Unknown must not become fact: a field the screenshot does not show
 * plainly is left empty, and a mismatch is reported, never smoothed over.
 */

/** name@handle — the shape every UPI app accepts as a payee address. */
export function isVpa(v: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/i.test((v || "").trim());
}

/** A bare 10-digit Indian mobile, for the person to turn into a UPI ID. */
export function asMobile(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}

/**
 * The `upi://pay` link (NPCI deep-link spec). No `mc` / `tr`: those mark a
 * merchant collect, and apps refuse a person-to-person payment that carries
 * them. The note is cut to 50 characters — longer ones are dropped by some
 * apps.
 */
export function buildUpiPayLink(input: {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
}): string {
  if (!isVpa(input.payeeVpa)) throw new Error("A UPI ID (name@bank) is needed to pay");
  const amount = Math.round(input.amountPaise) / 100;
  if (!(amount > 0)) throw new Error("The amount must be more than zero");
  const q = new URLSearchParams({
    pa: input.payeeVpa.trim(),
    pn: (input.payeeName || "").trim().slice(0, 50),
    am: amount.toFixed(2),
    cu: "INR",
    tn: (input.note || "").replace(/\s+/g, " ").trim().slice(0, 50),
  });
  // URLSearchParams encodes spaces as "+", which some UPI apps show literally.
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}

/* ─── Reading a success screenshot ───────────────────────────────────── */

export type UpiProof = {
  /** The 12-digit UPI reference (UTR / RRN), or "" when not plainly shown. */
  utr: string;
  amountPaise: number;
  /** YYYY-MM-DD, or "" */
  paidOn: string;
  payeeName: string;
  payeeVpa: string;
  status: "success" | "failed" | "pending" | "unknown";
  app: "gpay" | "phonepe" | "paytm" | "bhim" | "unknown";
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

function pad2(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

function monthOf(word: string): string {
  const w = word.toLowerCase();
  return MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)] ?? "";
}

function findDate(t: string): string {
  // 7 Oct 2026 · 07 Oct, 2026 · 7 October 2026
  let m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})[,\s]+(20\d{2})\b/);
  if (m && monthOf(m[2]!)) return `${m[3]}-${monthOf(m[2]!)}-${pad2(m[1]!)}`;
  // Oct 7, 2026
  m = t.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m && monthOf(m[1]!)) return `${m[3]}-${monthOf(m[1]!)}-${pad2(m[2]!)}`;
  // 07/10/2026 or 07-10-2026 (day first, as Indian apps print)
  m = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[3]}-${pad2(m[2]!)}-${pad2(m[1]!)}`;
  return "";
}

function findAmountPaise(t: string): number {
  const m = t.match(/(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * The UTR is read only next to a label that names it (each app labels it
 * differently). A screen with no such label but exactly one 12-digit number
 * gives that number; two or more is ambiguous and gives nothing.
 */
function findUtr(t: string): string {
  const labelled = t.match(
    /(?:UPI\s*(?:transaction|txn)\s*ID|UPI\s*Ref(?:erence)?\.?\s*(?:No\.?|Number|ID)?|UTR(?:\s*No\.?)?|Bank\s*Ref(?:erence)?\.?\s*(?:No\.?)?|RRN)\s*[:#-]?\s*\n?\s*(\d{12})\b/i,
  );
  if (labelled) return labelled[1]!;
  const all = [...new Set(t.match(/(?<![\d])\d{12}(?![\d])/g) ?? [])];
  return all.length === 1 ? all[0]! : "";
}

function findStatus(t: string): UpiProof["status"] {
  if (/\b(failed|declined|unsuccessful|reversed)\b/i.test(t)) return "failed";
  if (/\b(pending|processing|in progress)\b/i.test(t)) return "pending";
  if (/\b(completed|successful|success|paid successfully|payment successful|money sent|sent successfully)\b/i.test(t)) return "success";
  return "unknown";
}

function findApp(t: string): UpiProof["app"] {
  if (/google\s*(pay|transaction)/i.test(t) || /\bG\s*Pay\b/i.test(t)) return "gpay";
  // PhonePe's own transaction ids are "T" + 20-odd digits.
  if (/phonepe/i.test(t) || /\bT\d{20,}\b/.test(t)) return "phonepe";
  if (/paytm/i.test(t)) return "paytm";
  if (/\bBHIM\b/.test(t)) return "bhim";
  return "unknown";
}

function findPayee(t: string): { name: string; vpa: string } {
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let name = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const inline = l.match(/^(?:To|Paid to|Sent to)\s*[:-]?\s+(.+)$/i);
    if (inline && !/^(?:your|you)\b/i.test(inline[1]!)) {
      name = inline[1]!;
      break;
    }
    if (/^(?:To|Paid to|Sent to)\s*:?$/i.test(l) && lines[i + 1]) {
      name = lines[i + 1]!;
      break;
    }
  }
  name = name.replace(/\s*\(.*\)\s*$/, "").replace(/[^A-Za-z .'-]/g, "").replace(/\s+/g, " ").trim();
  // The payee's address: the first UPI ID that is not on the "From" line.
  let vpa = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^from\b/i.test(lines[i]!) || (i > 0 && /^from\s*:?$/i.test(lines[i - 1]!))) continue;
    const m = lines[i]!.match(/[a-z0-9][a-z0-9._-]{1,}@[a-z][a-z0-9.-]+/i);
    if (m && isVpa(m[0])) {
      vpa = m[0].toLowerCase();
      break;
    }
  }
  return { name, vpa };
}

export function parseUpiProofText(text: string): UpiProof {
  const t = text || "";
  const payee = findPayee(t);
  return {
    utr: findUtr(t),
    amountPaise: findAmountPaise(t),
    paidOn: findDate(t),
    payeeName: payee.name,
    payeeVpa: payee.vpa,
    status: findStatus(t),
    app: findApp(t),
  };
}

/* ─── Checking it against the payment being recorded ────────────────── */

const nameTokens = (n: string) =>
  (n || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);

export type UpiProofCheck = {
  ok: boolean;
  /** Reasons the proof does not fit — each is shown to the person. */
  problems: string[];
  /** Things worth a look that do not block (e.g. the payee name is shortened). */
  notes: string[];
};

export function checkUpiProof(
  proof: UpiProof,
  expected: { amountPaise: number; payeeVpa?: string; payeeName?: string; earliest?: string; today: string },
): UpiProofCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!proof.utr) problems.push("No UPI reference (UTR) could be read — type it from the app's payment details.");
  if (proof.status === "failed") problems.push("The screenshot shows a failed payment.");
  else if (proof.status === "pending") problems.push("The screenshot shows the payment still pending — wait for it to complete.");
  else if (proof.status === "unknown") notes.push("The screenshot does not say the payment completed — check it did.");
  if (!proof.amountPaise) problems.push("No amount could be read from the screenshot.");
  else if (proof.amountPaise !== Math.round(expected.amountPaise)) {
    problems.push(
      `The screenshot shows ₹${(proof.amountPaise / 100).toLocaleString("en-IN")}, but this payment is ₹${(expected.amountPaise / 100).toLocaleString("en-IN")}.`,
    );
  }
  if (expected.payeeVpa && proof.payeeVpa && proof.payeeVpa.toLowerCase() !== expected.payeeVpa.trim().toLowerCase()) {
    problems.push(`The money went to ${proof.payeeVpa}, not ${expected.payeeVpa}.`);
  } else if (expected.payeeName && proof.payeeName) {
    const want = nameTokens(expected.payeeName);
    const got = nameTokens(proof.payeeName);
    if (want.length && got.length && !got.some((w) => want.includes(w))) {
      problems.push(`The screenshot is a payment to "${proof.payeeName}", not ${expected.payeeName}.`);
    }
  } else if (!proof.payeeVpa && !proof.payeeName) {
    notes.push("The screenshot does not show who was paid — check it is the right person.");
  }
  if (proof.paidOn) {
    if (proof.paidOn > expected.today) problems.push(`The screenshot is dated ${proof.paidOn}, after today.`);
    else if (expected.earliest && proof.paidOn < expected.earliest) {
      notes.push(`The screenshot is dated ${proof.paidOn} — earlier than expected for this payment.`);
    }
  } else {
    notes.push("No date could be read — today's date is used; change it if the payment was on another day.");
  }
  return { ok: problems.length === 0, problems, notes };
}

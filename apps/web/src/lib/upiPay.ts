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

/** Rupees as written on a screen ("11,500", "1,425.50", "500") → paise, or 0. */
function rupeesToPaise(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * Indian digit grouping exactly as the UPI apps print an amount: "500",
 * "11,500", "1,25,000", optional paise. "211,500" is not one of them — that
 * is what a "₹" read as "2" looks like, and it is not guessed at.
 */
const INDIAN_AMOUNT = String.raw`(?:\d{1,2}(?:,\d{2})*,\d{3}|\d{1,7})(?:\.\d{1,2})?`;
const INDIAN_AMOUNT_LINE = new RegExp(`^${INDIAN_AMOUNT}$`);
/** Formatted like money (grouped, or with paise) rather than a bare count. */
const FORMATTED_AMOUNT = /,\d{3}(?:\.\d{1,2})?$|\.\d{2}$/;

/**
 * What Google Vision makes of the rupee sign at the front of a big headline
 * amount: "*11,500", "%11,500", "?11,500", "¥11,500", "Z11,500". Only a
 * non-digit symbol counts — a "₹" read as "2" cannot be told from a real 2.
 */
const RUPEE_MISREAD = "[*%?¥₨Zz]";

/** The words an amount sits next to on every app's success / details screen. */
const AMOUNT_CONTEXT = /\b(paid to|paid|amount|total|debited|credited|completed|successful|success|sent|received|to)\b/i;
/** A number on one of these lines is an account or card suffix, never the amount. */
const NOT_AMOUNT_CONTEXT = /\b(a\/c|account|acct|bank|card|ending|xx|ref|id|no\.?|mobile|phone)\b|[•*x]{2,}/i;

function findAmountPaise(t: string): number {
  // 1. Marked with the rupee sign, "Rs" or "INR" — the first one, as before.
  const marked = t.match(/(?:₹|₨|र[ुू]\.?|\bRs\.?|\bINR\.?|\bRupees?)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (marked) {
    const p = rupeesToPaise(marked[1]!);
    if (p) return p;
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 2. The rupee sign misread as a symbol, at the start of the amount.
  for (const l of lines) {
    const m = l.match(new RegExp(`(?:^|\\s)${RUPEE_MISREAD}\\s?(${INDIAN_AMOUNT})(?:\\s|$)`));
    if (!m) continue;
    // A lone symbol + number line is the headline; mid-line, only a
    // grouped amount ("Paid *11,500 to …"), never "Z 5" in a sentence.
    if (m.index === 0 && l === m[0].trim()) return rupeesToPaise(m[1]!);
    if (FORMATTED_AMOUNT.test(m[1]!)) return rupeesToPaise(m[1]!);
  }
  // 3. No marked amount: a line that is nothing but an amount — the big
  //    headline on GPay / PhonePe / Paytm / BHIM, whose "₹" OCR dropped.
  //    At most 7 digits, so a UTR (12) or a mobile (10) never qualifies;
  //    a date or a time is never a line of bare digits. Scored on what sits
  //    around it; a tie between two different amounts gives nothing.
  const years = new Set((t.match(/\b20\d{2}\b/g) ?? []).filter((y) => new RegExp(`[A-Za-z]{3,9}[,\\s]+${y}|[/-]${y}`).test(t)));
  const scored: { paise: number; score: number }[] = [];
  lines.forEach((l, i) => {
    if (!INDIAN_AMOUNT_LINE.test(l)) return;
    if (years.has(l)) return;
    // "15" / "October 2026, 12:28am" split over two lines is a date.
    const nextWord = (lines[i + 1] || "").match(/^[A-Za-z]+/)?.[0] ?? "";
    const prevWord = (lines[i - 1] || "").match(/[A-Za-z]+$/)?.[0] ?? "";
    if ((nextWord && monthOf(nextWord)) || (prevWord && monthOf(prevWord))) return;
    const paise = rupeesToPaise(l);
    if (!paise) return;
    const near = [lines[i - 2], lines[i - 1], lines[i + 1], lines[i + 2]].filter((x): x is string => !!x);
    let score = 0;
    if (FORMATTED_AMOUNT.test(l)) score += 2;
    if (near.some((x) => AMOUNT_CONTEXT.test(x))) score += 2;
    if (i === 0) score += 1;
    if (lines[i - 1] && NOT_AMOUNT_CONTEXT.test(lines[i - 1]!)) score -= 3;
    if (score > 0) scored.push({ paise, score });
  });
  if (!scored.length) return 0;
  const best = Math.max(...scored.map((s) => s.score));
  const top = new Set(scored.filter((s) => s.score === best).map((s) => s.paise));
  return top.size === 1 ? [...top][0]! : 0;
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

/* ─── Who was paid: the screen's name against the ERP's ─────────────── */

const nameTokens = (n: string) =>
  (n || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** One OCR slip in a word ("SUNGH" for SINGH), two in a long one; same first letter. */
function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || a[0] !== b[0]) return false;
  const allowed = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  return Math.abs(a.length - b.length) <= allowed && editDistance(a, b) <= allowed;
}

/**
 * Does the name on the screenshot name the same person as the ERP? A word
 * in common is enough, as before ("RANDHIR SINGH" / "Randhir Sungh"). With
 * no word exactly in common, OCR slips are forgiven only when the WHOLE
 * name lines up — at least two words, every word of the shorter name close
 * to one of the other's ("Randhlr Sungh"). A single near-miss word never
 * matches: "Rakesh" is not "Rajesh".
 */
export function payeeNamesAgree(screen: string, erp: string): boolean {
  const got = nameTokens(screen);
  const want = nameTokens(erp);
  if (!got.length || !want.length) return false;
  if (got.some((w) => want.includes(w))) return true;
  const [short, long] = got.length <= want.length ? [got, want] : [want, got];
  if (short.length < 2) return false;
  const used = new Set<number>();
  return short.every((w) => {
    const k = long.findIndex((x, i) => !used.has(i) && tokensClose(w, x));
    if (k < 0) return false;
    used.add(k);
    return true;
  });
}

/** Said wherever a screenshot has no UTR — WhatsApp and the ERP upload alike. */
export const UPI_NO_UTR_HELP =
  "This screen has no UPI transaction ID. In your UPI app open this payment's details and send that screenshot — it shows the 12-digit UPI transaction ID / UTR.";

/* ─── Checking it against the payment being recorded ────────────────── */

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
  if (!proof.utr) problems.push(`${UPI_NO_UTR_HELP} Or type the UTR from there.`);
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
    const comparable = nameTokens(expected.payeeName).length > 0 && nameTokens(proof.payeeName).length > 0;
    if (comparable && !payeeNamesAgree(proof.payeeName, expected.payeeName)) {
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

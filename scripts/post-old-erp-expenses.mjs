/**
 * Post the old ERP import into the ledger.
 *
 * Every voucher carries source_type='old_erp_import'. That tag is the undo:
 * if the mapping turns out wrong at voucher 90, one query finds all of them
 * and nothing else in a ledger already holding a thousand fee and store
 * postings is touched.
 *
 *   node scripts/post-old-erp-expenses.mjs --opening      just the opening journal
 *   node scripts/post-old-erp-expenses.mjs --one-day      the smallest day, then stop
 *   node scripts/post-old-erp-expenses.mjs --all          everything remaining
 *
 * Refuses to post the same voucher twice: each carries a source_id built from
 * the old ERP's own receipt number, and the run checks what is already there
 * before writing anything.
 */
import { readFileSync } from "node:fs";

const MODE = process.argv.find((a) => a.startsWith("--")) ?? "--opening";
const SCRATCH = "/private/tmp/claude-501/-Users-ashishsingh-CBSE-Schools/8ab210d5-fd8a-4352-8f47-602ae7d41429/scratchpad";
const env = readFileSync("apps/web/.env.local", "utf8");
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const URL_ = cfg("NEXT_PUBLIC_SUPABASE_URL");
const KEY = cfg("SUPABASE_SERVICE_ROLE_KEY");
const TENANT = "6558f3c4-6d12-4636-bf53-17423b0eaad3";
const SOURCE = "old_erp_import";

const MONTH = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
const iso = (d) => { const [dd,mm,yy]=d.split("-"); return `${yy}-${String(MONTH[mm]).padStart(2,"0")}-${String(+dd).padStart(2,"0")}`; };
const P = (rupees) => Math.round(rupees * 100);

const CASH = "1000", BANK = "1012";
const A = { salary:"5070", advances:"1070", pf:"2320", esi:"2330", trustee:"2100",
  refresh:"5000", fuel:"5031", office:"5040", upkeep:"5010", welfare:"5011",
  advert:"5012", commission:"5013", payable:"2000", duties:"2300", corpus:"3000" };

const HEAD = new Map([
  ["Refreshment",A.refresh],["CNG-Magic 2024",A.fuel],["CNG-Magic 2026",A.fuel],
  ["Misllaneous",A.office],["Stationary",A.office],["MAINTAINENCE",A.upkeep],
  ["Welfare",A.welfare],["Advertisement Related",A.advert],
  ["SHYAM SUNDER",A.salary],["Vimal Driver",A.salary],
  ["SURAJ KUMAR",A.commission],["Vinay Kushwaha",A.office],
]);
/** Held back for the office — never posted by this script. */
const HOLD = new Set(["Puja Items","Anjani Mam","Prathamesh Infotech","Advance Payment",
  "PRASHANT DEV","DEVENDRA KUMAR PANDEY","Peerson Books"]);

async function rpc(voucher) {
  const res = await fetch(`${URL_}/rest/v1/rpc/ledger_post`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_tenant_id: TENANT, p_voucher: voucher }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 240)}`);
  return JSON.parse(text || "null");
}

async function alreadyPosted() {
  const res = await fetch(
    `${URL_}/rest/v1/ledger_vouchers?select=source_id&source_type=eq.${SOURCE}&limit=2000`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return new Set((await res.json()).map((r) => r.source_id));
}

const L = (code, dr, cr, narration = "", party) => ({
  account_code: code, debit_paise: P(dr), credit_paise: P(cr), narration,
  subledger_kind: "", subledger_id: "", cost_centre_code: "",
  ...(party ? { party: { kind: "vendor", external_id: party.toLowerCase(), name: party } } : {}),
});

/* ── the vouchers ─────────────────────────────────────────── */

function opening() {
  return [{
    source_id: "opening-2026-03-31",
    voucher: {
      voucher_type: "journal", date: "2026-03-31",
      narration: "Opening balances at 31-Mar-2026, chained from the old ERP's 2024-25 and 2025-26 trial balances",
      source_type: SOURCE, source_id: "opening-2026-03-31", created_by: "old-erp-import",
      lines: [
        L(CASH, 80809.75, 0, "cash in hand"),
        L(BANK, 96194.02, 0, "bank"),
        L(A.advances, 41745.00, 0, "staff advances, from the advance ledger"),
        L(A.trustee, 427184.00, 0, "already owed to the trust", "Ashish Singh"),
        L(A.duties, 218758.00, 0, "statutory dues, debit balance carried"),
        L(A.payable, 0, 451044.99, "sundry creditors"),
        L(A.corpus, 0, 413645.78, "balancing figure — the old ERP had no capital account"),
      ],
    },
  }];
}

function buildVouchers() {
  const rows = JSON.parse(readFileSync(`${SCRATCH}/exp.json`, "utf8"))
    .map((r) => ({ ...r, lines: (r.lines ?? []).filter((l) => l.label !== "Total") }));
  const out = [];
  for (const r of rows) {
    const n = (r.narr ?? "").trim();
    const pay = r.ledger === "UPI" ? BANK : CASH;
    // Sr is included because the old ERP reuses a receipt number across two
    // different vouchers on the same day; receipt+date alone silently
    // collapsed four vouchers into two and lost 7,332.70 the first time.
    const sid = `exp-${r.sr}-${r.receipt}-${iso(r.date)}`;
    const base = { voucher_type: "payment", date: iso(r.date), source_type: SOURCE,
                   source_id: sid, created_by: "old-erp-import" };

    if (n === "City Office") {
      out.push({ source_id: sid, voucher: { ...base, narration: `Paid to trustee Ashish Singh (old ERP receipt ${r.receipt})`,
        lines: [L(A.trustee, r.amount, 0, "taken from the trust", "Ashish Singh"), L(pay, 0, r.amount)] } });
      continue;
    }
    if (n.startsWith("Extra/Advance")) {
      const who = (n.match(/Payment of (.+?) for the month/) ?? [, "staff"])[1].trim();
      out.push({ source_id: sid, voucher: { ...base, narration: `Advance to ${who} (old ERP receipt ${r.receipt})`,
        lines: [L(A.advances, r.amount, 0, who, who), L(pay, 0, r.amount)] } });
      continue;
    }
    if (n.startsWith("Salary Payment of") || (!n && r.lines.some((l) => /\(Earning\)|\(Deduction\)/.test(l.label)))) {
      let earn=0, absent=0, pf=0, esi=0, advTaken=0, advGiven=0;
      for (const l of r.lines) {
        const a = Math.abs(l.amount);
        if (/^ESI/.test(l.label)) esi+=a;
        else if (/^EPF\(Deduction\)/.test(l.label)) pf+=a;
        else if (/^Absent Deduction/.test(l.label)) absent+=a;
        else if (/^Advance Payment Deduction/.test(l.label)) advTaken+=a;
        else if (/^Advance Payment\(Earning\)/.test(l.label)) advGiven+=a;
        else if (/\(Earning\)$/.test(l.label)) earn+=a;
      }
      const cost = earn - absent;
      const lines = [];
      if (cost>0) lines.push(L(A.salary, cost, 0, "gross earned, net of absence"));
      if (advGiven>0) lines.push(L(A.advances, advGiven, 0, "advance paid with the salary"));
      if (pf>0) lines.push(L(A.pf, 0, pf, "employee PF withheld"));
      if (esi>0) lines.push(L(A.esi, 0, esi, "employee ESI withheld"));
      if (advTaken>0) lines.push(L(A.advances, 0, advTaken, "advance recovered"));
      // A salary fully absorbed by absence and advance recovery pays nothing.
      // The voucher still balances without a payment line, and the ledger
      // refuses a line that is neither a debit nor a credit — rightly so.
      if (r.amount > 0) lines.push(L(pay, 0, r.amount, "net paid"));
      out.push({ source_id: sid, voucher: { ...base, narration: n.slice(0,180) || `Salary (old ERP receipt ${r.receipt})`, lines } });
      continue;
    }
    // ordinary expense: one line per mapped label, held-back labels skipped
    const lines = []; let total = 0;
    for (const l of r.lines) {
      if (HOLD.has(l.label)) continue;
      const head = HEAD.get(l.label);
      if (!head) continue;
      lines.push(L(head, l.amount, 0, l.label));
      total += l.amount;
    }
    if (lines.length) {
      lines.push(L(pay, 0, total));
      out.push({ source_id: sid, voucher: { ...base, narration: `${n || "Daily expense"} (old ERP receipt ${r.receipt})`, lines } });
    }
  }
  // supplementary advance movements from the advance ledger
  for (const [i, s] of JSON.parse(readFileSync(`${SCRATCH}/supplementary.json`, "utf8")).entries()) {
    const sid = `adv-${s.kind}-${i}-${s.date}`;
    const base = { voucher_type: s.kind === "advance" ? "payment" : "journal", date: s.date,
                   source_type: SOURCE, source_id: sid, created_by: "old-erp-import" };
    out.push({ source_id: sid, voucher: s.kind === "advance"
      ? { ...base, narration: `Advance to ${s.who} — in the advance ledger, not the payment report`,
          lines: [L(A.advances, s.amount, 0, s.who, s.who), L(CASH, 0, s.amount)] }
      : { ...base, narration: `Advance recovered from ${s.who} — not shown on a payslip`,
          lines: [L(A.salary, s.amount, 0, "recovery not on a payslip"), L(A.advances, 0, s.amount, s.who, s.who)] } });
  }
  return out;
}

/* ── run ──────────────────────────────────────────────────── */

const done = await alreadyPosted();
let batch = MODE === "--opening" ? opening() : buildVouchers();
if (MODE === "--one-day") {
  const byDay = new Map();
  for (const v of batch) {
    const d = v.voucher.date;
    byDay.set(d, (byDay.get(d) ?? 0) + v.voucher.lines.reduce((s,l)=>s+l.debit_paise,0));
  }
  const smallest = [...byDay.entries()].filter(([,t])=>t>0).sort((a,b)=>a[1]-b[1])[0][0];
  batch = batch.filter((v) => v.voucher.date === smallest);
  console.log(`one-day mode: ${smallest}, ${batch.length} voucher(s)`);
}
batch = batch.filter((v) => !done.has(v.source_id));
if (!batch.length) { console.log("nothing to post — everything in this batch is already in"); process.exit(0); }

let ok=0, failed=0, posted=0;
for (const v of batch) {
  try {
    const r = await rpc(v.voucher);
    const no = r?.voucher_no ?? r?.[0]?.voucher_no ?? "?";
    const dr = v.voucher.lines.reduce((s,l)=>s+l.debit_paise,0)/100;
    console.log(`  ok  ${v.voucher.date}  ${String(no).padEnd(14)} ${dr.toLocaleString("en-IN",{minimumFractionDigits:2})}  ${v.voucher.narration.slice(0,54)}`);
    ok++; posted += dr;
  } catch (e) {
    console.log(`  FAIL ${v.voucher.date}  ${v.source_id}  ${e.message.slice(0,150)}`);
    failed++;
  }
}
console.log(`\n${ok} posted, ${failed} failed, total debits ${posted.toLocaleString("en-IN",{minimumFractionDigits:2})}`);
if (failed) process.exit(1);

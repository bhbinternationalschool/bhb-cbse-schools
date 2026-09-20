/**
 * Re-express the hand-typed PF/ESIC top-up as the derived `statutoryGrossUp`
 * flag, using the EPFO Return Statement for Aug 2026 (est. UPVNS3666697000,
 * filed 03-SEP-2026, 17 members) as the authority on who is a PF member.
 *
 * Why: before 2026-09-20 the top-up was a number someone typed into
 * `additionalAmount`. Checking it against the return showed only 4 of 13 PF
 * members actually landed on their agreed salary — four had no top-up at all,
 * two carried a stale ₹1,050 from an older basic, and two had genuine
 * allowances mixed into the same field. The flag derives the amount from that
 * month's own deductions, so it cannot drift again.
 *
 * Modes:
 *   --mode=as-is      (default) Re-express only staff who are ALREADY whole.
 *                     Nobody's take-home changes by a single rupee. The six
 *                     who are short stay short and are listed for a decision.
 *   --mode=make-whole Turn the flag on for every PF member, so all 13 land on
 *                     their agreed salary. This RAISES pay — see the report.
 *
 * Dry run unless --commit. Writes nothing on a dry run.
 *
 * Before committing, close the Masters → Salary desk in every browser: it is a
 * localStorage-first blob, and a tab holding the old copy will push it back if
 * someone saves there. Reload the desk afterwards to pull the new state.
 */
import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

const { createClient } = await import("@supabase/supabase-js");
const { computeStructureAmounts, additionalFromLink, normalizeStatutoryCover, isPfHeadCode } = await import(
  "../src/lib/salarySetup"
);

type Mode = "as-is" | "make-whole";

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const modeArg = argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length) ?? "as-is";
if (modeArg !== "as-is" && modeArg !== "make-whole") {
  console.error(`Unknown --mode=${modeArg}. Use as-is or make-whole.`);
  process.exit(1);
}
const mode: Mode = modeArg;

/**
 * The Aug-2026 return, verbatim. `gross` is the return's own Gross wages
 * column — the figure our basicOverride already carries for all 13. Kept here
 * so the script refuses to touch a record that has since moved.
 */
const EPFO_AUG_2026: Record<string, { gross: number; pfWage: number; ee: number }> = {
  "VISHAL MISHRA": { gross: 12000, pfWage: 12000, ee: 1440 },
  "RAJESH PATEL": { gross: 20000, pfWage: 15000, ee: 1800 },
  NIRMALA: { gross: 3000, pfWage: 3000, ee: 360 },
  "RAVINDRA YADAV": { gross: 12000, pfWage: 12000, ee: 1440 },
  "JYOTI SINGH": { gross: 11000, pfWage: 11000, ee: 1320 },
  "VISHNU OM TRIPATHI": { gross: 16200, pfWage: 15000, ee: 1800 },
  // Filed as ASHISH KUMAR; the director confirmed this is our ASHISH MALI.
  "ASHISH MALI": { gross: 5000, pfWage: 5000, ee: 600 },
  "KIRAN PATEL": { gross: 5000, pfWage: 5000, ee: 600 },
  RAMANAND: { gross: 6000, pfWage: 6000, ee: 720 },
  "SIKHA SINGH": { gross: 4000, pfWage: 4000, ee: 480 },
  "ANJALI MISHRA": { gross: 7000, pfWage: 7000, ee: 840 },
  "SHWETA RAI": { gross: 12000, pfWage: 12000, ee: 1440 },
  "SURAJ KUMAR": { gross: 6000, pfWage: 6000, ee: 720 },
};

/** In the return but on no staff record — reported, never invented. */
const EPFO_UNKNOWN = ["DUKHRAN RAM", "ASHWANI KUMAR SINGH", "HARISHCHANDRA PRASAD", "ABHISHEK RAGHUVANSHI"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Supabase tenant not configured — check .env.local");
  process.exit(1);
}
const sb = createClient(url, key);

const staffRes = await sb.from("sis_staff").select("id,emp_code,full_name,status").limit(2000);
if (staffRes.error) throw staffRes.error;
const staffById = new Map((staffRes.data ?? []).map((s) => [s.id as string, s]));

const stateRes = await sb.from("salary_setup_state").select("tenant_id,state,updated_at").limit(10);
if (stateRes.error) throw stateRes.error;
if ((stateRes.data ?? []).length !== 1) {
  console.error(`Expected exactly one salary_setup_state row, found ${(stateRes.data ?? []).length}.`);
  process.exit(1);
}
const row = stateRes.data![0] as { tenant_id: string; state: Record<string, unknown>; updated_at: string };
const state = row.state as {
  structures: { id: string; isActive?: boolean; name: string }[];
  staffLinks: Record<string, unknown>[];
  statutory?: unknown;
};
const structById = new Map(state.structures.map((s) => [s.id, s]));

console.log(`tenant ${row.tenant_id} · state last written ${row.updated_at}`);
console.log(`mode ${mode} · ${commit ? "COMMIT" : "dry run"}\n`);

type Plan = {
  name: string;
  cut: number;
  oldAddl: number;
  newAddl: number;
  setFlag: boolean;
  netBefore: number;
  netAfter: number;
  note: string;
};

const plans: Plan[] = [];
const blocked: string[] = [];
const nextLinks = state.staffLinks.map((l) => ({ ...l }));

for (const link of nextLinks) {
  const staff = staffById.get(String(link.staffId));
  const name = String(staff?.full_name ?? "").toUpperCase();
  const epfo = EPFO_AUG_2026[name];
  if (!epfo) continue;

  const struct = structById.get(String(link.structureId));
  if (!struct) {
    blocked.push(`${name}: structure ${link.structureId} is gone`);
    continue;
  }

  const basic = Math.max(0, Number(link.basicOverride) || 0);
  // The return is evidence about a specific wage. If the record has moved
  // since, this script has no authority over it — a human must look.
  if (basic !== epfo.gross) {
    blocked.push(
      `${name}: basic is now ₹${basic.toLocaleString("en-IN")} but the Aug-2026 return says ₹${epfo.gross.toLocaleString("en-IN")} — re-check before repairing`,
    );
    continue;
  }
  if (link.statutoryGrossUp === true) {
    blocked.push(`${name}: already on the derived gross-up — nothing to do`);
    continue;
  }

  const cover = normalizeStatutoryCover(link.statutoryCover as string);
  const before = computeStructureAmounts(
    state as never,
    struct as never,
    basic,
    cover,
    state.statutory as never,
    additionalFromLink(link as never),
    false,
  );
  const cut = before.employeeStatutoryCut;
  // The EPFO return covers PF only — ESIC is a separate filing — so the
  // cross-check is against the PF share alone, not the whole cut.
  const pfEe = before.deductions.reduce(
    (t, d) => (isPfHeadCode(d.head.code) ? t + d.amount : t),
    0,
  );
  if (pfEe !== epfo.ee) {
    blocked.push(
      `${name}: we compute ₹${pfEe.toLocaleString("en-IN")} employee PF but the return remits ₹${epfo.ee.toLocaleString("en-IN")} — re-check before repairing`,
    );
    continue;
  }

  const oldAddl = Math.max(0, Number(link.additionalAmount) || 0);
  const netBefore = before.gross - before.totalDeductions;

  // Preserve pay where the typed amount already covered the cut; the surplus
  // is a real allowance and keeps its own line.
  const wholeAlready = oldAddl >= cut;
  const setFlag = mode === "make-whole" || wholeAlready;
  const newAddl = setFlag ? Math.max(0, oldAddl - cut) : oldAddl;

  if (!setFlag) {
    plans.push({
      name,
      cut,
      oldAddl,
      newAddl,
      setFlag,
      netBefore,
      netAfter: netBefore,
      note: `SHORT by ₹${(cut - oldAddl).toLocaleString("en-IN")} — left as-is; run --mode=make-whole to fix`,
    });
    continue;
  }

  link.statutoryGrossUp = true;
  link.additionalAmount = newAddl;
  if (newAddl === 0) link.additionalLabel = "";

  const after = computeStructureAmounts(
    state as never,
    struct as never,
    basic,
    cover,
    state.statutory as never,
    additionalFromLink(link as never),
    true,
  );
  const netAfter = after.gross - after.totalDeductions;
  plans.push({
    name,
    cut,
    oldAddl,
    newAddl,
    setFlag,
    netBefore,
    netAfter,
    note:
      netAfter === netBefore
        ? "take-home unchanged"
        : `take-home RISES ₹${(netAfter - netBefore).toLocaleString("en-IN")}`,
  });
}

const w = (v: unknown, n: number) => String(v).padEnd(n);
console.log(
  w("staff", 22) + w("PF+ESIC cut", 13) + w("typed", 9) + w("→ allowance", 13) + w("net before", 12) + w("net after", 12) + "result",
);
for (const p of plans.sort((a, b) => a.netAfter - a.netBefore - (b.netAfter - b.netBefore))) {
  console.log(
    w(p.name, 22) + w(p.cut, 13) + w(p.oldAddl, 9) + w(p.setFlag ? p.newAddl : "—", 13) + w(p.netBefore, 12) + w(p.netAfter, 12) + p.note,
  );
}

const raise = plans.reduce((s, p) => s + (p.netAfter - p.netBefore), 0);
const changed = plans.filter((p) => p.setFlag).length;
console.log(`\n${changed} link(s) move to the derived gross-up.`);
console.log(
  raise === 0
    ? "Monthly payroll cost is unchanged."
    : `Monthly take-home rises ₹${raise.toLocaleString("en-IN")} in total (employer PF/ESIC is unaffected).`,
);

if (blocked.length) {
  console.log(`\nnot touched (${blocked.length}):`);
  for (const b of blocked) console.log(`  · ${b}`);
}

const linkedNames = new Set(
  nextLinks.map((l) => String(staffById.get(String(l.staffId))?.full_name ?? "").toUpperCase()),
);
const noLink = (staffRes.data ?? [])
  .filter((s) => s.status === "active")
  .filter((s) => !linkedNames.has(String(s.full_name).toUpperCase()))
  .map((s) => s.full_name);
if (noLink.length) {
  console.log(`\nactive staff with no salary assignment at all (${noLink.length}) — the office must enter their basic;`);
  console.log("  this script will not copy one from the old ERP, which the Aug-2026 return just proved stale:");
  for (const n of noLink) console.log(`  · ${n}`);
}
console.log(`\nin the Aug-2026 return but on no staff record: ${EPFO_UNKNOWN.join(", ")}`);

if (!commit) {
  console.log("\nDry run — nothing written. Re-run with --commit to apply.");
  process.exit(0);
}
if (changed === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

const updatedAt = new Date().toISOString();
const write = await sb
  .from("salary_setup_state")
  .update({ state: { ...state, staffLinks: nextLinks }, updated_at: updatedAt })
  .eq("tenant_id", row.tenant_id)
  .eq("updated_at", row.updated_at) // refuse if someone saved while we planned
  .select("tenant_id");
if (write.error) throw write.error;
if (!write.data?.length) {
  console.error(
    "\nRefused: the salary setup changed while this script was planning. Re-run it.",
  );
  process.exit(1);
}
console.log(`\nWritten. salary_setup_state.updated_at = ${updatedAt}`);
console.log("Reload Masters → Salary in every open browser to pull the new state.");

/**
 * One-time WhatsApp broadcast: announce the new parent/staff portal and the
 * WhatsApp bot, pointing everyone at the existing OTP-first-login flow.
 * See /Users/ashishsingh/.claude/plans/woolly-riding-quail.md for the full
 * design (recipient dedup rule, template wording, risk notes).
 *
 * The template ("bhb_portal_launch") is created via Masters -> WA Templates
 * desk in the app UI, not by this script — this script only builds the
 * recipient list and sends. It refuses to send against a template that
 * isn't APPROVED on Meta yet.
 *
 * Usage:
 *   npx tsx scripts/wa-portal-launch-broadcast.mts
 *     Builds and prints the recipient + exclusion lists only. Nothing is
 *     sent. This is the default and the mandatory first step.
 *
 *   npx tsx scripts/wa-portal-launch-broadcast.mts --dry-run-api
 *     Also POSTs to /api/wa/dispatch with dryRun:true, in batches of <=100.
 *     Zero real WhatsApp sends — the route's own dry-run branch returns
 *     before ever touching Meta.
 *
 *   npx tsx scripts/wa-portal-launch-broadcast.mts --canary +919XXXXXXXXX
 *     Sends the REAL template to exactly one number. Requires the template
 *     to be APPROVED on Meta already.
 *
 *   npx tsx scripts/wa-portal-launch-broadcast.mts --send
 *     REAL broadcast to every recipient, gated behind a typed confirmation
 *     prompt and a live WhatsApp health check immediately before sending.
 *
 * Optional flags:
 *   --base-url <url>   defaults to https://bhbinternational.school
 *   --lang en|hi        defaults to "en"
 *   --out <path>        write the recipient list to a CSV file
 *   --out-excluded <path>  write the exclusion list to a CSV file
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline/promises";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i);
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    console.error("Missing apps/web/.env.local");
    process.exit(1);
  }
}

const TEMPLATE_NAME = "bhb_portal_launch";
const VARIABLE_KEY = "guardianName";
const BATCH_SIZE = 100;

type Recipient = { phone: string; name: string; source: "household" | "staff" };
type Excluded = { label: string; reason: string };

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Every currently-issued Indian mobile number starts with 6/7/8/9. Some
 * UDISE-imported households carry a literal "0000000000" placeholder in
 * both mobile and whatsapp_mobile — a 10-digit string that passes a bare
 * length check but was never a real number. Found by actually running
 * this script against production data (8 households, all HH-UDISE-* /
 * HH-193) — reject it explicitly rather than attempting a send to it.
 */
function isPlausibleIndianMobile(phone: string): boolean {
  if (phone.length !== 10) return false;
  if (!/^[6-9]/.test(phone)) return false;
  if (/^(\d)\1{9}$/.test(phone)) return false;
  return true;
}

async function buildRecipients(): Promise<{
  recipients: Recipient[];
  excluded: Excluded[];
}> {
  const { fetchSisFromDb } = await import("../src/lib/sisNormalized.server.ts");
  const { fetchStaffRemoteServer } = await import("../src/lib/staffPersistence.ts");
  const { waNormalizeLocal10 } = await import("../src/lib/waSend.ts");

  const map = new Map<string, Recipient>();
  const excluded: Excluded[] = [];

  const { bundle, ok } = await fetchSisFromDb();
  if (!ok) throw new Error("Could not load households from the database");
  for (const h of bundle.households) {
    const candidate = h.whatsappMobile || h.mobile;
    const phone = waNormalizeLocal10(candidate || "");
    if (isPlausibleIndianMobile(phone)) {
      map.set(phone, {
        phone,
        name: h.guardianName || h.code,
        source: "household",
      });
    } else {
      excluded.push({
        label: `Household ${h.code} (${h.guardianName || "no name on file"})`,
        reason: phone.length === 10 ? `invalid-looking number (${phone})` : "no valid 10-digit mobile",
      });
    }
  }

  const staffBundle = await fetchStaffRemoteServer();
  if (!staffBundle) throw new Error("Could not load staff from the database");
  for (const s of staffBundle.staff) {
    if (s.status === "inactive") continue;
    const phone = waNormalizeLocal10(s.mobile || "");
    if (isPlausibleIndianMobile(phone)) {
      // Staff wins on a phone-number collision with a household — see plan
      // for the reasoning (a staff mobile is a precise 1:1 field; a
      // household mobile is ambiguously "either guardian").
      map.set(phone, { phone, name: s.fullName, source: "staff" });
    } else {
      excluded.push({
        label: `Staff ${s.empCode || s.id} (${s.fullName})`,
        reason: phone.length === 10 ? `invalid-looking number (${phone})` : "no valid mobile on file",
      });
    }
  }

  return { recipients: [...map.values()], excluded };
}

function printLists(recipients: Recipient[], excluded: Excluded[]) {
  console.log(`\n=== Recipients (${recipients.length}) ===`);
  for (const r of recipients) {
    console.log(`  ${r.phone}  ${r.name}  [${r.source}]`);
  }
  console.log(`\n=== Excluded (${excluded.length}) — needs office follow-up ===`);
  for (const e of excluded) {
    console.log(`  ${e.label} — ${e.reason}`);
  }
  console.log("");
}

function writeCsv(path: string, header: string[], rows: string[][]) {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${path} (${rows.length} rows)`);
}

function templateMessage(lang: string, name: string) {
  return {
    name: TEMPLATE_NAME,
    language: lang,
    variableKeys: [VARIABLE_KEY],
    variables: { [VARIABLE_KEY]: name },
  };
}

async function requireApprovedTemplate(lang: string) {
  const { fetchMetaMessageTemplates } = await import(
    "../src/lib/waTemplatesMeta.server.ts"
  );
  const res = await fetchMetaMessageTemplates();
  if (!res.ok) {
    throw new Error(`Could not check template status on Meta: ${res.error}`);
  }
  const row = res.rows.find(
    (r) => r.name === TEMPLATE_NAME && r.language === lang,
  );
  if (!row) {
    throw new Error(
      `Template "${TEMPLATE_NAME}" (${lang}) not found on Meta yet — ` +
        "create and submit it via Masters -> WA Templates desk first.",
    );
  }
  if (row.status !== "APPROVED") {
    throw new Error(
      `Template "${TEMPLATE_NAME}" (${lang}) status is ${row.status}, ` +
        "not APPROVED yet. Wait for Meta approval before sending.",
    );
  }
  console.log(`Template "${TEMPLATE_NAME}" (${lang}): APPROVED`);
}

async function dispatchBatch(
  baseUrl: string,
  secret: string,
  messages: { mobile: string; template: ReturnType<typeof templateMessage> }[],
  dryRun: boolean,
): Promise<{
  ok?: boolean;
  mode?: string;
  accepted?: number;
  sent?: number;
  failed?: number;
  results?: { mobile: string; status: string; error?: string }[];
  error?: string;
}> {
  const res = await fetch(`${baseUrl}/api/wa/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wa-dispatch-secret": secret,
    },
    body: JSON.stringify({ messages, dryRun }),
  });
  return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const dryRunApi = args.includes("--dry-run-api");
  const doSend = args.includes("--send");
  const canary = flagValue(args, "--canary");
  const baseUrl = flagValue(args, "--base-url") || "https://bhbinternational.school";
  const lang = flagValue(args, "--lang") || "en";
  const outPath = flagValue(args, "--out");
  const outExcludedPath = flagValue(args, "--out-excluded");

  const secret = process.env.WA_DISPATCH_SECRET?.trim();
  if (!secret) {
    console.error("Missing WA_DISPATCH_SECRET in apps/web/.env.local");
    process.exit(1);
  }

  const { recipients, excluded } = await buildRecipients();
  printLists(recipients, excluded);

  if (outPath) {
    writeCsv(
      outPath,
      ["phone", "name", "source"],
      recipients.map((r) => [r.phone, r.name, r.source]),
    );
  }
  if (outExcludedPath) {
    writeCsv(
      outExcludedPath,
      ["who", "reason"],
      excluded.map((e) => [e.label, e.reason]),
    );
  }

  if (canary) {
    await requireApprovedTemplate(lang);
    console.log(`\nSending CANARY to ${canary}...`);
    const result = await dispatchBatch(
      baseUrl,
      secret,
      [{ mobile: canary, template: templateMessage(lang, "Director") }],
      false,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!dryRunApi && !doSend) {
    console.log(
      "No action flags passed — list printed only, nothing sent.\n" +
        "Use --dry-run-api to test the send path, --canary <phone> to test " +
        "a real single send, or --send for the real broadcast.",
    );
    return;
  }

  const batches = chunk(recipients, BATCH_SIZE);

  if (dryRunApi) {
    console.log(`\n=== Dry run against /api/wa/dispatch: ${batches.length} batch(es) ===`);
    for (const [i, batch] of batches.entries()) {
      const messages = batch.map((r) => ({
        mobile: r.phone,
        template: templateMessage(lang, r.name),
      }));
      const result = await dispatchBatch(baseUrl, secret, messages, true);
      console.log(
        `Batch ${i + 1}/${batches.length}: accepted=${result.accepted} mode=${result.mode}`,
      );
    }
    console.log("\nDry run complete. Nothing was sent. Run with --send for the real broadcast.");
    return;
  }

  if (doSend) {
    await requireApprovedTemplate(lang);

    const { getWhatsAppSetupReport } = await import("../src/lib/waMeta.server.ts");
    const report = await getWhatsAppSetupReport();
    if (report.phoneHealth.qualityRating !== "GREEN" || !report.phoneHealth.canSendMessage) {
      console.error(
        "Aborting: WhatsApp phone health check failed.",
        JSON.stringify(report.phoneHealth, null, 2),
      );
      process.exit(1);
    }
    console.log(`Phone health OK: quality=${report.phoneHealth.qualityRating}`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `\nType SEND to broadcast to ${recipients.length} recipients: `,
    );
    rl.close();
    if (answer.trim() !== "SEND") {
      console.log("Aborted — no messages sent.");
      return;
    }

    let totalSent = 0;
    let totalFailed = 0;
    const failures: { mobile: string; error?: string }[] = [];
    for (const [i, batch] of batches.entries()) {
      const messages = batch.map((r) => ({
        mobile: r.phone,
        template: templateMessage(lang, r.name),
      }));
      const result = await dispatchBatch(baseUrl, secret, messages, false);
      console.log(
        `Batch ${i + 1}/${batches.length}: sent=${result.sent ?? 0} failed=${result.failed ?? 0}`,
      );
      totalSent += result.sent ?? 0;
      totalFailed += result.failed ?? 0;
      for (const r of result.results || []) {
        if (r.status === "failed") failures.push({ mobile: r.mobile, error: r.error });
      }
    }

    console.log(`\n=== DONE === sent=${totalSent} failed=${totalFailed}`);
    if (failures.length) {
      console.log("\nFailures (follow up individually):");
      for (const f of failures) console.log(`  ${f.mobile}: ${f.error}`);
    }
    if (excluded.length) {
      console.log(
        `\nReminder: ${excluded.length} people were excluded for missing/invalid ` +
          "numbers and were never attempted — see the exclusion list above.",
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

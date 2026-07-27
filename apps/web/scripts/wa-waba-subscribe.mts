/**
 * Ensure Meta app is subscribed to WABA webhooks (required for inbound).
 * Run on deploy: npm run wa:subscribe
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  ensureWabaWebhookSubscription,
  getWhatsAppSetupReport,
  resolveWhatsAppWabaId,
} from "../src/lib/waMeta.server.ts";

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

async function main() {
  loadEnvLocal();
  const waba = await resolveWhatsAppWabaId();
  console.log("WABA id:", waba || "(not found)");
  const sub = await ensureWabaWebhookSubscription(waba || undefined);
  console.log("Subscribe:", sub.ok ? "ok" : sub.error || "failed");
  const report = await getWhatsAppSetupReport();
  console.log("Subscribed apps:", report.subscribedApps);
  if (report.issues.length) {
    console.log("\nRemaining issues:");
    for (const i of report.issues) console.log(" -", i);
  }
  if (!waba) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

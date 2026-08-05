/**
 * Simulate Meta WhatsApp webhook calls (verify + inbound message).
 *
 * Usage (dev server must be running: npm run dev):
 *   npx tsx scripts/test-wa-webhook.ts --verify
 *   npx tsx scripts/test-wa-webhook.ts --message "Hi"
 *   npx tsx scripts/test-wa-webhook.ts --message "STATUS" --from 9876543210 --name "Test Parent"
 *   npx tsx scripts/test-wa-webhook.ts --message "HUMAN" --url https://bhbinternational.school
 *   npx tsx scripts/test-wa-webhook.ts --admission   # shortcut: admission flow text
 */

import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

type Args = {
  verify: boolean;
  message: string;
  from: string;
  name: string;
  url: string;
  admission: boolean;
};

function parseArgs(): Args | null {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    return null;
  }
  const get = (flag: string, fallback = "") => {
    const i = argv.indexOf(flag);
    if (i < 0 || i + 1 >= argv.length) return fallback;
    return argv[i + 1]!;
  };
  return {
    verify: argv.includes("--verify"),
    admission: argv.includes("--admission"),
    message: get("--message", "Hi"),
    from: get("--from", "9876543210"),
    name: get("--name", "Webhook Test Parent"),
    url: (
      get("--url") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, ""),
  };
}

function waFromId(mobile10: string): string {
  const d = mobile10.replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.slice(-10);
  return `91${ten}`;
}

function buildMetaPayload(opts: {
  fromWaId: string;
  text: string;
  profileName: string;
  messageId: string;
}): object {
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "9451938805",
                phone_number_id: process.env.WHATSAPP_PHONE_ID || "TEST_PHONE_ID",
              },
              contacts: [
                {
                  profile: { name: opts.profileName },
                  wa_id: opts.fromWaId,
                },
              ],
              messages: [
                {
                  from: opts.fromWaId,
                  id: opts.messageId,
                  timestamp: ts,
                  type: "text",
                  text: { body: opts.text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

async function testVerify(baseUrl: string): Promise<void> {
  const token =
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.WA_WEBHOOK_VERIFY_TOKEN ||
    "";
  if (!token) {
    console.error("WHATSAPP_VERIFY_TOKEN not set in .env.local");
    process.exit(1);
  }
  const challenge = `bhb_test_${Date.now()}`;
  const q = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": token,
    "hub.challenge": challenge,
  });
  const url = `${baseUrl}/api/wa/webhook?${q}`;
  console.log("GET", url.replace(token, "***"));
  const res = await fetch(url);
  const body = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", body);
  if (res.status === 200 && body === challenge) {
    console.log("\n✅ Webhook verify OK (Meta challenge echoed)");
    return;
  }
  console.error("\n❌ Verify failed — check token and deployed URL");
  process.exit(1);
}

async function testInbound(opts: Args): Promise<void> {
  const fromWaId = waFromId(opts.from);
  const text = opts.admission ? "STATUS" : opts.message;
  const messageId = `wamid.test_${Date.now()}`;
  const payload = buildMetaPayload({
    fromWaId,
    text,
    profileName: opts.name,
    messageId,
  });
  const url = `${opts.url}/api/wa/webhook`;
  console.log("POST", url);
  console.log("From:", fromWaId, `(${opts.name})`);
  console.log("Text:", JSON.stringify(text));
  console.log("");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  console.log("Status:", res.status);
  console.log(JSON.stringify(json, null, 2));

  if (!res.ok) {
    console.error("\n❌ Webhook POST failed");
    process.exit(1);
  }

  const results = (json as { results?: { audience?: string; replied?: boolean; stub?: boolean }[] }).results;
  const first = results?.[0];
  if (first?.replied) {
    console.log(
      `\n✅ Handled — audience=${first.audience}${first.stub ? " (outbound stub — WHATSAPP_TOKEN not set)" : ""}`,
    );
    console.log("Check: Admissions → CRM parent chat → WhatsApp");
    console.log("Check: Admissions → Leads (source WhatsApp if new number)");
  } else {
    console.log("\n⚠️  Webhook accepted but no reply sent — see results above");
  }
}

async function main() {
  const args = parseArgs();
  if (!args) {
    console.log(`Usage:
  npm run test:wa-webhook -- --verify
  npm run test:wa-webhook -- --message "Hi" [--from 9876543210] [--name "Parent"]
  npm run test:wa-webhook -- --admission [--from 9876543210]
  npm run test:wa-webhook -- --url https://bhbinternational.school --message "STATUS"

Requires dev server (npm run dev) or deployed URL.`);
    return;
  }
  console.log("WhatsApp webhook test\n");

  if (args.verify) {
    await testVerify(args.url);
    return;
  }

  await testInbound(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

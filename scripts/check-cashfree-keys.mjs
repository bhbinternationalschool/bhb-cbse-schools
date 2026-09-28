#!/usr/bin/env node
/**
 * Are the Cashfree keys in apps/web/.env.local actually working?
 *
 *   node scripts/check-cashfree-keys.mjs
 *
 * Run it on the machine that holds .env.local. Nothing here writes, charges or
 * moves money: every call is a read, and the one call that could cost money
 * (a penny drop) is deliberately NOT made — credentials are checked against
 * Cashfree's own credential-verify endpoint instead.
 *
 * IT NEVER PRINTS A SECRET. Only whether a value is present, its length, and
 * what Cashfree said. A key that gets printed ends up in a terminal
 * scrollback, a screenshot or a chat, and then it has to be revoked.
 *
 * WHY THIS EXISTS. Three separate Cashfree products, three key pairs, three
 * hosts. The failure everyone hits is using the payment-gateway App ID for
 * verification or payouts: Cashfree answers "x-client-secret_value_invalid",
 * which reads like a wrong password and is actually the wrong product. This
 * tells you which of the three is wired up and which is not, in one run.
 */

import { readFileSync, existsSync } from "node:fs";
import { createPublicKey, publicEncrypt, constants } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(REPO, "apps", "web", ".env.local");

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";
const OFF = "\u001b[0m";

const ok = (s) => `${GREEN}✓${OFF} ${s}`;
const bad = (s) => `${RED}✗${OFF} ${s}`;
const warn = (s) => `${YELLOW}!${OFF} ${s}`;
const dim = (s) => `${DIM}${s}${OFF}`;

/**
 * Minimal .env reader. Deliberately not dotenv: this script must run with no
 * install step, on a machine where `npm i` may not have been run yet.
 * Handles KEY=value, quotes, blank lines, # comments and `export ` prefixes.
 */
function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = { ...readEnvFile(ENV_PATH), ...process.env };
const val = (k) => (env[k] ?? "").trim();
const isProd = (k) => val(k).toLowerCase() === "production";

function describe(name) {
  const v = val(name);
  if (!v) return { set: false, line: bad(`${name} is EMPTY`) };
  return { set: true, line: ok(`${name} is set ${dim(`(${v.length} chars)`)}`) };
}

async function get(url, headers) {
  try {
    const res = await fetch(url, { headers });
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

async function post(url, headers, payload) {
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    let body = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A short, safe summary of a Cashfree error body. Never echoes a credential. */
function why(body) {
  if (!body || typeof body !== "object") return "";
  const m = body.message ?? body.error_description ?? body.code ?? body.type ?? body.status;
  return m ? String(m).slice(0, 160) : "";
}

let problems = 0;
let checked = 0;

console.log("");
console.log("Cashfree key check");
console.log(dim(`reading ${ENV_PATH}`));
if (!existsSync(ENV_PATH)) {
  console.log("");
  console.log(bad("apps/web/.env.local does not exist."));
  console.log(dim("   cat .env.cashfree.example >> apps/web/.env.local   (>> not >)"));
  console.log("");
  process.exit(1);
}
console.log("");

/* ── 1. Payment gateway ──────────────────────────────────────────────────── */
{
  console.log("1. Payment gateway  " + dim(isProd("CASHFREE_ENV") ? "production" : "sandbox"));
  const id = describe("CASHFREE_APP_ID");
  const secret = describe("CASHFREE_SECRET_KEY");
  console.log("   " + id.line);
  console.log("   " + secret.line);

  if (!id.set || !secret.set) {
    console.log("   " + warn("skipped the live check — fill both in first"));
    problems += 1;
  } else {
    checked += 1;
    const base = isProd("CASHFREE_ENV")
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";
    // A read, and the same call the ERP makes to list a parent's options.
    const r = await post(
      `${base}/eligibility/payment_methods`,
      {
        "Content-Type": "application/json",
        "x-api-version": "2025-01-01",
        "x-client-id": val("CASHFREE_APP_ID"),
        "x-client-secret": val("CASHFREE_SECRET_KEY"),
      },
      { queries: { amount: 1 } },
    );
    if (r.status === 200) console.log("   " + ok("Cashfree accepted these keys"));
    else if (r.status === 401 || r.status === 403) {
      console.log("   " + bad(`Cashfree REJECTED these keys (HTTP ${r.status}) ${dim(why(r.body))}`));
      console.log("   " + dim("   check you used the PG dashboard keys, and that they match the env above"));
      problems += 1;
    } else if (r.status === 0) {
      console.log("   " + bad(`could not reach Cashfree — ${r.error}`));
      problems += 1;
    } else {
      // Reached and authenticated enough to get a real answer.
      console.log("   " + warn(`HTTP ${r.status} ${dim(why(r.body))}`));
      console.log("   " + dim("   not an auth failure — the keys are probably fine"));
    }
  }
  console.log("");
}

/* ── 2. Bank account verification ────────────────────────────────────────── */
{
  console.log("2. Bank verification  " + dim(isProd("CASHFREE_VERIFICATION_ENV") ? "production" : "sandbox"));
  const id = describe("CASHFREE_VERIFICATION_APP_ID");
  const secret = describe("CASHFREE_VERIFICATION_SECRET_KEY");
  console.log("   " + id.line);
  console.log("   " + secret.line);

  if (val("CASHFREE_VERIFICATION_APP_ID") && val("CASHFREE_VERIFICATION_APP_ID") === val("CASHFREE_APP_ID")) {
    console.log("   " + bad("this is the same value as CASHFREE_APP_ID"));
    console.log("   " + dim("   the Verification Suite has its OWN keys. The gateway's will be rejected."));
    problems += 1;
  }

  if (!id.set || !secret.set) {
    console.log("   " + warn("not configured — bank verification is simply off (no error)"));
  } else {
    checked += 1;
    const base = isProd("CASHFREE_VERIFICATION_ENV")
      ? "https://api.cashfree.com/verification"
      : "https://sandbox.cashfree.com/verification";
    // Cashfree's own credential check. Chosen deliberately: a real penny drop
    // would be BILLED, and nobody should pay to find out their key works.
    const r = await get(`${base}/api/v1/credentials/verify`, {
      "x-client-id": val("CASHFREE_VERIFICATION_APP_ID"),
      "x-client-secret": val("CASHFREE_VERIFICATION_SECRET_KEY"),
    });
    if (r.status === 200) console.log("   " + ok("Cashfree accepted these keys"));
    else if (r.status === 401 || r.status === 403) {
      console.log("   " + bad(`Cashfree REJECTED these keys (HTTP ${r.status}) ${dim(why(r.body))}`));
      console.log("   " + dim("   Verification Suite → Developers → API Keys, and check sandbox vs production"));
      problems += 1;
    } else if (r.status === 0) {
      console.log("   " + bad(`could not reach Cashfree — ${r.error}`));
      problems += 1;
    } else {
      console.log("   " + warn(`HTTP ${r.status} ${dim(why(r.body))}`));
      problems += 1;
    }
  }
  console.log("");
}

/* ── 3. Payouts ──────────────────────────────────────────────────────────── */
{
  console.log("3. Payouts  " + dim(isProd("CASHFREE_PAYOUT_ENV") ? "production" : "sandbox"));
  const id = describe("CASHFREE_PAYOUT_CLIENT_ID");
  const secret = describe("CASHFREE_PAYOUT_CLIENT_SECRET");
  const pk = describe("CASHFREE_PAYOUT_PUBLIC_KEY");
  console.log("   " + id.line);
  console.log("   " + secret.line);
  console.log("   " + pk.line);

  if (val("CASHFREE_PAYOUT_CLIENT_ID") && val("CASHFREE_PAYOUT_CLIENT_ID") === val("CASHFREE_APP_ID")) {
    console.log("   " + bad("this is the same value as CASHFREE_APP_ID"));
    console.log("   " + dim("   Payouts has its OWN keys. The gateway's will be rejected."));
    problems += 1;
  }

  const armed = val("CASHFREE_PAYOUTS_ARMED").toLowerCase() === "true";
  console.log(
    "   " +
      (armed
        ? warn("CASHFREE_PAYOUTS_ARMED=true — real transfers CAN be sent")
        : ok("CASHFREE_PAYOUTS_ARMED=false — no transfer can be sent yet (correct until probed)")),
  );

  let signature = "";
  if (pk.set) {
    // Local and definitive: if this fails, every payout call would 401 with
    // "Signature Mismatched", which looks like a credentials problem and is not.
    try {
      const pem = val("CASHFREE_PAYOUT_PUBLIC_KEY");
      const key = createPublicKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
      signature = publicEncrypt(
        { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
        Buffer.from(`${val("CASHFREE_PAYOUT_CLIENT_ID")}.${Math.floor(Date.now() / 1000)}`, "utf8"),
      ).toString("base64");
      console.log("   " + ok("the public key parses and a 2FA signature was generated"));
    } catch (e) {
      console.log("   " + bad(`the public key could not be used — ${e instanceof Error ? e.message : e}`));
      console.log(
        "   " +
          dim("   paste the WHOLE .pem including the -----BEGIN/END PUBLIC KEY----- lines"),
      );
      problems += 1;
    }
  }

  if (!id.set || !secret.set || !pk.set) {
    console.log("   " + warn("not configured — payouts is simply off (no error)"));
  } else if (signature) {
    checked += 1;
    const base = isProd("CASHFREE_PAYOUT_ENV")
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout";
    // A read of the prefunded wallet. Exercises the credentials AND the 2FA
    // signature together, which is the pair most likely to be wrong.
    const r = await get(`${base}/balance`, {
      "x-api-version": "2024-01-01",
      "x-client-id": val("CASHFREE_PAYOUT_CLIENT_ID"),
      "x-client-secret": val("CASHFREE_PAYOUT_CLIENT_SECRET"),
      "X-Cf-Signature": signature,
    });
    if (r.status === 200) {
      console.log("   " + ok("Cashfree accepted the keys AND the signature"));
      const d = (r.body && (r.body.data ?? r.body)) || {};
      const bal = d.available_balance ?? d.availableBalance;
      if (bal !== undefined) console.log("   " + dim(`   wallet balance reads ₹${bal}`));
    } else if (r.status === 401 || r.status === 403) {
      console.log("   " + bad(`Cashfree REJECTED this (HTTP ${r.status}) ${dim(why(r.body))}`));
      console.log("   " + dim("   if it says Signature Mismatched: use the OLDEST client id on the account,"));
      console.log("   " + dim("   and make sure the public key is from the SAME environment as the client id"));
      problems += 1;
    } else if (r.status === 404) {
      // Reported honestly rather than as a key failure: the balance path is the
      // one endpoint in this script not confirmed against a live V2 account.
      console.log("   " + warn(`HTTP 404 on ${base}/balance ${dim(why(r.body))}`));
      console.log("   " + dim("   the keys may be fine — this path is unconfirmed for V2. Tell Claude if you see this."));
      problems += 1;
    } else if (r.status === 0) {
      console.log("   " + bad(`could not reach Cashfree — ${r.error}`));
      problems += 1;
    } else {
      console.log("   " + warn(`HTTP ${r.status} ${dim(why(r.body))}`));
      problems += 1;
    }
  }
  console.log("");
}

/* ── verdict ─────────────────────────────────────────────────────────────── */
console.log("─".repeat(60));
if (checked === 0) {
  console.log(warn("Nothing was checked against Cashfree — no complete key pair was found."));
  process.exit(1);
}
if (problems === 0) {
  console.log(ok(`${checked} product(s) checked, all accepted by Cashfree.`));
  console.log(dim("Nothing was charged and nothing was moved — every call was a read."));
  process.exit(0);
}
console.log(bad(`${problems} problem(s) above. ${checked} product(s) reached Cashfree.`));
console.log(dim("No secret was printed. Paste this output to Claude as-is if you want help."));
process.exit(1);

#!/usr/bin/env node
/**
 * Put the Payouts 2FA public key into apps/web/.env.local, correctly.
 *
 *   node scripts/add-payout-public-key.mjs ~/Downloads/public_key.pem
 *
 * WHY THIS EXISTS. A .pem is multi-line, and a multi-line value in a .env file
 * does not work — everything after the first line is ignored, so the key looks
 * present and every payout call fails with "Signature Mismatched", which reads
 * like a credentials problem. Hand-editing it is the step most likely to go
 * wrong and the hardest to notice having gone wrong. So nobody should have to
 * open the file: this reads it, proves it works, and writes the one-line form
 * the app already knows how to read.
 *
 * It PROVES the key before writing it. The same RSA-OAEP/SHA-1 signature the
 * app generates is generated here, so a wrong file, a truncated paste or a
 * PRIVATE key by mistake is caught now rather than on the first salary run.
 *
 * It never prints the key. Re-running is safe: an existing line is replaced,
 * not duplicated.
 *
 * A NOTE ON SECRECY. Unlike the client secret, this is a PUBLIC key — Cashfree
 * holds the matching private half, and possessing it does not let anyone
 * authenticate as the school. It is still account-identifying, so it stays out
 * of git like everything else in .env.local.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createPublicKey, publicEncrypt, constants } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(REPO, "apps", "web", ".env.local");
const KEY = "CASHFREE_PAYOUT_PUBLIC_KEY";

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const OFF = "\u001b[0m";
const ok = (s) => `${GREEN}✓${OFF} ${s}`;
const bad = (s) => `${RED}✗${OFF} ${s}`;
const dim = (s) => `${DIM}${s}${OFF}`;

function die(msg, hint) {
  console.log("");
  console.log(bad(msg));
  if (hint) console.log(dim(`   ${hint}`));
  console.log("");
  process.exit(1);
}

/** ~ expanded, because a path pasted from Finder or a doc usually has one. */
function expand(p) {
  if (!p) return "";
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

const argPath = expand(process.argv[2]);
const candidates = argPath
  ? [argPath]
  : [
      join(homedir(), "Downloads", "public_key.pem"),
      join(homedir(), "Downloads", "publicKey.pem"),
      join(homedir(), "Downloads", "public_key.txt"),
    ];

const pemPath = candidates.find((p) => p && existsSync(p));
if (!pemPath) {
  die(
    argPath ? `No file at ${argPath}` : "Could not find the .pem in ~/Downloads",
    "Pass the path:  node scripts/add-payout-public-key.mjs ~/Downloads/public_key.pem",
  );
}

const raw = readFileSync(pemPath, "utf8");

// A private key here is a real mistake with a bad outcome, so it is named
// rather than left to fail later as an unhelpful signature error.
if (/BEGIN [A-Z ]*PRIVATE KEY/.test(raw)) {
  die(
    "That is a PRIVATE key, not the public key.",
    "Cashfree gives you a PUBLIC key: Payouts → Developers → Two-Factor Authentication → Generate Public Key.",
  );
}
if (!/BEGIN PUBLIC KEY/.test(raw)) {
  // The 64-character hex string on the dashboard is a fingerprint, not a key —
  // this is exactly the value that was tried once already.
  const looksLikeHex = /^[a-f0-9]{32,}$/i.test(raw.trim());
  die(
    looksLikeHex
      ? "That looks like a key FINGERPRINT (a hex string), not the public key."
      : "That file does not contain a PEM public key.",
    "Download the .pem from Payouts → Developers → Two-Factor Authentication → Generate Public Key. It starts with -----BEGIN PUBLIC KEY-----",
  );
}

let oneLine = "";
try {
  const key = createPublicKey(raw);
  // Proven, not assumed: the exact signature the app will generate.
  publicEncrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from("probe.0", "utf8"),
  );
  oneLine = raw.trim().replace(/\r\n/g, "\n").replace(/\n/g, "\\n");
} catch (e) {
  die(
    `The key could not be used: ${e instanceof Error ? e.message : e}`,
    "The file may be truncated or have been edited. Download it again.",
  );
}

const line = `${KEY}="${oneLine}"`;

if (!existsSync(ENV_PATH)) {
  // Created rather than refused, but the template step is still named: this
  // file needs the other keys too and they are not in here.
  writeFileSync(ENV_PATH, `${line}\n`, "utf8");
  console.log("");
  console.log(ok(`created apps/web/.env.local and wrote ${KEY}`));
  console.log(dim("   it holds ONLY this key so far. Add the rest:"));
  console.log(dim("     cat .env.cashfree.example >> apps/web/.env.local"));
  console.log("");
  process.exit(0);
}

const before = readFileSync(ENV_PATH, "utf8");

// Only LIVE assignments are touched: every uncommented `KEY=` line is dropped
// and one canonical line appended.
//
// Commented lines are left exactly alone, for two reasons. They are inert, so
// they cannot override anything. And this file also documents the SECRET MANAGER
// names in a comment block — `#   CASHFREE_PAYOUT_PUBLIC_KEY=school-erp-...` —
// which a looser pattern would have silently overwritten, destroying the
// instructions for deploying this to production. Replacing only the first match
// was the other half of the same bug: a second assignment further down would
// have survived and, being later, won.
//
// The "m" flag is an ARGUMENT: JavaScript has no inline (?m) syntax and throws
// "Invalid group" on it. Caught by testing the replace branch, which the
// create-a-new-file branch returns before ever reaching.
const live = new RegExp(`^${KEY}=.*(?:\\r?\\n)?`, "gm");
const had = live.test(before);
live.lastIndex = 0;
const stripped = before.replace(live, "");
const after = `${stripped.endsWith("\n") || stripped === "" ? stripped : `${stripped}\n`}${line}\n`;
const replaced = had;

if (after === before) {
  console.log("");
  console.log(ok(`${KEY} was already set to this key — nothing changed.`));
  console.log("");
  process.exit(0);
}

// The old file is kept once, because this edits a file holding every other
// credential the app needs and a bad write there stops the app starting.
writeFileSync(`${ENV_PATH}.bak`, before, "utf8");
writeFileSync(ENV_PATH, after, "utf8");

console.log("");
console.log(ok(`the key parses and a real 2FA signature was generated`));
console.log(ok(`${replaced ? "replaced" : "added"} ${KEY} in apps/web/.env.local`));
console.log(dim(`   read from ${pemPath}`));
console.log(dim(`   previous file kept as apps/web/.env.local.bak`));
console.log("");
console.log("Next:  npm run check:cashfree");
console.log("");

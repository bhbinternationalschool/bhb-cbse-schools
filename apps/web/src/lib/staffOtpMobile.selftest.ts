/**
 * Self-test: a staff number is found however the phone wrote it (13 Oct 2026).
 * Run: npx tsx src/lib/staffOtpMobile.selftest.ts
 *
 * Ravindra Yadav's number is stored as 9598028391 and he got "No staff record
 * found" twice: the staff app's number box offers phone-number autofill, which
 * fills "+91 95980 28391", and the lookup compared that raw text. Typing the
 * ten digits worked, so everyone else signed in.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "authProvisioning.server.ts"), "utf8");
const body = src.slice(src.indexOf("export function mobile10Of"), src.indexOf("export async function resolvePersonByMobile"));
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const mobile10Of = new Function(
  "raw",
  body.slice(body.indexOf("{") + 1, body.lastIndexOf("}")),
) as (raw: string) => string | null;

for (const typed of ["9598028391", "+91 95980 28391", "+919598028391", "919598028391", "095980 28391", " 95980-28391 "]) {
  assert.equal(mobile10Of(typed), "9598028391", `"${typed}" is 9598028391`);
}
assert.equal(mobile10Of("12345"), null, "too short is not a number");
assert.equal(mobile10Of(""), null);

const resolve = src.slice(src.indexOf("export async function resolvePersonByMobile"), src.indexOf("export async function resolvePersonByMobile") + 900);
assert.ok(/const mobile10 = mobile10Of\(rawMobile\);/.test(resolve), "the lookup cleans the number first");
assert.ok(/if \(!mobile10\) return null;/.test(resolve));

console.log("staffOtpMobile.selftest.ts\n  ok");

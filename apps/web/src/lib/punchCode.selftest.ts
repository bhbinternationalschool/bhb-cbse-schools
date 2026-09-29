/**
 * punchCode — six digits per 30 s; now and the previous window pass, older
 * ones and other secrets do not. Run: npx tsx src/lib/punchCode.selftest.ts
 */
import { cleanPunchCode, currentPunchCode, punchCodeForWindow, verifyPunchCode } from "./punchCode";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const S = "test-secret";
const t0 = 1_790_000_000_000; // a fixed moment
const { code, expiresAt, windowMs } = currentPunchCode(S, t0);
expect("six digits", /^\d{6}$/.test(code), true);
expect("window 30s", windowMs, 30_000);
expect("expires after now", expiresAt > t0 && expiresAt - t0 <= 30_000, true);
expect("same window same code", currentPunchCode(S, expiresAt - 1).code, code);
expect("next window new code", currentPunchCode(S, expiresAt).code !== code, true);

expect("now passes", verifyPunchCode(S, code, t0), true);
expect("previous window passes", verifyPunchCode(S, code, expiresAt + 5_000), true);
expect("two windows old fails", verifyPunchCode(S, code, expiresAt + 30_000), false);
expect("other secret fails", verifyPunchCode("other", code, t0), false);
expect("future code fails", verifyPunchCode(S, currentPunchCode(S, expiresAt + 30_000).code, t0), false);
expect("empty fails", verifyPunchCode(S, "", t0), false);
expect("five digits fails", verifyPunchCode(S, code.slice(1), t0), false);

expect("spaced", cleanPunchCode("482 913"), "482913");
expect("dashed", cleanPunchCode("482-913"), "482913");
expect("link", cleanPunchCode("https://x.school/punch?c=482913&k=1"), "482913");
expect("IN prefix", cleanPunchCode("IN 482913"), "482913");
expect("seven digits", cleanPunchCode("1234567"), "");
expect("stable", punchCodeForWindow(S, 42), punchCodeForWindow(S, 42));

if (failed) {
  console.error(`punchCode: ${failed} failure(s)`);
  process.exit(1);
}
console.log("punchCode: ok");

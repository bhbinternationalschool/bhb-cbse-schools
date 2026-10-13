/**
 * Run: npx tsx src/lib/bankFileSafety.selftest.ts
 *
 * The salary bank file moves money, so (14 Oct 2026):
 *  - it is checked against the SERVER's payroll before download: a run
 *    marked paid on another device, a run missing on the server, or a
 *    person already paid this month in another run refuses the file;
 *  - an account number must be digits only (6–18) — hyphens and letters
 *    were passed to the bank;
 *  - the beneficiary name is cleaned to what banks accept (letters, digits,
 *    spaces, ≤ 35) and the screen says what was sent;
 *  - two staff on one account are both blocked.
 */
import assert from "node:assert/strict";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).dispatchEvent ??= () => true;
(globalThis as Record<string, unknown>).addEventListener ??= () => {};
(globalThis as Record<string, unknown>).removeEventListener ??= () => {};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

void (async () => {
  const { bankSafeName, bankFileServerConflicts, buildBankExportPreview, renderUbiSalaryUpload } = await import("./bankFileExport");
  const { writePayrollLocalRaw, loadPayroll } = await import("./payroll");
  const { defaultMasters } = await import("./masters");

  // Names.
  assert.equal(bankSafeName("Dr. R.K. Singh / Asha"), "Dr R K Singh Asha");
  assert.equal(bankSafeName("A".repeat(50)).length, 35);
  assert.equal(bankSafeName("Ramesh & Sons"), "Ramesh Sons");

  // A month with one posted run: three staff.
  const AY = "2026-27";
  const month = "2026-09";
  const line = (staffId: string, empCode: string, fullName: string) =>
    ({ staffId, empCode, fullName, netPay: 20000, amountPayable: 20000, paymentMode: "bank_transfer" }) as never;
  const run = { id: "run_sep", month, academicYearCode: AY, status: "posted", lines: [line("s1", "E1", "Asha"), line("s2", "E2", "Bina"), line("s3", "E3", "Chetan"), line("s4", "E4", "Dev")] } as never;
  writePayrollLocalRaw({ ...loadPayroll(), runs: [run] });
  const masters = {
    ...defaultMasters(),
    staff: [
      { id: "s1", empCode: "E1", fullName: "Asha", bankAccountNo: "1234 5678 9012", bankIfsc: "UBIN0548847", bankAccountName: "Asha Devi." },
      { id: "s2", empCode: "E2", fullName: "Bina", bankAccountNo: "1234-567890", bankIfsc: "UBIN0548847" },
      { id: "s3", empCode: "E3", fullName: "Chetan", bankAccountNo: "555566667777", bankIfsc: "SBIN0001234" },
      { id: "s4", empCode: "E4", fullName: "Dev", bankAccountNo: "555566667777", bankIfsc: "SBIN0001234" },
    ],
  } as never;
  const preview = buildBankExportPreview({ masters, month, academicYearCode: AY });
  const by = (c: string) => preview.rows.find((r) => r.empCode === c)!;
  assert.equal(by("E1").ok, true);
  assert.equal(by("E1").accountNo, "123456789012");
  assert.equal(by("E1").accountName, "Asha Devi");
  assert.ok(by("E1").warnings?.some((w) => /Asha Devi/.test(w)), "the screen says the name was cleaned");
  assert.equal(by("E2").ok, false);
  assert.ok(by("E2").issues.includes("A/c has letters or symbols"), "a hyphen is not sent to the bank");
  assert.equal(by("E3").ok, false);
  assert.equal(by("E4").ok, false);
  assert.ok(by("E3").issues.some((i) => /Same bank a\/c as E4/.test(i)), "both people on one account are blocked");
  assert.equal(preview.readyCount, 1);

  // Server checks.
  const server = (status: string, extra: unknown[] = []) => [{ ...(run as object), status }, ...extra] as never;
  assert.deepEqual(bankFileServerConflicts(preview, server("posted")), [], "server agrees: unpaid");
  assert.match(bankFileServerConflicts(preview, server("paid"))[0]!, /marked paid on the server/);
  assert.match(bankFileServerConflicts(preview, [] as never)[0]!, /not on the server/);
  const otherPaid = { id: "run_sep_part", month, academicYearCode: AY, status: "paid", lines: [line("s1", "E1", "Asha")] };
  assert.match(bankFileServerConflicts(preview, server("posted", [otherPaid])).join(" "), /Already paid for 2026-09 in another run: E1 Asha/);

  // Union Bank's own salary upload (the bank's CSV format, 14 Oct 2026).
  const ubiRow = (empCode: string, accountNo: string, ifsc: string, amount: number) =>
    ({ empCode, fullName: empCode, accountNo, ifsc, amount, ok: true, issues: [] }) as never;
  const ubi = renderUbiSalaryUpload(
    { month: "2026-10", debitAccountNo: "566802080000111", debitCorporateId: "BHB, INTL" },
    [ubiRow("E1", "344502090000222", "UBIN0548847", 25000), ubiRow("E2", "455602090000333", "UBIN0544560", 18500), ubiRow("E3", "30112233445", "SBIN0001234", 12000)],
    "7",
  );
  assert.ok(ubi.ok);
  const out = (ubi as { content: string }).content;
  assert.equal(
    out,
    [
      "FILEHDR,BHB INTL,7",
      "56680,566802080000111,INR,DR,43500,SAL OCT 2026",
      "34450,344502090000222,INR,CR,25000,SAL OCT26 E1",
      "45560,455602090000333,INR,CR,18500,SAL OCT26 E2",
      "",
    ].join("\r\n"),
    "header, one debit for the total, one credit per Union Bank account; commas removed",
  );
  assert.ok(!out.startsWith("\uFEFF"), "plain CSV (MS-DOS): no byte-order mark");
  for (const line of out.trim().split("\r\n").slice(1)) {
    const f = line.split(",");
    assert.equal(f.length, 6);
    assert.ok(f[1]!.length <= 15 && f[5]!.length <= 13, `field limits: ${line}`);
  }
  assert.deepEqual((ubi as { otherBank: { empCode: string }[] }).otherBank.map((r) => r.empCode), ["E3"], "the SBI account goes by NEFT, named");
  const noCorp = renderUbiSalaryUpload({ month: "2026-10", debitAccountNo: "566802080000111", debitCorporateId: "" }, [ubiRow("E1", "344502090000222", "UBIN0548847", 1)]);
  assert.equal(noCorp.ok, false, "no corporate ID: refused");
  const badDebit = renderUbiSalaryUpload({ month: "2026-10", debitAccountNo: "5668-0208", debitCorporateId: "X" }, [ubiRow("E1", "344502090000222", "UBIN0548847", 1)]);
  assert.equal(badDebit.ok, false, "debit a/c must be digits");

  console.log("bankFileSafety.selftest.ts: ok");
})();

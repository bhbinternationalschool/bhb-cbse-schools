import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A browser with a database (the case the guard exists for).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
const events: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: (e: { type: string; detail?: { id?: string } }) => events.push(`${e.type}:${e.detail?.id}`),
};
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

void (async () => {
  const guard = await import("./deskHydrateGuard");
  const { refuseSaveBeforeLoad } = await import("./deskLoadGuard");

  // Before the desk loads: refused, the desk is asked to load, one notice.
  let loads = 0;
  const load = async () => {
    loads++;
  };
  assert.equal(refuseSaveBeforeLoad("staff_hr", load), true, "a save before load is refused");
  assert.equal(refuseSaveBeforeLoad("staff_hr", load), true);
  assert.equal(loads, 2, "each refusal asks the desk to load");
  assert.deepEqual(events, ["bhb-desk-not-loaded:staff_hr"], "one notice, not one per keystroke");

  // Once loaded, saves go through — and KEEP going through after the 15 s
  // re-read cache expires (the bug in the first version of this guard).
  guard.markDeskHydrated("staff_hr");
  assert.equal(refuseSaveBeforeLoad("staff_hr", load), false);
  const realNow = Date.now;
  Date.now = () => realNow() + 20 * 60_000; // twenty minutes later
  assert.equal(guard.isDeskHydrated("staff_hr"), false, "the re-read cache has expired");
  assert.equal(guard.hasDeskLoaded("staff_hr"), true, "but the page still holds the real copy");
  assert.equal(refuseSaveBeforeLoad("staff_hr", load), false, "an edit twenty minutes in is saved");
  Date.now = realNow;

  // A reset (conflict reload, merge, logout) means "reload first" again.
  guard.resetDeskHydrated("staff_hr");
  assert.equal(refuseSaveBeforeLoad("staff_hr", load), true);
  guard.markDeskHydrated("staff_hr");
  guard.markDeskHydrated("fees");
  guard.resetDeskHydrated();
  assert.equal(guard.hasDeskLoaded("fees"), false, "a full reset clears every desk");

  // No database (offline dev build): never refused.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(refuseSaveBeforeLoad("vault", load), false);

  // Wiring: every hand-rolled desk scheduler and the slice factory use the guard.
  const dir = join(process.cwd(), "src/lib");
  for (const f of [
    "createDeskSlicePersistence", "homeworkPersistence", "staffAttendancePersistence", "examsPersistence",
    "feesPersistence", "paymentsPersistence", "attendancePersistence", "transportPersistence",
    "accountsPersistence", "admissionsPersistence", "libraryPersistence", "payrollPersistence",
    "ptmPersistence", "rtePersistence", "vaultPersistence", "trustPersistence", "timetablePersistence",
    "teachingPersistence", "notificationsPersistence", "schoolCommsPersistence",
    "studentLeavePersistence", "salarySetupPersistence", "curriculumPersistence",
  ]) {
    const src = readFileSync(join(dir, `${f}.ts`), "utf8");
    assert.ok(src.includes("refuseSaveBeforeLoad("), `${f} refuses a save before its desk loads`);
  }
  const staff = readFileSync(join(dir, "staffPersistence.ts"), "utf8");
  assert.ok(staff.includes("hasDeskLoaded(MODULE)") && !/if \(!isDeskHydrated\(MODULE\)\) \{\n\s+const held/.test(staff), "staff guard uses the sticky flag");

  // The two seeds that wrote made-up rows to the live desk are offline-only.
  for (const [f, fn] of [["homework", "seedHomeworkIfEmpty"], ["vault", "seedVaultIfEmpty"]]) {
    const src = readFileSync(join(dir, `${f}.ts`), "utf8");
    const body = src.slice(src.indexOf(`export function ${fn}`), src.indexOf(`export function ${fn}`) + 900);
    assert.ok(body.includes("if (isSupabaseConfigured()) return existing;"), `${fn} never seeds a school desk`);
  }
  // Screens wait for Masters (12 Oct 2026: Allocate teaching showed no
  // classes or subjects when it mounted before Masters landed). Since
  // data-layer 2.3a the wait is on the masters VIEW (ShellDataWait), whose
  // answer the 2.1 bridge lays on the page copy before the query resolves.
  const shell = readFileSync(join(process.cwd(), "src/components/shell/AppShell.tsx"), "utf8");
  assert.ok(/<ShellDataWait>\{children\}<\/ShellDataWait>/.test(shell), "every ERP screen renders inside ShellDataWait");
  const wait = readFileSync(join(process.cwd(), "src/components/shell/ShellDataWait.tsx"), "utf8");
  assert.ok(wait.includes("useMasters(") && wait.includes("PAGE_COPY_WAIT_MS = 5_000"), "the wait needs the masters view; the roster/roles page copies at most 5 s");
  const staffWs = readFileSync(join(process.cwd(), "src/components/staff/StaffWorkspace.tsx"), "utf8");
  assert.ok(/useMasters\(\{ enabled: false \}\)[\s\S]{0,600}rereadBook\(\)/.test(staffWs), "Staff screen re-reads the book when a Masters answer lands");
  // The Masters hydrate merges into the copy as it is when the reply lands:
  // the staff roster written meanwhile must survive (12 Oct 2026: Staff
  // showed 0 on every refresh).
  const mp = readFileSync(join(dir, "mastersPersistence.ts"), "utf8");
  assert.ok(mp.includes("mergeDbDeskIntoMastersState(loadMasters(), bundle"), "masters hydrate merges into the current copy");
  assert.ok(!mp.includes("mergeDbDeskIntoMastersState(localBefore"), "never writes back the pre-fetch snapshot");
  const mastersSrc = readFileSync(join(dir, "masters.ts"), "utf8");
  const mirror = mastersSrc.slice(mastersSrc.indexOf("export function hydrateMastersFromMirror"), mastersSrc.indexOf("export function hydrateMastersFromMirror") + 1400);
  assert.ok(mirror.includes("STAFF_OWNED_MASTERS_SLICES") && mirror.includes("loadMasters()"), "mirror hydrate keeps the staff roster");
  console.log("deskLoadGuard.selftest.ts\n  ok");
})();

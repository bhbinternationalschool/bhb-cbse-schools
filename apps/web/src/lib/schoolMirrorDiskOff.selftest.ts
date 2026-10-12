/**
 * Run: npx tsx src/lib/schoolMirrorDiskOff.selftest.ts
 *
 * data-layer 0.5d. In production the school mirror's disk copy
 * (.data/school_mirror.json) is read at most once per process and never
 * written: every ensureSchoolMirrorLoaded() re-parsed ~4 MB, and every
 * slice write stringified the whole mirror to disk with the HTTP reply held
 * until it settled. The in-memory mirror is a per-process singleton (one
 * webpack runtime for every route), so the file bridged nothing.
 * Local dev keeps the file.
 *
 * Runs the real mirror module in a temp working directory.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
const dir = mkdtempSync(join(tmpdir(), "mirror-disk-selftest-"));
process.chdir(dir);
mkdirSync(join(dir, ".data"));
const file = join(dir, ".data", "school_mirror.json");
const writeDisk = (classId: string) =>
  writeFileSync(
    file,
    JSON.stringify({ version: 1, updatedAt: "2026-10-13T00:00:00Z", sis: null, fees: null, payments: null, masters: { classes: [{ id: classId }] }, admissions: null }),
  );
const classOf = (m: { masters: unknown }) => ((m.masters as { classes?: { id: string }[] } | null)?.classes ?? [])[0]?.id;

const tracked: unknown[] = [];
(globalThis as { __bhbTrackServerWork?: (p: Promise<unknown>) => void }).__bhbTrackServerWork = (p) => tracked.push(p);
const env = process.env as Record<string, string | undefined>;

void (async () => {
  writeDisk("from_disk_1");
  env.NODE_ENV = "production";
  const server = await import("./schoolDataMirror.server");
  const mirror = await import("./schoolDataMirror");

  // Read once.
  const first = await server.ensureSchoolMirrorLoaded();
  assert.equal(classOf(first), "from_disk_1", "the first call reads the disk copy");

  // Not again: a newer memory copy is never replaced by the file.
  mirror.setMirrorSlice("masters", { classes: [{ id: "in_memory" }] });
  const trackedAfterWrite = tracked.length;
  await Promise.all(tracked);
  writeDisk("from_disk_2");
  const second = await server.ensureSchoolMirrorLoaded();
  assert.equal(classOf(second), "in_memory", "production: the file is not re-read (memory stands)");

  // Never written, and no reply is held for a write.
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(readFileSync(file, "utf8").includes("from_disk_2"), "production: a slice write does not touch the disk");
  assert.equal(trackedAfterWrite, 0, "production: no disk work is tracked (the reply is not held)");

  // Local dev keeps the disk copy as it was.
  env.NODE_ENV = "development";
  const dev = await server.ensureSchoolMirrorLoaded();
  assert.equal(classOf(dev), "from_disk_2", "dev: the file is read");
  mirror.setMirrorSlice("masters", { classes: [{ id: "dev_write" }] });
  await Promise.all(tracked);
  assert.equal(tracked.length, 1, "dev: the disk write is tracked as before");
  assert.ok(readFileSync(file, "utf8").includes("dev_write"), "dev: the slice write reaches the disk");

  console.log("schoolMirrorDiskOff selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

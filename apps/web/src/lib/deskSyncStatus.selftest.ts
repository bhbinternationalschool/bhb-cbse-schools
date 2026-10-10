/**
 * Desk-sync status — the failure that used to vanish.
 *
 * Run: npx tsx src/lib/deskSyncStatus.selftest.ts
 */
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).dispatchEvent ??= () => true;
(globalThis as Record<string, unknown>).addEventListener ??= () => {};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

import {
  clearDeskSyncStatus,
  deskSyncState,
  explainDeskSyncFailure,
  failingDeskSyncs,
  trackDeskPush,
} from "@/lib/deskSyncStatus";

console.log("deskSyncStatus.selftest.ts");

async function main() {
  // The case the old code lost entirely: the request completes, the response
  // is not ok, and the previous shape fell past its success branch doing
  // nothing at all — no write, no log, no error.
  {
    clearDeskSyncStatus("accounts");
    const landed = await trackDeskPush("accounts", async () => ({
      ok: false,
      status: 403,
      error: "Your role cannot write accounts",
    }));
    assert.equal(landed, false, "a refused push reports that it did not land");

    const s = deskSyncState("accounts");
    assert.equal(s.consecutiveFailures, 1, "and it is recorded");
    assert.equal(s.lastStatus, 403);
    assert.equal(s.lastError, "Your role cannot write accounts", "the server's own message survives");
    assert.equal(s.lastSuccessAt, "", "nothing from this browser has ever landed");
    assert.deepEqual(failingDeskSyncs().map((f) => f.module), ["accounts"]);
    console.log("  ok  a not-ok response is recorded rather than falling through in silence");
  }

  // A thrown request is the case the old catch did handle — to a console.
  {
    clearDeskSyncStatus("fees");
    await trackDeskPush("fees", async () => {
      throw new Error("Failed to fetch");
    });
    const s = deskSyncState("fees");
    assert.equal(s.consecutiveFailures, 1);
    assert.equal(s.lastStatus, 0, "a thrown request has no status");
    assert.match(s.lastError, /Failed to fetch/);
    console.log("  ok  a network failure is recorded too, not just logged");
  }

  // Repeated failures accumulate, so "it has never worked" is distinguishable
  // from "it failed once".
  {
    for (let i = 0; i < 2; i += 1) {
      await trackDeskPush("accounts", async () => ({ ok: false, status: 500 }));
    }
    assert.equal(deskSyncState("accounts").consecutiveFailures, 3, "failures accumulate");
    assert.equal(deskSyncState("accounts").lastStatus, 500, "and the latest reason is kept");
  }

  // Success clears the alarm, and records that something has landed.
  {
    const landed = await trackDeskPush("accounts", async () => ({ ok: true, status: 200 }));
    assert.equal(landed, true);
    const s = deskSyncState("accounts");
    assert.equal(s.consecutiveFailures, 0, "a success clears the failure count");
    assert.equal(s.lastError, "", "and the error");
    assert.ok(s.lastSuccessAt, "and stamps when it last worked");
    assert.deepEqual(
      failingDeskSyncs().map((f) => f.module),
      ["fees"],
      "only the still-failing module remains",
    );
    console.log("  ok  a success clears the alarm and records that the desk has reached the server");
  }

  // The explanation has to be readable by whoever is standing at the counter,
  // not by whoever wrote the fetch.
  {
    const denied = explainDeskSyncFailure({
      module: "accounts", lastAttemptAt: "", lastSuccessAt: "",
      lastError: "", lastStatus: 403, consecutiveFailures: 1,
    });
    assert.match(denied, /not allowed to save/i);
    assert.match(denied, /this browser only/i, "and says where the change actually is");

    const offline = explainDeskSyncFailure({
      module: "accounts", lastAttemptAt: "", lastSuccessAt: "",
      lastError: "", lastStatus: 0, consecutiveFailures: 1,
    });
    assert.match(offline, /could not be reached/i);
    assert.match(offline, /will be sent/i, "an outage is recoverable and says so");
    console.log("  ok  the reason is explained in words the counter can act on");
  }

  // The recording itself must be reachable. The 24 Aug sweep that added
  // recordDeskSync* to every desk client appended it after the push's last
  // `return` in the student-attendance and masters clients, so neither ever
  // recorded a success or a failure — and nothing complained. Any statement
  // directly after a `return …;` at the same indent, in a file that records
  // desk sync, is that bug again.
  {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.selftest\.ts$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const unreachable: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (!/recordDeskSync(Success|Failure)\(/.test(text)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const ret = /^(\s*)return\b[^;]*;\s*$/.exec(lines[i]!);
        if (!ret) continue;
        const next = lines[i + 1]!;
        if (/^\s*$/.test(next) || /^\s*[})\]]/.test(next) || /^\s*(case|default)\b/.test(next)) continue;
        if (/^(\s*)/.exec(next)![1]!.length === ret[1]!.length) {
          unreachable.push(`${f.slice(root.length + 1)}:${i + 2}`);
        }
      }
    }
    assert.deepEqual(unreachable, [], `code after a return, never runs: ${unreachable.join(", ")}`);
    console.log("  ok  no desk client records its sync status after it has already returned");
  }

  console.log("\nAll desk-sync status checks passed.");
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

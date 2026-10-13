/**
 * The scoreboard (data-layer step 1.1): one line per test, written to
 * apps/web/e2e/scoreboard.json at the end of the run and printed as a table.
 *
 * Outcome of each test:
 *   pass            expected to pass, passed
 *   expected-fail   marked test.fail() with its reason, and failed — the gate
 *                   sees the defect; the reason and the error are recorded
 *   UNEXPECTED-PASS marked test.fail() but passed — the defect is gone: remove
 *                   the test.fail() (Playwright already fails the run)
 *   FAIL            expected to pass, failed — a regression or a broken test
 *   fixme           test.fixme() — not built yet (stale-writer until step 1.5)
 *
 * `failedStep` is the innermost test.step() that threw, so an expected failure
 * can be checked to have failed where it should (the propagation step, not the
 * control step that proves the selector works). Measurements attached by the
 * specs as `metric:<name>` JSON attachments are copied into `metrics`.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

type Row = {
  project: string;
  file: string;
  title: string;
  outcome: "pass" | "expected-fail" | "UNEXPECTED-PASS" | "FAIL" | "fixme";
  durationMs: number;
  reasons: string[];
  annotations: { type: string; description?: string }[];
  failedStep: string | null;
  error: string | null;
  metrics: Record<string, unknown>;
};

function innermostFailedStep(steps: TestStep[]): TestStep | null {
  for (const s of steps) {
    if (s.category !== "test.step") continue;
    if (!s.error) continue;
    return innermostFailedStep(s.steps) ?? s;
  }
  return null;
}

function firstLines(text: string | undefined, n = 6): string | null {
  if (!text) return null;
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  return plain.split("\n").filter((l) => l.trim()).slice(0, n).join("\n");
}

class ScoreboardReporter implements Reporter {
  private rows: Row[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "";
    const expectFail = test.expectedStatus === "failed";
    let outcome: Row["outcome"];
    if (result.status === "skipped") outcome = "fixme";
    else if (expectFail) outcome = result.status === "passed" ? "UNEXPECTED-PASS" : "expected-fail";
    else outcome = result.status === "passed" ? "pass" : "FAIL";

    const metrics: Record<string, unknown> = {};
    for (const a of result.attachments) {
      if (!a.name.startsWith("metric:") || !a.body) continue;
      try {
        metrics[a.name.slice("metric:".length)] = JSON.parse(a.body.toString("utf8"));
      } catch {
        metrics[a.name.slice("metric:".length)] = a.body.toString("utf8");
      }
    }
    const step = innermostFailedStep(result.steps);
    const seenAnn = new Set<string>();
    const annotations = [...test.annotations, ...result.annotations]
      .map((a) => ({ type: a.type, description: a.description }))
      .filter((a) => {
        const k = `${a.type}\u0000${a.description ?? ""}`;
        if (seenAnn.has(k)) return false;
        seenAnn.add(k);
        return true;
      });
    this.rows.push({
      project,
      file: test.location.file.split("/e2e/specs/").pop() ?? test.location.file,
      title: test.title,
      outcome,
      durationMs: result.duration,
      reasons: annotations.filter((a) => a.type === "fail" || a.type === "fixme").map((a) => a.description ?? ""),
      annotations,
      failedStep: step?.title ?? null,
      error: firstLines(result.error?.message),
      metrics,
    });
  }

  onEnd(result: FullResult): void {
    const count = (o: Row["outcome"]) => this.rows.filter((r) => r.outcome === o).length;
    const summary = {
      pass: count("pass"),
      expectedFail: count("expected-fail"),
      unexpectedPass: count("UNEXPECTED-PASS"),
      fail: count("FAIL"),
      fixme: count("fixme"),
      runStatus: result.status,
    };
    const out = {
      generatedAt: new Date().toISOString(),
      appUrl: process.env.E2E_APP_URL ?? null,
      commit: process.env.GITHUB_SHA ?? null,
      rule:
        "green = every test is pass, expected-fail (test.fail with its reason) or fixme. " +
        "UNEXPECTED-PASS means a defect is gone: remove its test.fail(). FAIL is a regression or a broken test.",
      summary,
      tests: this.rows,
    };
    const file = resolve(__dirname, "scoreboard.json");
    writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

    const lines = this.rows.map((r) => {
      const m = Object.keys(r.metrics).length ? ` ${JSON.stringify(r.metrics)}` : "";
      const why = r.reasons.length ? ` — ${r.reasons.join(" / ")}` : "";
      const where = r.outcome === "expected-fail" && r.failedStep ? ` [failed at: ${r.failedStep}]` : "";
      return `  ${r.outcome.padEnd(15)} ${r.project.padEnd(16)} ${r.file} › ${r.title}${why}${where}${m}`;
    });
    console.log(
      `\nScoreboard (${file}):\n${lines.join("\n")}\n` +
        `  pass ${summary.pass} · expected-fail ${summary.expectedFail} · fixme ${summary.fixme} · ` +
        `UNEXPECTED-PASS ${summary.unexpectedPass} · FAIL ${summary.fail}\n`,
    );
  }
}

export default ScoreboardReporter;

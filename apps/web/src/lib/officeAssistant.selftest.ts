/**
 * Self-test for the director console's pure core (officeAssistant.ts).
 *
 * Run: npx tsx src/lib/officeAssistant.selftest.ts
 *
 * Covers the parts that must hold regardless of the live model or DB:
 * director-only identity, reply-language detection, Telegram chunking, the
 * grounding system prompt, and the agent loop — driven by a SCRIPTED model
 * and MOCKED tools so routing and the "draft never sends" rule are pinned
 * without any network or Supabase.
 */

import assert from "node:assert/strict";
import {
  isDirectorChat,
  replyLanguage,
  tgChunks,
  buildSystemPrompt,
  runAssistantLoop,
  OFFICE_ASSISTANT_TOOLS,
  DRAFT_TOOLS,
  ACTION_TOOLS,
  type LlmMessage,
  type LlmResponse,
  type ToolSpec,
} from "./officeAssistant";

console.log("officeAssistant.selftest.ts");

/* ── director identity ─────────────────────────────────────────────── */
{
  assert.equal(isDirectorChat("8752789909", "8752789909"), true, "same id is the director");
  assert.equal(isDirectorChat("111", "8752789909"), false, "other id is not the director");
  assert.equal(isDirectorChat("", "8752789909"), false, "empty chat id is never the director");
  assert.equal(isDirectorChat("8752789909", ""), false, "no configured director id → deny");
  assert.equal(isDirectorChat(" 8752789909 ", "8752789909"), true, "trims whitespace");
}

/* ── reply language ────────────────────────────────────────────────── */
{
  assert.equal(replyLanguage("आज कितनी फीस आई?"), "hi", "Devanagari → Hindi");
  assert.equal(replyLanguage("how much fee today"), "en", "Latin → English");
  assert.equal(replyLanguage("how much", "hi"), "hi", "locale hint wins over script");
  assert.equal(replyLanguage("आज", "en"), "en", "en locale hint wins");
}

/* ── Telegram chunking ─────────────────────────────────────────────── */
{
  assert.deepEqual(tgChunks("short"), ["short"], "short text is one chunk");
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
  const chunks = tgChunks(big, 4096);
  assert.ok(chunks.length > 1, "long text splits");
  assert.ok(chunks.every((c) => c.length <= 4096), "every chunk within 4096");
  assert.equal(chunks.join("\n"), big, "chunks rejoin to the original");
}

/* ── system prompt carries the grounding rule ──────────────────────── */
{
  const sys = buildSystemPrompt({ schoolName: "BHB", todayIso: "2026-10-28", language: "hi" });
  assert.ok(/never invent or guess/i.test(sys), "forbids inventing facts");
  assert.ok(/not known|not recorded|not on record/i.test(sys), "has the say-not-known rule");
  assert.ok(/NEVER send/i.test(sys), "outward messages are never auto-sent");
  assert.ok(/Hindi/.test(sys), "Hindi language line present for hi");
  const sysEn = buildSystemPrompt({ schoolName: "BHB", todayIso: "2026-10-28", language: "en" });
  assert.ok(/reply in English/i.test(sysEn), "English language line present for en");
}

/* ── tool catalogue sanity ─────────────────────────────────────────── */
{
  const names = OFFICE_ASSISTANT_TOOLS.map((t) => t.name);
  for (const n of ["ask_erp", "school_snapshot", "defaulters", "student_lookup", "staff_lookup", "report", "draft_notice", "draft_parent_message", "draft_staff_message", "create_task", "close_task", "snooze_task"]) {
    assert.ok(names.includes(n), `tool ${n} is defined`);
  }
  for (const t of OFFICE_ASSISTANT_TOOLS) {
    assert.equal(t.input_schema.additionalProperties, false, `${t.name} forbids extra args`);
    assert.equal(t.strict, true, `${t.name} is strict`);
  }
  // Every draft/action tool name must exist in the catalogue.
  for (const n of [...DRAFT_TOOLS, ...ACTION_TOOLS]) assert.ok(names.includes(n), `${n} is a real tool`);
}

/* ── scripted model helpers ────────────────────────────────────────── */
function textResp(text: string): LlmResponse {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
}
function toolResp(calls: { id: string; name: string; input: Record<string, unknown> }[]): LlmResponse {
  return {
    content: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    stop_reason: "tool_use",
    usage: { input_tokens: 20, output_tokens: 8 },
  };
}
const TOOLS: ToolSpec[] = OFFICE_ASSISTANT_TOOLS;

async function main() {
/* ── loop: a question routes through a tool, then answers ──────────── */
{
  const script: LlmResponse[] = [
    toolResp([{ id: "t1", name: "ask_erp", input: { question: "fee today" } }]),
    textResp("Today's collection is Rs. 1,200."),
  ];
  let i = 0;
  const ran: string[] = [];
  const captured: LlmMessage[][] = [];
  const out = await runAssistantLoop({
    system: "sys",
    firstUserText: "how much fee today",
    tools: TOOLS,
    callModel: async (messages) => {
      captured.push(JSON.parse(JSON.stringify(messages)));
      return script[i++];
    },
    runTool: async (name) => {
      ran.push(name);
      return { text: "Collection today: Rs. 1,200." };
    },
  });
  assert.equal(out.stoppedBy, "end_turn", "ends on end_turn");
  assert.deepEqual(out.toolsRun, ["ask_erp"], "ask_erp was called");
  assert.equal(out.terminal, false, "a question is not terminal");
  assert.equal(out.finalText, "Today's collection is Rs. 1,200.", "final answer surfaced");
  // The 2nd model call must have received a user turn with the tool_result.
  const second = captured[1];
  const lastUser = second[second.length - 1];
  assert.equal(lastUser.role, "user", "tool results go back as a user turn");
  assert.ok(Array.isArray(lastUser.content), "tool result content is blocks");
  const tr = (lastUser.content as { type: string }[]).find((b) => b.type === "tool_result");
  assert.ok(tr, "a tool_result block is sent back");
}

/* ── loop: a draft tool is terminal and NOTHING is sent ────────────── */
{
  const script: LlmResponse[] = [
    toolResp([{ id: "t1", name: "draft_notice", input: { audience: "whole_school", title: "Holiday", body: "School closed tomorrow." } }]),
    textResp("Draft school-wide notice is ready for your approval."),
  ];
  let i = 0;
  const ran: string[] = [];
  let sendCalled = false;
  const out = await runAssistantLoop({
    system: "sys",
    firstUserText: "tell all parents school is closed tomorrow",
    tools: TOOLS,
    callModel: async () => script[i++],
    runTool: async (name) => {
      ran.push(name);
      if (name === "draft_notice") return { text: "Draft ready.", terminal: true };
      // Any "send"-like executor would set this — it must never run.
      if (name.includes("send") || name === "approve_draft") sendCalled = true;
      return { text: "ok" };
    },
  });
  assert.equal(out.terminal, true, "a draft is terminal");
  assert.equal(out.stoppedBy, "terminal_tool", "loop stops after the terminal tool + one summary turn");
  assert.deepEqual(out.toolsRun, ["draft_notice"], "only the draft tool ran");
  assert.equal(sendCalled, false, "no send/approve executor ran — drafts never send");
  assert.equal(out.finalText, "Draft school-wide notice is ready for your approval.", "confirmation surfaced");
}

/* ── loop: parallel tool calls return in ONE user turn ─────────────── */
{
  const script: LlmResponse[] = [
    toolResp([
      { id: "a", name: "school_snapshot", input: {} },
      { id: "b", name: "defaulters", input: {} },
    ]),
    textResp("Here is today and the defaulters."),
  ];
  let i = 0;
  const captured: LlmMessage[][] = [];
  const out = await runAssistantLoop({
    system: "sys",
    firstUserText: "today and defaulters",
    tools: TOOLS,
    callModel: async (m) => {
      captured.push(JSON.parse(JSON.stringify(m)));
      return script[i++];
    },
    runTool: async () => ({ text: "data" }),
  });
  assert.deepEqual(out.toolsRun, ["school_snapshot", "defaulters"], "both tools ran");
  const second = captured[1];
  const lastUser = second[second.length - 1];
  const results = (lastUser.content as { type: string }[]).filter((b) => b.type === "tool_result");
  assert.equal(results.length, 2, "both tool_results in a single user turn");
}

/* ── loop: a refusal is surfaced, not crashed ──────────────────────── */
{
  const out = await runAssistantLoop({
    system: "sys",
    firstUserText: "do something disallowed",
    tools: TOOLS,
    callModel: async () => ({ content: [], stop_reason: "refusal", stop_details: { explanation: "no" } }),
    runTool: async () => ({ text: "x" }),
  });
  assert.equal(out.stoppedBy, "refusal", "refusal is reported");
}

/* ── loop: respects maxTurns (never infinite) ──────────────────────── */
{
  const out = await runAssistantLoop({
    system: "sys",
    firstUserText: "loop forever",
    tools: TOOLS,
    maxTurns: 3,
    callModel: async () => toolResp([{ id: "x", name: "school_snapshot", input: {} }]),
    runTool: async () => ({ text: "data" }),
  });
  assert.equal(out.stoppedBy, "max_turns", "bounded by maxTurns");
  assert.equal(out.toolsRun.length, 3, "one tool per turn, capped");
}
}

main()
  .then(() => console.log("OK — officeAssistant pure core (identity, language, chunking, grounding prompt, agent loop)"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

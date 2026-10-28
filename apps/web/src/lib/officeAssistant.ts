/**
 * Director console — the pure core of the conversational assistant.
 *
 * The director types plain Hindi or English to @BHB_Office_bot; n8n relays it
 * to /api/office/assistant, which runs a Claude tool-use agent whose tools
 * read the ERP's own grounded data and draft (never send) outward messages.
 *
 * Everything in THIS file is pure and has no server, Supabase or SDK imports,
 * so the self-test can drive the agent loop with a scripted model and mocked
 * tools. The server wiring (the real Anthropic client, the real tool
 * executors, logging, and the send-on-approve path) lives in
 * officeAssistant.server.ts.
 *
 * Grounding is the whole point: the system prompt forbids inventing a fee, a
 * date, a name, a number or a status — the agent answers only from what a
 * tool returned, and anything outward is returned as a DRAFT for the
 * director's one-tap approval. See [[cashfree-payment-gateway]] is unrelated;
 * the safety rule mirrors the WhatsApp bots' "say not known, never guess".
 */

/* ── Message / tool shapes (structural, not the Anthropic SDK types) ──────
 * Kept minimal and local so this file imports nothing. The server maps the
 * SDK's Message/ContentBlock onto these; the self-test fakes them directly. */

export type LlmTextBlock = { type: "text"; text: string };
export type LlmToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
/** thinking / redacted_thinking / anything else we pass back verbatim. */
export type LlmOtherBlock = { type: string; [k: string]: unknown };
export type LlmBlock = LlmTextBlock | LlmToolUseBlock | LlmOtherBlock;

export type LlmMessage = { role: "user" | "assistant"; content: string | LlmBlock[] };

export type LlmUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type LlmResponse = {
  content: LlmBlock[];
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string } | null;
  usage?: LlmUsage | null;
  model?: string;
};

/** The model call. Given the running message list, return one response. */
export type CallModel = (messages: LlmMessage[]) => Promise<LlmResponse>;

/** One tool run. `terminal` tells the loop to stop asking for more tools
 * (drafts and reports are terminal — the turn's job is done). */
export type ToolRunResult = { text: string; terminal?: boolean };
export type RunTool = (name: string, input: Record<string, unknown>) => Promise<ToolRunResult>;

/* ── Public contracts (route input / output) ─────────────────────────── */

export type DraftChannel = "whatsapp";
export type DraftAudience = "whole_school" | "class" | "parent" | "staff";

export type AssistantDraft = {
  audience: DraftAudience;
  /** Human label of who it goes to ("Class 5-A parents", "Sunita Devi"). */
  recipientLabel: string;
  /** Resolved send target, filled by the drafting tool (grounded). */
  recipient: {
    classLabel?: string;
    studentId?: string;
    staffId?: string;
    mobile?: string;
    /** How many families/people this reaches, when known. */
    count?: number;
  };
  title?: string;
  body: string;
  channel: DraftChannel;
  /** notice template vs free-text, language, etc. */
  meta?: Record<string, unknown>;
};

export type DirectorAction =
  | { kind: "approve_draft"; draft: AssistantDraft }
  | { kind: "reject_draft"; draftId?: string | number };

export type AssistantInput = {
  text: string;
  chat_id?: string;
  locale?: string;
  /** Structured action from a button tap — bypasses the model. */
  action?: DirectorAction;
};

export type AssistantOutput =
  | { kind: "answer"; text: string }
  | { kind: "draft"; draft: AssistantDraft; summary: string }
  | { kind: "file"; caption: string; fileBase64: string; mime: string; filename?: string }
  | { kind: "action_done"; text: string }
  | { kind: "error"; text: string };

export type AssistantReportKind =
  | "collection"
  | "attendance"
  | "defaulters"
  | "daily_brief"
  | "fleet";

/* ── Director identity ────────────────────────────────────────────────── */

/** Only the director's Telegram chat drives the console. */
export function isDirectorChat(
  chatId: string | null | undefined,
  directorChatId: string | null | undefined,
): boolean {
  const a = String(chatId ?? "").trim();
  const b = String(directorChatId ?? "").trim();
  return a.length > 0 && b.length > 0 && a === b;
}

/* ── Language ─────────────────────────────────────────────────────────── */

/** Devanagari anywhere → Hindi, else English. A `locale` hint wins. */
export function replyLanguage(text: string, locale?: string): "hi" | "en" {
  const loc = (locale || "").toLowerCase();
  if (loc.startsWith("hi")) return "hi";
  if (loc.startsWith("en")) return "en";
  return /[ऀ-ॿ]/.test(text || "") ? "hi" : "en";
}

/* ── Telegram chunking (4096 chars, cut on a line break) ─────────────── */

export function tgChunks(text: string, max = 4096): string[] {
  const s = String(text ?? "");
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max; // no good break — hard cut
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/* ── System prompt ────────────────────────────────────────────────────── */

export function buildSystemPrompt(opts: {
  schoolName: string;
  todayIso: string;
  language: "hi" | "en";
}): string {
  const langLine =
    opts.language === "hi"
      ? "The director wrote in Hindi — reply in Hindi (Devanagari)."
      : "The director wrote in English — reply in English.";
  return [
    `You are the office assistant for ${opts.schoolName}, answering ONLY to the school's director over Telegram. Today is ${opts.todayIso} (Asia/Kolkata).`,
    "",
    "GROUNDING — the one rule you must never break:",
    "- Answer only from what a tool returned this turn. Never invent or guess a fee, an amount, a date, a name, a phone number, a count or a status.",
    "- If a tool has no answer, or you are unsure, say plainly that it is not known / not recorded — in Hindi 'जानकारी नहीं है' / English 'not on record'. Do not fill the gap.",
    "- Do not state a number you did not get from a tool this turn. Prefer to call a tool over recalling anything.",
    "",
    "WHAT YOU CAN DO:",
    "- Answer questions about collections, dues, attendance, defaulters, students, staff, admissions — call ask_erp for free-form questions, or the specific tools (school_snapshot, defaulters, student_lookup, staff_lookup) when they fit.",
    "- Produce a report as a file with the report tool (collection, attendance, defaulters, daily_brief, fleet).",
    "- Open, create, close or snooze office tasks (list_tasks, create_task, close_task, snooze_task).",
    "",
    "SENDING — gated, never automatic:",
    "- Any message to a parent, a class, the whole school, or a staff member is OUTWARD. You NEVER send it. You call a draft tool (draft_notice, draft_fee_reminder, draft_parent_message, draft_staff_message), which prepares it for the director's approval. The director approves with a tap before anything goes out.",
    "- After a draft tool returns, do not call more tools — write one short sentence telling the director the draft is ready for approval.",
    "",
    langLine,
    "Be brief and concrete. Use plain text (Telegram HTML is added by the relay). Money is in rupees.",
  ].join("\n");
}

/* ── Tool catalogue (Anthropic tool JSON Schemas) ─────────────────────── */

export type ToolSpec = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  strict: true;
};

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolSpec {
  return {
    name,
    description,
    input_schema: { type: "object", properties, required, additionalProperties: false },
    strict: true,
  };
}

/** Tools that end the turn with a draft (nothing is sent). */
export const DRAFT_TOOLS = new Set([
  "draft_notice",
  "draft_fee_reminder",
  "draft_parent_message",
  "draft_staff_message",
]);
/** Tools that perform a task write (office_tasks). */
export const ACTION_TOOLS = new Set(["create_task", "close_task", "snooze_task"]);

export const OFFICE_ASSISTANT_TOOLS: ToolSpec[] = [
  tool(
    "ask_erp",
    "Answer a free-form question about the school's live records (collections over any period, dues ageing, class strength, attendance, admissions, staff on duty, concessions). Use this for anything numeric or factual you are not certain of. Returns grounded text.",
    { question: { type: "string", description: "The director's question, in English or Hindi." } },
    ["question"],
  ),
  tool(
    "school_snapshot",
    "Today's grounded dashboard: fee collection today and month-to-date, open dues, defaulter households, student attendance (present/absent/marked%), staff present/absent, active students, admissions pipeline, and alerts. Use for 'how is today', 'aaj ka hisab'.",
    {},
  ),
  tool(
    "defaulters",
    "List fee defaulters (households with overdue dues), most overdue first. Optionally filter by a class label. Returns name, class, overdue days and overdue amount.",
    {
      class_label: { type: ["string", "null"], description: "e.g. 'Class 5' or '5-A'; null for all classes." },
      limit: { type: ["integer", "null"], description: "Max rows (default 20)." },
    },
  ),
  tool(
    "student_lookup",
    "Find a student by name or admission number and return their record (class, household contact) plus fee dues. Use before drafting a message to one family.",
    { query: { type: "string", description: "Name or admission number." } },
    ["query"],
  ),
  tool(
    "staff_lookup",
    "Find a staff member by name and return their record plus today's attendance status and pending/approved leave.",
    { query: { type: "string", description: "Staff name." } },
    ["query"],
  ),
  tool(
    "list_tasks",
    "List office tasks. which='open' for open/doing tasks, which='pending_drafts' for replies waiting for the director's approval.",
    { which: { type: ["string", "null"], enum: ["open", "pending_drafts", null], description: "Default 'open'." } },
  ),
  tool(
    "report",
    "Generate a director report as a PDF file to send to the director. kind is one of: collection (today's money by mode), attendance (today by class), defaulters (overdue list), daily_brief (the full morning brief), fleet (transport). Call this once; the file is delivered automatically.",
    { kind: { type: "string", enum: ["collection", "attendance", "defaulters", "daily_brief", "fleet"] } },
    ["kind"],
  ),
  tool(
    "draft_notice",
    "Prepare (do NOT send) a notice for the whole school or one class. Returns a draft for the director's approval. audience='whole_school' or 'class' (then set class_label).",
    {
      audience: { type: "string", enum: ["whole_school", "class"] },
      class_label: { type: ["string", "null"], description: "Required when audience='class'." },
      title: { type: "string", description: "Short first line / subject." },
      body: { type: "string", description: "The notice text, in the parents' language." },
    },
    ["audience", "title", "body"],
  ),
  tool(
    "draft_fee_reminder",
    "Prepare (do NOT send) a fee reminder for a class or one student. Returns a draft for approval.",
    {
      class_label: { type: ["string", "null"], description: "Reminder to a whole class's defaulters." },
      student_query: { type: ["string", "null"], description: "Reminder to one student's family (name/admission no)." },
      body: { type: ["string", "null"], description: "Optional custom text; omit to use the standard reminder." },
    },
  ),
  tool(
    "draft_parent_message",
    "Prepare (do NOT send) a WhatsApp message to one student's parents. Returns a draft for approval.",
    {
      student_query: { type: "string", description: "Student name or admission number." },
      text: { type: "string", description: "The message, in the family's language." },
    },
    ["student_query", "text"],
  ),
  tool(
    "draft_staff_message",
    "Prepare (do NOT send) a WhatsApp message to one staff member. Returns a draft for approval.",
    {
      staff_query: { type: "string", description: "Staff name." },
      text: { type: "string", description: "The message." },
    },
    ["staff_query", "text"],
  ),
  tool(
    "create_task",
    "Create an office task (and assign it to a role). Roles: director, receptionist, academic_incharge, principal, accounts, transport.",
    {
      to_role: { type: "string", description: "Who it is for." },
      title: { type: "string" },
      detail: { type: ["string", "null"] },
      due_on: { type: ["string", "null"], description: "YYYY-MM-DD, or null." },
    },
    ["to_role", "title"],
  ),
  tool("close_task", "Mark an open office task done.", { id: { type: "integer" } }, ["id"]),
  tool("snooze_task", "Snooze an open office task to tomorrow.", { id: { type: "integer" } }, ["id"]),
];

/* ── Block helpers ────────────────────────────────────────────────────── */

export function textOf(blocks: LlmBlock[]): string {
  return blocks
    .filter((b): b is LlmTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function toolUsesOf(blocks: LlmBlock[]): LlmToolUseBlock[] {
  return blocks.filter((b): b is LlmToolUseBlock => b.type === "tool_use");
}

/* ── The agent loop (pure: injected model + tools) ───────────────────── */

export type LoopOutcome = {
  finalText: string;
  toolsRun: string[];
  /** true if a draft/report tool ran (a terminal tool). */
  terminal: boolean;
  usages: LlmUsage[];
  stoppedBy: "end_turn" | "max_turns" | "refusal" | "terminal_tool";
  refusalExplanation?: string;
};

/**
 * Run the request → tool → request loop until the model is done.
 *
 * The model (callModel) and the tools (runTool) are injected, so the
 * self-test drives this with a scripted model and mocks. A terminal tool
 * (a draft or a report) ends the loop after one more model turn so the
 * agent can write its one-line confirmation but cannot keep acting.
 */
export async function runAssistantLoop(opts: {
  system: string;
  firstUserText: string;
  tools: ToolSpec[];
  callModel: CallModel;
  runTool: RunTool;
  maxTurns?: number;
}): Promise<LoopOutcome> {
  const maxTurns = Math.max(1, opts.maxTurns ?? 6);
  const messages: LlmMessage[] = [{ role: "user", content: opts.firstUserText }];
  const toolsRun: string[] = [];
  const usages: LlmUsage[] = [];
  let terminal = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await opts.callModel(messages);
    if (res.usage) usages.push(res.usage);

    if (res.stop_reason === "refusal") {
      return {
        finalText: "",
        toolsRun,
        terminal,
        usages,
        stoppedBy: "refusal",
        refusalExplanation: res.stop_details?.explanation || "declined",
      };
    }

    // Append the assistant turn verbatim (thinking blocks included) so the
    // next request is a valid continuation.
    messages.push({ role: "assistant", content: res.content });

    const toolUses = toolUsesOf(res.content);
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      return {
        finalText: textOf(res.content),
        toolsRun,
        terminal,
        usages,
        stoppedBy: terminal ? "terminal_tool" : "end_turn",
      };
    }

    // Execute every requested tool and return ALL results in one user turn.
    const results: LlmBlock[] = [];
    let hitTerminal = false;
    for (const tu of toolUses) {
      toolsRun.push(tu.name);
      let out: ToolRunResult;
      try {
        out = await opts.runTool(tu.name, tu.input || {});
      } catch (e) {
        out = { text: `Tool error: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (out.terminal) {
        hitTerminal = true;
        terminal = true;
      }
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out.text,
      } as LlmOtherBlock);
    }
    messages.push({ role: "user", content: results });

    if (hitTerminal) {
      // One more model turn for the confirmation sentence, then stop — but
      // give it no tools-required nudge; it should just summarise.
      const res2 = await opts.callModel(messages);
      if (res2.usage) usages.push(res2.usage);
      if (res2.stop_reason === "refusal") {
        return { finalText: "", toolsRun, terminal, usages, stoppedBy: "refusal", refusalExplanation: res2.stop_details?.explanation || "declined" };
      }
      return {
        finalText: textOf(res2.content),
        toolsRun,
        terminal,
        usages,
        stoppedBy: "terminal_tool",
      };
    }
  }

  return { finalText: "", toolsRun, terminal, usages, stoppedBy: "max_turns" };
}

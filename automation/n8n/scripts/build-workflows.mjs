#!/usr/bin/env node
/**
 * Builds the importable n8n workflows in ../workflows from the charters in
 * ../charters. The JSON files are what the director imports; this script is
 * their source, so a charter edit is `node scripts/build-workflows.mjs` away
 * from the workflows, and the three files share one set of helpers (Claude
 * call + usage ledger, Supabase REST, WhatsApp through the ERP).
 *
 * No dependencies. Node 18+.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const charterDir = path.join(root, "charters");
const outDir = path.join(root, "workflows");

/* ─── charters → system prompts ─────────────────────────────── */

const readCharter = (name) =>
  fs.readFileSync(path.join(charterDir, `${name}.md`), "utf8").trim();

const HOUSE_RULES = readCharter("_house-rules");
/** One cached system block per role: house rules first, then the charter. */
const systemFor = (role) => `${HOUSE_RULES}\n\n---\n\n${readCharter(role)}`;

const ROLE_CHARTERS = {
  receptionist: systemFor("receptionist"),
  academic_incharge: systemFor("academic-incharge"),
  chair: systemFor("chair"),
};

const MODELS = { sort: "claude-haiku-5-5", write: "claude-sonnet-5-5" };

/* ─── workflow builder ──────────────────────────────────────── */

class Workflow {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.nodes = [];
    this.connections = {};
    this.col = 0;
  }

  /** Add a node. `extra` carries node-level flags (executeOnce, onError…). */
  add(name, type, typeVersion, parameters, extra = {}) {
    if (this.nodes.some((n) => n.name === name)) {
      throw new Error(`duplicate node name: ${name}`);
    }
    const { row = 0, ...flags } = extra;
    const node = {
      parameters,
      id: crypto.randomUUID(),
      name,
      type,
      typeVersion,
      position: [this.col * 260, row * 220],
      ...flags,
    };
    this.col += 1;
    this.nodes.push(node);
    return name;
  }

  link(from, to, outputIndex = 0) {
    for (const n of [from, to]) {
      if (!this.nodes.some((x) => x.name === n)) throw new Error(`link to unknown node: ${n}`);
    }
    const c = (this.connections[from] ??= { main: [] });
    while (c.main.length <= outputIndex) c.main.push([]);
    c.main[outputIndex].push({ node: to, type: "main", index: 0 });
    return to;
  }

  chain(...names) {
    for (let i = 1; i < names.length; i += 1) this.link(names[i - 1], names[i]);
    return names[names.length - 1];
  }

  toJSON() {
    return {
      name: this.name,
      nodes: this.nodes,
      connections: this.connections,
      settings: {
        executionOrder: "v1",
        timezone: "Asia/Kolkata",
        saveExecutionProgress: true,
        saveManualExecutions: true,
      },
      active: false,
      pinData: {},
      meta: { templateCredsSetupCompleted: false, description: this.description },
      tags: [],
    };
  }
}

/* ─── node factories ────────────────────────────────────────── */

const code = (wf, name, js, { each = false, ...extra } = {}) =>
  wf.add(
    name,
    "n8n-nodes-base.code",
    2,
    each ? { mode: "runOnceForEachItem", jsCode: js } : { jsCode: js },
    extra,
  );

const cron = (wf, name, expression) =>
  wf.add(name, "n8n-nodes-base.scheduleTrigger", 1.2, {
    rule: { interval: [{ field: "cronExpression", expression }] },
  });

const SB_HEADERS = [
  { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
  { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
  { name: "Content-Type", value: "application/json" },
];

/** GET from PostgREST. `query` is an expression-free or `={{ }}` string
 * appended after `?`. Runs once per execution and always emits an item
 * (an empty one when the table returns []), so chains of reads keep going. */
const sbGet = (wf, name, table, query, extra = {}) =>
  wf.add(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "GET",
      url: `=${"{{ $env.SUPABASE_URL }}"}/rest/v1/${table}?${query}`,
      sendHeaders: true,
      headerParameters: { parameters: SB_HEADERS },
      options: { timeout: 30000 },
    },
    { executeOnce: true, alwaysOutputData: true, ...extra },
  );

/** POST rows to a table. The input item carries the row(s) in `$json[field]`. */
const sbInsert = (wf, name, table, field = "row", extra = {}) =>
  wf.add(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: `=${"{{ $env.SUPABASE_URL }}"}/rest/v1/${table}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [...SB_HEADERS, { name: "Prefer", value: "return=representation" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify($json.${field}) }}`,
      options: { timeout: 30000 },
    },
    extra,
  );

/** PATCH one office_tasks row: `$json.task_id` + `$json.patch`. */
const sbPatchTask = (wf, name, extra = {}) =>
  wf.add(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "PATCH",
      url: "={{ $env.SUPABASE_URL }}/rest/v1/office_tasks?id=eq.{{ $json.task_id }}&tenant_id=eq.{{ $env.OFFICE_TENANT_ID }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [...SB_HEADERS, { name: "Prefer", value: "return=representation" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.patch) }}",
      options: { timeout: 30000 },
    },
    extra,
  );

/** Usage ledger: the leaf after every Claude call. */
const logUsage = (wf, name) =>
  sbInsert(wf, name, "office_ai_usage", "usage_row", { onError: "continueRegularOutput" });

/* Shared JS snippets (plain strings, concatenated into Code nodes). */

const JS_PRICES = `
// USD per million tokens (console.anthropic.com pricing, Oct 2026).
// Cache reads are 10% of input, cache writes 125% (5-minute TTL).
const PRICES = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2.00, output: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
};
function priceFor(model) {
  if (PRICES[model]) return PRICES[model];
  if (String(model).startsWith('claude-haiku')) return PRICES['claude-haiku-5-5'];
  return PRICES['claude-sonnet-5-5'];
}
function usageRow(res, workflow, role) {
  const u = res.usage || {};
  const p = priceFor(res.model);
  const n = (k) => Number(u[k] || 0);
  const cost = (n('input_tokens') * p.input + n('output_tokens') * p.output
    + n('cache_read_input_tokens') * p.cacheRead + n('cache_creation_input_tokens') * p.cacheWrite) / 1e6;
  return {
    tenant_id: $env.OFFICE_TENANT_ID, workflow, role, model: res.model || '',
    input_tokens: n('input_tokens'), output_tokens: n('output_tokens'),
    cache_read_input_tokens: n('cache_read_input_tokens'),
    cache_creation_input_tokens: n('cache_creation_input_tokens'),
    est_cost_usd: Number(cost.toFixed(6)),
  };
}
`;

const JS_PARSE = `
// Text blocks only: the model may also return (empty) thinking blocks.
function claudeText(res) {
  return (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\\n').trim();
}
function parseJsonLoose(text) {
  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/);
  const s = fenced ? fenced[1] : text;
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('no JSON object in reply');
  return JSON.parse(s.slice(i, j + 1));
}
`;

const JS_REQUEST = `
// One Claude Messages request. The charter is the cached system block.
function claudeRequest({ model, system, user, maxTokens, effort }) {
  return {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort },
  };
}
`;

const JS_DATES = `
function istNow() { return new Date(Date.now() + 5.5 * 3600 * 1000); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function academicYearCode(d) {
  const y = d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return y + '-' + String((y + 1) % 100).padStart(2, '0');
}
`;

/**
 * Claude call + parse + usage leaf. Returns the name of the parse node, whose
 * item is { text, parsed, parse_error, stop_reason, usage_row, ...carry }.
 * `carryFrom` is the node whose paired item is spread into the output.
 */
function claudeCall(wf, { key, workflow, role, carryFrom, each = true, linkFrom = carryFrom }) {
  const http = wf.add(
    `Claude: ${key}`,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-api-key", value: "={{ $env.ANTHROPIC_API_KEY }}" },
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.request) }}",
      options: { timeout: 180000 },
    },
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  );
  const carry = carryFrom
    ? each
      ? `const carry = $('${carryFrom}').item.json;`
      : `const carry = $('${carryFrom}').first().json;`
    : "const carry = {};";
  const input = each ? "$input.item.json" : "$input.first().json";
  const parse = code(
    wf,
    `Parse: ${key}`,
    `${JS_PRICES}${JS_PARSE}
const res = ${input};
${carry}
const text = claudeText(res);
let parsed = null; let parse_error = '';
if (res.stop_reason === 'refusal') {
  parse_error = 'refusal: ' + ((res.stop_details && res.stop_details.explanation) || 'declined');
} else {
  try { parsed = parseJsonLoose(text); } catch (e) { parse_error = String(e && e.message || e); }
}
const { request, ...rest } = carry;
const out = { ...rest, text, parsed, parse_error, stop_reason: res.stop_reason || '', usage_row: usageRow(res, ${JSON.stringify(workflow)}, ${JSON.stringify(role)}) };
return ${each ? "{ json: out }" : "[{ json: out }]"};
`,
    { each },
  );
  const usage = logUsage(wf, `Log usage: ${key}`);
  if (linkFrom) wf.link(linkFrom, http);
  wf.chain(http, parse);
  wf.link(parse, usage);
  return parse;
}

/**
 * WhatsApp through the ERP. The input item carries `$json.wa_text` and
 * `$json.wa_to` (array of 10-digit mobiles). Free text first; when Meta's
 * 24-hour window is closed and OFFICE_WA_TEMPLATE is set, the same text is
 * resent as that template's single body variable.
 */
function waChain(wf, prefix) {
  const build = code(
    wf,
    `${prefix}: build WhatsApp`,
    `
const src = $input.first().json;
const to = [...new Set((src.wa_to || []).map((m) => String(m || '').replace(/\\D/g, '').slice(-10)).filter((m) => m.length === 10))];
const body = String(src.wa_text || '').slice(0, 4000);
if (!to.length || !body) return [];
return [{ json: { wa: {
  module: 'notifications',
  messages: to.map((mobile) => ({ mobile, body, urgent: true, messageId: 'office-' + Date.now() + '-' + mobile })),
}, wa_text: body, wa_to: to } }];
`,
  );
  const send = wf.add(
    `${prefix}: send WhatsApp`,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.ERP_BASE_URL }}/api/wa/dispatch",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-wa-dispatch-secret", value: "={{ $env.WA_DISPATCH_SECRET }}" },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.wa) }}",
      options: { timeout: 60000 },
    },
    { onError: "continueRegularOutput" },
  );
  const fallback = code(
    wf,
    `${prefix}: template fallback?`,
    `
// Meta refuses free text when the recipient has not written to the school
// number in 24 hours. The ERP's dispatch route reports that per number.
const res = $input.first().json;
const built = $('${prefix}: build WhatsApp').first().json;
const tpl = ($env.OFFICE_WA_TEMPLATE || '').trim();
if (!tpl) return [];
const failed = (res.results || []).filter((r) => r.status === 'failed' && /24h|template/i.test(String(r.error || '')));
if (!failed.length) return [];
// Meta rejects newlines, tabs and 4+ spaces inside a template parameter.
const flat = (v, max) => String(v || '').replace(/\\s*[\\r\\n\\t]+\\s*/g, ' | ').replace(/ {4,}/g, '   ').trim().slice(0, max);
const raw = String(built.wa_text || '');
// OFFICE_WA_TEMPLATE_KEYS lists the template's body variables in order.
// One key: the whole text goes in it. Three keys (the ERP's school-notice
// template: schoolName, noticeTitle, noticeBody): school name, first line, rest.
const keys = ($env.OFFICE_WA_TEMPLATE_KEYS || '1').split(',').map((k) => k.trim()).filter(Boolean);
const nl = raw.indexOf('\\n');
const title = flat(nl > 0 ? raw.slice(0, nl) : raw, 120);
const rest = flat(nl > 0 ? raw.slice(nl + 1) : raw, 1000);
let variables;
if (keys.length >= 3) variables = { [keys[0]]: $env.OFFICE_SCHOOL_NAME || 'BHB International School', [keys[1]]: title, [keys[2]]: rest };
else if (keys.length === 2) variables = { [keys[0]]: title, [keys[1]]: rest };
else variables = { [keys[0]]: flat(raw, 1000) };
return [{ json: { wa: {
  module: 'notifications',
  messages: failed.map((r) => ({
    mobile: r.mobile, urgent: true, messageId: 'office-tpl-' + Date.now() + '-' + r.mobile,
    template: { name: tpl, language: $env.OFFICE_WA_TEMPLATE_LANG || 'en', variableKeys: keys, variables },
  })),
} } }];
`,
  );
  const sendTpl = wf.add(
    `${prefix}: send template`,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.ERP_BASE_URL }}/api/wa/dispatch",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-wa-dispatch-secret", value: "={{ $env.WA_DISPATCH_SECRET }}" },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.wa) }}",
      options: { timeout: 60000 },
    },
    { onError: "continueRegularOutput" },
  );
  wf.chain(build, send, fallback, sendTpl);
  return build;
}

/** Switch on `$json[field]` with one named output per value. */
function switchOn(wf, name, field, values) {
  return wf.add(name, "n8n-nodes-base.switch", 3.2, {
    rules: {
      values: values.map((v) => ({
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: crypto.randomUUID(),
              leftValue: `={{ $json.${field} }}`,
              rightValue: v,
              operator: { type: "string", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        renameOutput: true,
        outputKey: v,
      })),
    },
    options: {},
  });
}

const TENANT = "{{ $env.OFFICE_TENANT_ID }}";

/* ═══════════════════════════════════════════════════════════════
   1. Receptionist
   ═══════════════════════════════════════════════════════════════ */

function buildReceptionist() {
  const wf = new Workflow(
    "Office — Receptionist",
    "Sorts every email to the school inbox (Haiku), drafts parent/vendor replies (Sonnet) for the director's APPROVE/REJECT on WhatsApp, routes CBSE/UDISE+ items to the Academic Incharge, logs the rest.",
  );
  const W = "receptionist";

  /* ── A. New mail ── */
  const trigger = wf.add("New mail in school inbox", "n8n-nodes-base.gmailTrigger", 1.2, {
    pollTimes: { item: [{ mode: "everyMinute" }] },
    simple: false,
    filters: { labelIds: ["INBOX"] },
    options: {},
  });

  const buildClassify = code(
    wf,
    "Build: classify",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.receptionist)};
const m = $input.item.json;
// The Gmail trigger's shape differs between "simplify" on and off; read both.
const addr = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v.value) && v.value[0]) return v.value[0].address || v.text || '';
  return v.text || v.address || '';
};
const nameOf = (v) => (v && Array.isArray(v.value) && v.value[0] && v.value[0].name) || '';
const from = addr(m.from) || m.From || '';
const subject = m.subject || m.Subject || '(no subject)';
const date = m.date || m.Date || '';
const bodyRaw = m.text || m.textPlain || m.snippet || (typeof m.html === 'string' ? m.html.replace(/<[^>]+>/g, ' ') : '') || '';
const body = String(bodyRaw).replace(/\\s+\\n/g, '\\n').trim().slice(0, 6000);
const mail = { id: m.id, threadId: m.threadId, from, from_name: nameOf(m.from), subject, date, text: body, inbox: $env.SCHOOL_INBOX || '' };
const user = 'Classify this email to the school inbox. Return only the JSON object described in your charter under "Classification".\\n\\n'
  + 'From: ' + from + (mail.from_name ? ' (' + mail.from_name + ')' : '') + '\\nSubject: ' + subject + '\\nDate: ' + date + '\\n\\n' + (body || '(empty body)');
return { json: { mail, request: claudeRequest({ model: ${JSON.stringify(MODELS.sort)}, system: SYSTEM, user, maxTokens: 400, effort: 'low' }) } };
`,
    { each: true },
  );
  wf.chain(trigger, buildClassify);

  const parseClassify = claudeCall(wf, { key: "classify", workflow: W, role: "receptionist", carryFrom: buildClassify });

  const route = code(
    wf,
    "Route",
    `
const it = $input.item.json;
const cls = it.parsed || {};
const category = ['cbse', 'udise', 'vendor', 'parent', 'spam', 'other'].includes(cls.category) ? cls.category : 'other';
const needsReply = cls.needs_reply !== false;
let routeKey = 'note';
if (it.parse_error) routeKey = 'note';
else if ((category === 'parent' || category === 'vendor') && needsReply) routeKey = 'reply';
else if (category === 'cbse' || category === 'udise') routeKey = 'task';
return { json: { mail: it.mail, cls: { ...cls, category, needs_reply: needsReply }, parse_error: it.parse_error || '', route: routeKey } };
`,
    { each: true },
  );
  wf.chain(parseClassify, route);

  const sw = switchOn(wf, "Switch: by route", "route", ["reply", "task", "note"]);
  wf.link(route, sw);

  // Run status note (one row per run, parallel to the switch).
  const runNote = code(
    wf,
    "Build: run status note",
    `
const items = $input.all().map((i) => i.json);
const count = (k) => items.filter((i) => i.route === k).length;
const byCat = {};
for (const i of items) byCat[i.cls.category] = (byCat[i.cls.category] || 0) + 1;
const body = 'Inbox run: ' + items.length + ' new mail — ' + count('reply') + ' draft(s) waiting for the director, '
  + count('task') + ' routed to the Academic Incharge, ' + count('note') + ' filed. By category: '
  + Object.entries(byCat).map(([k, v]) => k + ' ' + v).join(', ') + '.';
return [{ json: { row: { tenant_id: $env.OFFICE_TENANT_ID, role: 'receptionist', body, facts: { mails: items.length, drafts: count('reply'), routed: count('task'), filed: count('note'), by_category: byCat, subjects: items.map((i) => i.mail.subject).slice(0, 20) } } } }];
`,
  );
  wf.link(route, runNote);
  wf.link(runNote, sbInsert(wf, "Insert: run status note", "office_notes"));

  /* reply branch */
  const buildDraft = code(
    wf,
    "Build: draft",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.receptionist)};
const it = $input.item.json;
const lang = it.cls.language === 'hi' ? 'Hindi (Devanagari)' : 'English';
const user = 'Draft the reply to this ' + it.cls.category + ' email in ' + lang + '. The classification was: ' + JSON.stringify(it.cls)
  + '. Return only the JSON object described in your charter under "Draft". Do not promise any fee, date, seat, refund or meeting; put such asks in open_questions.\\n\\n'
  + 'From: ' + it.mail.from + (it.mail.from_name ? ' (' + it.mail.from_name + ')' : '') + '\\nSubject: ' + it.mail.subject + '\\nDate: ' + it.mail.date + '\\n\\n' + (it.mail.text || '(empty body)');
return { json: { ...it, request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 1200, effort: 'medium' }) } };
`,
    { each: true, row: 0 },
  );
  wf.link(sw, buildDraft, 0);
  const parseDraft = claudeCall(wf, { key: "draft", workflow: W, role: "receptionist", carryFrom: buildDraft });

  const buildApproval = code(
    wf,
    "Build: approval task",
    `
const it = $input.item.json;
const d = it.parsed || {};
const body = String(d.body || it.text || '').trim();
const subject = String(d.subject || ('Re: ' + it.mail.subject)).slice(0, 200);
const who = it.mail.from_name || it.mail.from;
const row = {
  tenant_id: $env.OFFICE_TENANT_ID,
  from_role: 'receptionist', to_role: 'director',
  title: ('Reply to ' + who + ': ' + it.mail.subject).slice(0, 80),
  detail: (it.cls.summary || '') + '\\n\\n' + body,
  status: 'open', source: 'receptionist', approval_state: it.parse_error ? 'none' : 'pending',
  due_on: it.cls.deadline || null,
  payload: {
    kind: 'email_reply', category: it.cls.category, language: d.language || it.cls.language || '',
    gmail_message_id: it.mail.id, gmail_thread_id: it.mail.threadId, to: it.mail.from, to_name: it.mail.from_name,
    in_reply_to_subject: it.mail.subject, subject, body,
    open_questions: d.open_questions || [], note_for_director: d.note_for_director || '',
    draft_error: it.parse_error || '',
  },
};
return { json: { row } };
`,
    { each: true },
  );
  wf.chain(parseDraft, buildApproval, sbInsert(wf, "Insert: approval task", "office_tasks"));

  const buildDirectorWa = code(
    wf,
    "Build: director approval message",
    `
const rows = $input.all().map((i) => i.json);
const lines = [];
for (const t of rows) {
  const p = t.payload || {};
  if (p.draft_error) { lines.push('⚠️ Could not draft a reply for "' + p.in_reply_to_subject + '" (' + p.draft_error + '). Task #' + t.id + ' is open for the office.'); continue; }
  lines.push('✉️ Draft #' + t.id + ' (' + p.category + ', ' + (p.language || '?') + ')\\nTo: ' + (p.to_name ? p.to_name + ' <' + p.to + '>' : p.to)
    + '\\nSubject: ' + p.subject + '\\n\\n' + p.body
    + (p.open_questions && p.open_questions.length ? '\\n\\nOpen: ' + p.open_questions.join('; ') : '')
    + (p.note_for_director ? '\\nNote: ' + p.note_for_director : '')
    + '\\n\\nReply APPROVE ' + t.id + ' to send, or REJECT ' + t.id + '.');
}
if (!lines.length) return [];
return [{ json: { wa_text: lines.join('\\n\\n— — —\\n\\n'), wa_to: [$env.DIRECTOR_WA_MOBILE] } }];
`,
  );
  wf.link("Insert: approval task", buildDirectorWa);
  wf.link(buildDirectorWa, waChain(wf, "Approval"));

  /* task branch */
  const buildAcademicTask = code(
    wf,
    "Build: academic task",
    `
const it = $input.item.json;
const c = it.cls;
const row = {
  tenant_id: $env.OFFICE_TENANT_ID,
  from_role: 'receptionist', to_role: 'academic_incharge',
  title: (c.category.toUpperCase() + ': ' + (c.summary || it.mail.subject)).slice(0, 80),
  detail: (c.summary || '') + '\\nFrom: ' + it.mail.from + '\\nSubject: ' + it.mail.subject + (c.deadline ? '\\nDeadline: ' + c.deadline : ''),
  status: 'open', source: 'receptionist', approval_state: 'none',
  due_on: c.deadline || null,
  payload: { kind: 'email_item', category: c.category, gmail_message_id: it.mail.id, gmail_thread_id: it.mail.threadId, from: it.mail.from, subject: it.mail.subject },
};
return { json: { row } };
`,
    { each: true, row: 1 },
  );
  wf.link(sw, buildAcademicTask, 1);
  wf.link(buildAcademicTask, sbInsert(wf, "Insert: academic task", "office_tasks", "row", { row: 1 }));

  /* note branch */
  const buildNote = code(
    wf,
    "Build: filed note",
    `
const it = $input.item.json;
const c = it.cls;
const body = (it.parse_error ? 'unsorted' : c.category) + ': ' + (c.summary || '(no summary)') + ' — from ' + it.mail.from + ' "' + it.mail.subject + '"' + (c.deadline ? ' (deadline ' + c.deadline + ')' : '');
const row = { tenant_id: $env.OFFICE_TENANT_ID, role: 'receptionist', body: body.slice(0, 1000),
  facts: { category: c.category, from: it.mail.from, subject: it.mail.subject, gmail_message_id: it.mail.id, deadline: c.deadline || null, parse_error: it.parse_error || '' } };
return { json: { row } };
`,
    { each: true, row: 2 },
  );
  wf.link(sw, buildNote, 2);
  wf.link(buildNote, sbInsert(wf, "Insert: filed note", "office_notes", "row", { row: 2 }));

  /* ── B. Director's decisions (poll) ── */
  const poll = cron(wf, "Every 5 minutes", "*/5 * * * *");
  const pending = sbGet(
    wf,
    "Fetch: pending drafts",
    "office_tasks",
    `tenant_id=eq.${TENANT}&approval_state=eq.pending&source=eq.receptionist&status=eq.open&select=*&order=created_at.asc&limit=50`,
  );
  const collect = code(
    wf,
    "Collect: pending",
    `
const pending = $input.all().map((i) => i.json).filter((r) => r && r.id);
if (!pending.length) return [];
const oldest = pending.map((r) => r.created_at).sort()[0];
return [{ json: { pending, since: oldest } }];
`,
  );
  const replies = sbGet(
    wf,
    "Fetch: director replies",
    "wa_messages",
    `tenant_id=eq.${TENANT}&mobile10=eq.{{ String($env.DIRECTOR_WA_MOBILE || '').replace(/\\D/g, '').slice(-10) }}&direction=eq.in&kind=eq.text&created_at=gte.{{ encodeURIComponent($json.since) }}&select=id,body,created_at&order=created_at.asc&limit=200`,
  );
  const match = code(
    wf,
    "Match: decisions",
    `
const replies = $input.all().map((i) => i.json).filter((r) => r && r.id);
const pending = $('Collect: pending').first().json.pending;
// (?![a-z]) instead of \\b: JS word boundaries are ASCII-only, so Devanagari words never matched.
const APPROVE = /^\\s*(approve|approved|ok|okay|yes|send|haan|ha|हाँ|हां|ठीक|भेज)(?![a-z])[^0-9]*#?\\s*(\\d+)?/i;
const REJECT = /^\\s*(reject|rejected|no|cancel|nahi|nahin|नहीं|रद्द)(?![a-z])[^0-9]*#?\\s*(\\d+)?/i;
const out = []; const decided = new Set();
for (const r of replies) {
  const body = String(r.body || '');
  let decision = null; let m = body.match(APPROVE);
  if (m) decision = 'approve'; else { m = body.match(REJECT); if (m) decision = 'reject'; }
  if (!decision) continue;
  const num = m[2] ? Number(m[2]) : null;
  let task = null;
  if (num) task = pending.find((t) => Number(t.id) === num);
  else if (pending.length === 1) task = pending[0];
  if (!task || decided.has(task.id)) continue;
  if (new Date(r.created_at) < new Date(task.created_at)) continue;
  decided.add(task.id);
  out.push({ json: { decision, task, reply_id: r.id, reply_body: body.slice(0, 200) } });
}
return out;
`,
  );
  wf.chain(poll, pending, collect, replies, match);

  const decSwitch = switchOn(wf, "Switch: decision", "decision", ["approve", "reject"]);
  wf.link(match, decSwitch);

  const gmailReply = wf.add(
    "Gmail: send approved reply",
    "n8n-nodes-base.gmail",
    2.1,
    {
      resource: "message",
      operation: "reply",
      messageId: "={{ $json.task.payload.gmail_message_id }}",
      emailType: "text",
      message: "={{ $json.task.payload.body }}",
      options: {},
    },
  );
  wf.link(decSwitch, gmailReply, 0);

  const patchApproved = code(
    wf,
    "Build: approved patch",
    `
const d = $('Match: decisions').item.json;
const sent = $input.item.json;
const now = new Date().toISOString();
return { json: { task_id: d.task.id, patch: { approval_state: 'approved', status: 'done', decided_by: 'director', decided_at: now, updated_at: now,
  payload: { ...d.task.payload, decision_reply: d.reply_body, sent_at: now, gmail_sent_id: sent.id || '' } },
  ack: '✅ Sent reply #' + d.task.id + ' to ' + (d.task.payload.to_name || d.task.payload.to) + '.' } };
`,
    { each: true },
  );
  wf.link(gmailReply, patchApproved);

  const patchRejected = code(
    wf,
    "Build: rejected patch",
    `
const d = $input.item.json;
const now = new Date().toISOString();
return { json: { task_id: d.task.id, patch: { approval_state: 'rejected', status: 'cancelled', decided_by: 'director', decided_at: now, updated_at: now,
  payload: { ...d.task.payload, decision_reply: d.reply_body } },
  ack: '🚫 Draft #' + d.task.id + ' rejected — nothing sent to ' + (d.task.payload.to_name || d.task.payload.to) + '.' } };
`,
    { each: true, row: 1 },
  );
  wf.link(decSwitch, patchRejected, 1);

  const patch = sbPatchTask(wf, "Patch: task decided");
  wf.link(patchApproved, patch);
  wf.link(patchRejected, patch);

  const ack = code(
    wf,
    "Build: acknowledgement",
    `
// The PATCH answers with the updated row; the ack text lives on the item
// that built the patch. Either builder may not have run this execution.
const built = [];
for (const name of ['Build: approved patch', 'Build: rejected patch']) {
  try { for (const x of $(name).all()) built.push(x.json); } catch (e) { /* branch did not run */ }
}
const rows = $input.all().map((i) => i.json);
const acks = rows.map((row) => (built.find((b) => String(b.task_id) === String(row.id)) || {}).ack).filter(Boolean);
if (!acks.length) return [];
return [{ json: { wa_text: acks.join('\\n'), wa_to: [$env.DIRECTOR_WA_MOBILE] } }];
`,
  );
  wf.link(patch, ack);
  wf.link(ack, waChain(wf, "Decision"));

  return wf;
}

/* ═══════════════════════════════════════════════════════════════
   2. Academic Incharge
   ═══════════════════════════════════════════════════════════════ */

function buildAcademicIncharge() {
  const wf = new Workflow(
    "Office — Academic Incharge",
    "6:00 am IST: reads today's approved leave, staff attendance marks, the published timetable and open office tasks; Sonnet proposes a substitution plan and blockers; plan goes to the principal and director on WhatsApp; decisions become office_tasks for the director.",
  );
  const W = "academic-incharge";

  const trigger = cron(wf, "Every day 06:00 IST", "0 6 * * *");
  const ctx = code(
    wf,
    "Context",
    `${JS_DATES}
const now = istNow();
const today = isoDate(now);
return [{ json: { today, weekday: now.getUTCDay(), ay: academicYearCode(now), run_at: new Date().toISOString() } }];
`,
  );
  wf.chain(trigger, ctx);

  const getLeave = sbGet(
    wf,
    "Fetch: approved leave today",
    "staff_leave_requests",
    `tenant_id=eq.${TENANT}&status=eq.approved&from_date=lte.{{ $('Context').first().json.today }}&to_date=gte.{{ $('Context').first().json.today }}&select=staff_id,type_code,from_date,to_date,half_day,reason`,
  );
  const getRegister = sbGet(
    wf,
    "Fetch: today's staff register",
    "staff_attendance_desk_registers",
    `tenant_id=eq.${TENANT}&attendance_date=eq.{{ $('Context').first().json.today }}&select=id,marked_by,marked_at`,
  );
  const getMarks = sbGet(
    wf,
    "Fetch: today's staff marks",
    "staff_attendance_desk_marks",
    `tenant_id=eq.${TENANT}&register_id=eq.{{ $json.id || 'none' }}&status=in.(A,L,LE)&select=staff_id,status,note,in_time`,
  );
  const getTimetable = sbGet(
    wf,
    "Fetch: timetable slices",
    "timetable_desk_slices",
    `tenant_id=eq.${TENANT}&slice_key=in.(publishedGrids,substitutions)&select=slice_key,payload`,
  );
  const getStaff = sbGet(
    wf,
    "Fetch: active staff",
    "sis_staff",
    `tenant_id=eq.${TENANT}&status=eq.active&select=id,full_name,stream,designation_id&limit=500`,
  );
  const getClasses = sbGet(wf, "Fetch: classes", "masters_desk_classes", `tenant_id=eq.${TENANT}&select=id,name&limit=200`);
  const getSections = sbGet(wf, "Fetch: sections", "masters_desk_sections", `tenant_id=eq.${TENANT}&select=id,class_id,name&limit=500`);
  const getSubjects = sbGet(wf, "Fetch: subjects", "masters_desk_subjects", `tenant_id=eq.${TENANT}&select=id,code,name_en&limit=500`);
  const getHolidays = sbGet(
    wf,
    "Fetch: holidays today",
    "masters_desk_holidays",
    `tenant_id=eq.${TENANT}&is_active=eq.true&starts_on=lte.{{ $('Context').first().json.today }}&ends_on=gte.{{ $('Context').first().json.today }}&select=title,kind,scope,mode,weekday,applies_to,working_override,is_published,academic_year_code,exception_dates`,
  );
  const getTasks = sbGet(
    wf,
    "Fetch: my open tasks",
    "office_tasks",
    `tenant_id=eq.${TENANT}&to_role=eq.academic_incharge&status=in.(open,doing)&select=id,title,detail,due_on,from_role,created_at&order=due_on.asc.nullslast&limit=50`,
  );
  wf.chain(ctx, getLeave, getRegister, getMarks, getTimetable, getStaff, getClasses, getSections, getSubjects, getHolidays, getTasks);

  const assemble = code(
    wf,
    "Assemble",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.academic_incharge)};
const ctx = $('Context').first().json;
const rows = (name) => $(name).all().map((i) => i.json).filter((r) => r && Object.keys(r).length);
const leave = rows('Fetch: approved leave today');
const register = rows("Fetch: today's staff register");
const marks = rows("Fetch: today's staff marks");
const slices = rows('Fetch: timetable slices');
const staff = rows('Fetch: active staff');
const classes = rows('Fetch: classes');
const sections = rows('Fetch: sections');
const subjects = rows('Fetch: subjects');
const holidays = rows('Fetch: holidays today');
const tasks = rows('Fetch: my open tasks');

const staffName = Object.fromEntries(staff.map((s) => [s.id, s.full_name || s.id]));
const className = Object.fromEntries(classes.map((c) => [c.id, c.name || c.id]));
const sectionName = Object.fromEntries(sections.map((s) => [s.id, s.name || s.id]));
const subjectName = Object.fromEntries(subjects.map((s) => [s.id, s.name_en || s.code || s.id]));
const cs = (g) => (className[g.classId] || g.classId || '?') + ' ' + (sectionName[g.sectionId] || g.sectionId || '');

// Mirror apps/web/src/lib/foundationMasters.ts isPublishedHoliday: only a
// published, school-wide, non-staff-only rule closes the school for students.
// Weekly rules (Sunday, pre-primary Saturday) count only on their weekday and
// never on their exception dates; one-off rules are already date-filtered.
const STAFF_ONLY = ['staff_all', 'staff_teaching', 'staff_non_teaching'];
const holiday = holidays.find((h) => {
  if (h.working_override) return false;
  if (h.is_published === false) return false;
  if ((h.scope || 'school') !== 'school') return false;
  if (STAFF_ONLY.includes(h.applies_to || 'everyone')) return false;
  if (h.academic_year_code && h.academic_year_code !== ctx.ay) return false;
  if ((h.mode || 'one_off') === 'weekly') {
    if (typeof h.weekday !== 'number' || h.weekday !== ctx.weekday) return false;
    if (Array.isArray(h.exception_dates) && h.exception_dates.includes(ctx.today)) return false;
  }
  return true;
});
const sunday = ctx.weekday === 0;
if (holiday || sunday) {
  return [{ json: { day: 'skip', reason: sunday ? 'Sunday' : ('Holiday: ' + holiday.title), ctx, counts: { leave: leave.length, tasks: tasks.length } } }];
}

const grids = (slices.find((s) => s.slice_key === 'publishedGrids') || {}).payload || [];
const subs = ((slices.find((s) => s.slice_key === 'substitutions') || {}).payload || []).filter((s) => s.date === ctx.today);
const todaySlots = [];
for (const g of Array.isArray(grids) ? grids : []) {
  if (g.academicYearCode && g.academicYearCode !== ctx.ay) continue;
  for (const s of g.slots || []) if (s.weekday === ctx.weekday) todaySlots.push({ ...s, classId: g.classId, sectionId: g.sectionId, class_section: cs(g) });
}
const blockers = [];
if (!grids.length) blockers.push('No published timetable grids in the ERP — periods cannot be listed.');
if (!register.length) blockers.push('Staff attendance register for ' + ctx.today + ' not marked yet — absences come from approved leave only.');

const absentIds = new Map();
for (const l of leave) absentIds.set(l.staff_id, 'leave (' + l.type_code + (l.half_day ? ', half day' : '') + ')' + (l.reason ? ': ' + l.reason : ''));
for (const m of marks) if (m.status === 'A') absentIds.set(m.staff_id, 'marked absent' + (m.note ? ': ' + m.note : ''));
const lateIds = marks.filter((m) => m.status !== 'A').map((m) => ({ name: staffName[m.staff_id] || m.staff_id, status: m.status === 'L' ? 'late' : 'left early', in_time: m.in_time || '' }));

const absent = [...absentIds.entries()].map(([id, reason]) => ({
  staff_id: id, name: staffName[id] || id, reason,
  periods: todaySlots.filter((s) => s.teacherId === id).map((s) => ({ period: s.periodNo, class_section: s.class_section, subject: subjectName[s.subjectId] || s.subjectId,
    already_arranged: (subs.find((x) => x.periodNo === s.periodNo && x.classId === s.classId && x.sectionId === s.sectionId && x.substituteTeacherId) || {}).substituteTeacherId ? staffName[subs.find((x) => x.periodNo === s.periodNo && x.classId === s.classId && x.sectionId === s.sectionId).substituteTeacherId] || 'arranged' : null })),
})).sort((a, b) => b.periods.length - a.periods.length);

const periods = [...new Set(todaySlots.map((s) => s.periodNo))].sort((a, b) => a - b);
const teaching = staff.filter((s) => s.stream !== 'non_teaching' && !absentIds.has(s.id));
const busy = {};
for (const s of todaySlots) (busy[s.periodNo] ??= new Set()).add(s.teacherId);
const freeByPeriod = Object.fromEntries(periods.map((p) => [p, teaching.filter((t) => !(busy[p] || new Set()).has(t.id)).map((t) => t.full_name || t.id).slice(0, 25)]));
const teachesSubject = {};
for (const s of todaySlots) (teachesSubject[subjectName[s.subjectId] || s.subjectId] ??= new Set()).add(staffName[s.teacherId] || s.teacherId);
const subjectTeachers = Object.fromEntries(Object.entries(teachesSubject).map(([k, v]) => [k, [...v].slice(0, 15)]));

const data = {
  date: ctx.today, weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][ctx.weekday], academic_year: ctx.ay,
  register_marked: register.length > 0, absent, late_or_left_early: lateIds,
  free_teachers_by_period: freeByPeriod, subject_teachers_today: subjectTeachers,
  existing_substitutions_today: subs.length, blockers_from_data: blockers,
  open_tasks: tasks.map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, from: t.from_role, detail: String(t.detail || '').slice(0, 300) })),
};
const user = 'Prepare today\\'s substitution plan and blockers from this data, then list what needs the director. Return only the JSON object described in your charter under "Output format".\\n\\n' + JSON.stringify(data, null, 1);
return [{ json: { day: 'school', ctx, data, counts: { absent: absent.length, periods_affected: absent.reduce((n, a) => n + a.periods.length, 0), tasks: tasks.length, blockers: blockers.length },
  request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 2500, effort: 'medium' }) } }];
`,
  );
  wf.link(getTasks, assemble);

  const isSchoolDay = switchOn(wf, "Switch: school day?", "day", ["school", "skip"]);
  wf.link(assemble, isSchoolDay);

  const parsePlan = claudeCall(wf, { key: "plan", workflow: W, role: "academic_incharge", carryFrom: assemble, each: false, linkFrom: null });
  wf.link(isSchoolDay, `Claude: plan`, 0);

  const outputs = code(
    wf,
    "Build: outputs",
    `
const it = $input.first().json;
const p = it.parsed || {};
const plan = Array.isArray(p.plan) ? p.plan : [];
const blockers = Array.isArray(p.blockers) ? p.blockers : [];
const decisions = Array.isArray(p.decisions_for_director) ? p.decisions_for_director : [];
const covered = plan.filter((x) => x.status === 'proposed' || x.status === 'already_arranged').length;
const uncovered = plan.filter((x) => x.status === 'uncovered').length;
const lines = plan.map((x) => 'P' + x.period + ' ' + x.class_section + ' ' + (x.subject || '') + ' (' + x.absent_teacher + ') → ' + (x.substitute || 'UNCOVERED') + (x.status === 'already_arranged' ? ' ✓' : ''));
const summary = it.parse_error ? ('Plan could not be produced: ' + it.parse_error + '\\n' + String(it.text || '').slice(0, 800)) : String(p.summary || '').trim();
const head = '🏫 Substitution plan ' + it.ctx.today + ' (' + it.data.weekday + ')';
const wa_text = [head, summary, lines.length ? '\\nPeriods:\\n' + lines.join('\\n') : (it.counts.absent ? '' : 'No absent teacher on the data available.'),
  blockers.length ? '\\nBlockers:\\n' + blockers.map((b) => '• ' + b).join('\\n') : '',
  decisions.length ? '\\nNeeds the director:\\n' + decisions.map((d) => '• ' + d.title).join('\\n') : ''].filter(Boolean).join('\\n');
const note_row = { tenant_id: $env.OFFICE_TENANT_ID, role: 'academic_incharge', note_date: it.ctx.today,
  body: (summary + (lines.length ? '\\n' + lines.join('\\n') : '') + (blockers.length ? '\\nBlockers: ' + blockers.join(' | ') : '')).slice(0, 4000),
  facts: { absent: it.counts.absent, periods_affected: it.counts.periods_affected, covered, uncovered, blockers: blockers.length, decisions: decisions.length, open_tasks: it.counts.tasks, parse_error: it.parse_error || '' } };
const task_rows = decisions.map((d) => ({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'academic_incharge', to_role: 'director',
  title: String(d.title || 'Decision needed').slice(0, 80), detail: String(d.detail || '').slice(0, 600), status: 'open', source: 'academic', approval_state: 'none',
  due_on: d.due_on || null, payload: { kind: 'decision', date: it.ctx.today } }));
const wa_to = [$env.PRINCIPAL_WA_MOBILE, $env.DIRECTOR_WA_MOBILE];
return [{ json: { note_row, task_rows, wa_text, wa_to } }];
`,
  );
  wf.link(parsePlan, outputs);
  wf.link(outputs, sbInsert(wf, "Insert: plan note", "office_notes", "note_row"));
  const taskFilter = code(
    wf,
    "Tasks to insert",
    `
const rows = $input.first().json.task_rows || [];
return rows.length ? [{ json: { rows } }] : [];
`,
    { row: 1 },
  );
  wf.link(outputs, taskFilter);
  wf.link(taskFilter, sbInsert(wf, "Insert: director tasks", "office_tasks", "rows", { row: 1 }));
  wf.link(outputs, waChain(wf, "Plan"));

  const holidayNote = code(
    wf,
    "Build: holiday note",
    `
const it = $input.first().json;
return [{ json: { row: { tenant_id: $env.OFFICE_TENANT_ID, role: 'academic_incharge', note_date: it.ctx.today,
  body: 'No substitution plan for ' + it.ctx.today + ': ' + it.reason + '. ' + it.counts.tasks + ' open task(s) carried to tomorrow.',
  facts: { skipped: true, reason: it.reason, open_tasks: it.counts.tasks } } } }];
`,
    { row: 2 },
  );
  wf.link(isSchoolDay, holidayNote, 1);
  wf.link(holidayNote, sbInsert(wf, "Insert: holiday note", "office_notes", "row", { row: 2 }));

  return wf;
}

/* ═══════════════════════════════════════════════════════════════
   3. Morning huddle
   ═══════════════════════════════════════════════════════════════ */

function buildMorningHuddle() {
  const wf = new Workflow(
    "Office — Morning huddle",
    "6:30 am IST: the chair (Sonnet) sets a 3–5 item agenda from yesterday's notes and open tasks, each employee on the roster speaks in turn with its own cached charter, the chair writes minutes + decisions; decisions become office_tasks, the meeting is stored whole, the director gets one WhatsApp with one line per decision.",
  );
  const W = "morning-huddle";

  const trigger = cron(wf, "Every day 06:30 IST", "30 6 * * *");
  const ctx = code(
    wf,
    "Context",
    `${JS_DATES}
const now = istNow();
const today = isoDate(now);
const yesterday = isoDate(new Date(now.getTime() - 86400000));
const roster = String($env.OFFICE_ROSTER || 'receptionist,academic_incharge').split(',').map((s) => s.trim()).filter(Boolean);
return [{ json: { today, yesterday, weekday: now.getUTCDay(), roster } }];
`,
  );
  wf.chain(trigger, ctx);

  const getNotes = sbGet(
    wf,
    "Fetch: yesterday's notes",
    "office_notes",
    `tenant_id=eq.${TENANT}&note_date=gte.{{ $('Context').first().json.yesterday }}&select=role,note_date,created_at,body,facts&order=created_at.asc&limit=100`,
  );
  const getTasks = sbGet(
    wf,
    "Fetch: open tasks",
    "office_tasks",
    `tenant_id=eq.${TENANT}&status=in.(open,doing)&select=id,from_role,to_role,title,detail,status,due_on,source,approval_state,created_at&order=created_at.asc&limit=100`,
  );
  wf.chain(ctx, getNotes, getTasks);

  const buildAgenda = code(
    wf,
    "Build: agenda",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.chair)};
const ctx = $('Context').first().json;
const rows = (name) => $(name).all().map((i) => i.json).filter((r) => r && Object.keys(r).length);
const notes = rows("Fetch: yesterday's notes");
const tasks = rows('Fetch: open tasks');
const ageDays = (t) => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
const notes_digest = notes.map((n) => '[' + n.note_date + ' ' + n.role + '] ' + String(n.body || '').slice(0, 500));
const tasks_digest = tasks.map((t) => '#' + t.id + ' (' + t.to_role + ', from ' + t.from_role + ', ' + ageDays(t) + 'd old' + (t.due_on ? ', due ' + t.due_on : '') + (t.approval_state === 'pending' ? ', WAITING FOR DIRECTOR' : '') + ') ' + t.title);
const user = 'Today is ' + ctx.today + '. Roster, in speaking order: ' + ctx.roster.join(', ') + '.\\n\\nYesterday\\'s notes (' + notes.length + '):\\n' + (notes_digest.join('\\n') || '(none)')
  + '\\n\\nOpen tasks (' + tasks.length + '):\\n' + (tasks_digest.join('\\n') || '(none)')
  + '\\n\\nSet the agenda (3–5 items, each addressed to one roster role) and write a two-sentence opening. Return only the JSON object described in your charter under "Agenda".';
return [{ json: { ctx, notes_digest, tasks_digest, request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 900, effort: 'medium' }) } }];
`,
  );
  wf.link(getTasks, buildAgenda);
  const parseAgenda = claudeCall(wf, { key: "agenda", workflow: W, role: "chair", carryFrom: buildAgenda, each: false });

  const roster = code(
    wf,
    "Roster",
    `
const it = $input.first().json;
const a = it.parsed || {};
const agenda = Array.isArray(a.agenda) && a.agenda.length ? a.agenda : [{ item: 'What is open on your desk today, and what needs the director?', asks: 'all' }];
const opening = String(a.opening || 'Good morning. Short huddle: say what you will do today and by when.');
const known = ${JSON.stringify(Object.keys(ROLE_CHARTERS).filter((r) => r !== "chair"))};
return it.ctx.roster.filter((r) => known.includes(r)).map((role, idx) => ({ json: { role, idx, agenda, opening, agenda_error: it.parse_error || '', notes_digest: it.notes_digest, tasks_digest: it.tasks_digest, today: it.ctx.today } }));
`,
  );
  wf.link(parseAgenda, roster);

  const loop = wf.add("Loop over roster", "n8n-nodes-base.splitInBatches", 3, { batchSize: 1, options: { reset: false } });
  wf.link(roster, loop);

  const buildTurn = code(
    wf,
    "Build: turn",
    `${JS_REQUEST}
const CHARTERS = ${JSON.stringify(Object.fromEntries(Object.entries(ROLE_CHARTERS).filter(([r]) => r !== "chair")))};
const it = $input.first().json;
const turns = [];
for (let i = 0; i < $runIndex; i += 1) {
  try { for (const t of $('Record: turn').all(0, i)) turns.push(t.json); } catch (e) { /* no earlier run */ }
}
const transcript = [{ role: 'chair', text: it.opening }, ...turns.map((t) => ({ role: t.role, text: t.text }))];
const mine = it.agenda.filter((a) => a.asks === it.role || a.asks === 'all');
const user = 'Morning huddle, ' + it.today + '. You are speaking as ' + it.role + '.\\n\\nAgenda:\\n' + it.agenda.map((a, i) => (i + 1) + '. ' + a.item + ' (asks: ' + a.asks + ')').join('\\n')
  + '\\n\\nTranscript so far:\\n' + transcript.map((t) => t.role + ': ' + t.text).join('\\n\\n')
  + '\\n\\nYesterday\\'s notes:\\n' + (it.notes_digest.join('\\n') || '(none)') + '\\n\\nOpen tasks:\\n' + (it.tasks_digest.join('\\n') || '(none)')
  + '\\n\\nGive your turn: answer the agenda items addressed to you (' + (mine.length || 'none') + ') in at most three sentences each — what you will do, by when — and name anything that needs the director. Return only {"turn":"...","proposed_tasks":[{"title":"...","detail":"...","due_on":"YYYY-MM-DD","to_role":"' + it.role + ' or director"}]}.';
return [{ json: { ...it, transcript, request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: CHARTERS[it.role], user, maxTokens: 900, effort: 'medium' }) } }];
`,
    { row: 1 },
  );
  wf.link(loop, buildTurn, 1);
  // Role is dynamic inside the loop, so the usage row takes it from the item.
  const parseTurn = claudeCall(wf, { key: "turn", workflow: W, role: "(roster)", carryFrom: buildTurn, each: false });
  const recordTurn = code(
    wf,
    "Record: turn",
    `
const it = $input.first().json;
const p = it.parsed || {};
const text = String(p.turn || it.text || '(no answer)').trim();
const proposed = Array.isArray(p.proposed_tasks) ? p.proposed_tasks : [];
return [{ json: { role: it.role, idx: it.idx, text, proposed_tasks: proposed, agenda: it.agenda, opening: it.opening, today: it.today, parse_error: it.parse_error || '' } }];
`,
    { row: 1 },
  );
  wf.link(parseTurn, recordTurn);
  wf.link(recordTurn, loop);

  const buildMinutes = code(
    wf,
    "Build: minutes",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.chair)};
const turns = $input.all().map((i) => i.json).filter((t) => t && t.role).sort((a, b) => a.idx - b.idx);
const first = turns[0] || $('Roster').first().json;
const transcript = [{ role: 'chair', text: first.opening }, ...turns.map((t) => ({ role: t.role, text: t.text }))];
const proposed = turns.flatMap((t) => (t.proposed_tasks || []).map((p) => ({ ...p, by: t.role })));
const user = 'Huddle of ' + first.today + ' is over. Agenda:\\n' + first.agenda.map((a, i) => (i + 1) + '. ' + a.item + ' (' + a.asks + ')').join('\\n')
  + '\\n\\nTranscript:\\n' + transcript.map((t) => t.role + ': ' + t.text).join('\\n\\n')
  + '\\n\\nTasks the employees proposed:\\n' + (proposed.map((p) => '- [' + p.by + '] ' + p.title + ' → ' + (p.to_role || p.by) + (p.due_on ? ' by ' + p.due_on : '') + (p.detail ? ': ' + p.detail : '')).join('\\n') || '(none)')
  + '\\n\\nWrite the minutes and the decisions. Every decision is a task for one role with a due date; questions the employees could not settle go to "director". Return only the JSON object described in your charter under "Minutes".';
return [{ json: { today: first.today, agenda: first.agenda, transcript, proposed, request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 1500, effort: 'medium' }) } }];
`,
  );
  wf.link(loop, buildMinutes, 0);
  const parseMinutes = claudeCall(wf, { key: "minutes", workflow: W, role: "chair", carryFrom: buildMinutes, each: false });

  const records = code(
    wf,
    "Build: records",
    `
const it = $input.first().json;
const m = it.parsed || {};
const decisions = Array.isArray(m.decisions) ? m.decisions : [];
const minutes = it.parse_error ? ('Minutes could not be structured (' + it.parse_error + ').\\n' + String(it.text || '').slice(0, 3000)) : String(m.minutes || '').trim();
const roles = ['receptionist', 'academic_incharge', 'director'];
const task_rows = decisions.map((d) => ({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'chair', to_role: roles.includes(d.to_role) ? d.to_role : 'director',
  title: String(d.title || 'Decision').slice(0, 80), detail: String(d.detail || '').slice(0, 600), status: 'open', source: 'huddle', approval_state: 'none',
  due_on: d.due_on || null, payload: { kind: 'huddle_decision', meeting_date: it.today } }));
const meeting_row = { tenant_id: $env.OFFICE_TENANT_ID, meeting_date: it.today, kind: 'huddle', agenda: it.agenda, transcript: it.transcript, minutes, decisions };
const lines = Array.isArray(m.director_lines) && m.director_lines.length ? m.director_lines : decisions.map((d) => d.to_role + ': ' + d.title + (d.due_on ? ' by ' + d.due_on : ''));
const wa_text = '🧑‍🏫 Huddle ' + it.today + '\\n' + (lines.length ? lines.map((l) => '• ' + l).join('\\n') : '• No decisions today.') + (minutes && !lines.length ? '\\n\\n' + minutes.slice(0, 1500) : '');
return [{ json: { meeting_row, task_rows, wa_text, wa_to: [$env.DIRECTOR_WA_MOBILE] } }];
`,
  );
  wf.link(parseMinutes, records);
  wf.link(records, sbInsert(wf, "Insert: meeting", "office_meetings", "meeting_row"));
  const taskFilter = code(
    wf,
    "Tasks to insert",
    `
const rows = $input.first().json.task_rows || [];
return rows.length ? [{ json: { rows } }] : [];
`,
    { row: 1 },
  );
  wf.link(records, taskFilter);
  wf.link(taskFilter, sbInsert(wf, "Insert: decision tasks", "office_tasks", "rows", { row: 1 }));
  wf.link(records, waChain(wf, "Minutes"));

  return wf;
}

/* ─── write ─────────────────────────────────────────────────── */

const builds = {
  "receptionist.json": buildReceptionist,
  "academic-incharge.json": buildAcademicIncharge,
  "morning-huddle.json": buildMorningHuddle,
};

fs.mkdirSync(outDir, { recursive: true });
for (const [file, build] of Object.entries(builds)) {
  const wf = build();
  const json = JSON.stringify(wf.toJSON(), null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, file), json);
  console.log(`${file}: ${wf.nodes.length} nodes, ${Buffer.byteLength(json)} bytes`);
}

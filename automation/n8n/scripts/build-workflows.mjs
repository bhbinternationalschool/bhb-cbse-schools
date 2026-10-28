#!/usr/bin/env node
/**
 * Builds the importable n8n workflows in ../workflows from the charters in
 * ../charters. The JSON files are what the director imports; this script is
 * their source, so a charter edit is `node scripts/build-workflows.mjs` away
 * from the workflows, and the files share one set of helpers (Claude call +
 * usage ledger, Supabase REST, Telegram Bot API for the director and the
 * principal, WhatsApp through the ERP as the fallback before the bot token
 * is set).
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
  marketing_manager: systemFor("marketing-manager"),
  transport_manager: systemFor("transport-manager"),
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

/* Telegram (api.telegram.org, plain HTTP — the token is $env.TELEGRAM_BOT_TOKEN,
 * never an n8n credential, never in this repo). Internal messages go here
 * once the token is set; the chat ids are the director's and the principal's. */
const JS_TG = `
const TG_TOKEN = String($env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHATS = { director: String($env.TELEGRAM_DIRECTOR_CHAT_ID || '').trim(), principal: String($env.TELEGRAM_PRINCIPAL_CHAT_ID || '').trim() };
function tgEscape(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Telegram takes 4096 characters per message. Cut at a line break, so an
// HTML tag or entity is never split; a single over-long line is cut hard.
function tgChunks(text, max) {
  max = max || 4096; const out = []; let rest = String(text || '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\\n', max); if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}
function tgChatsFor(roles) { return [...new Set((roles || []).map((r) => TG_CHATS[r]).filter(Boolean))]; }
function tgRoleOf(chatId) { const id = String(chatId || ''); return Object.keys(TG_CHATS).find((r) => TG_CHATS[r] && TG_CHATS[r] === id) || ''; }
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
 * An internal message item (what the chains below consume):
 *   { text, to: ['director' | 'principal'...],
 *     approval?: { draft_id, summary },   // a draft to approve or reject
 *     tasks_button?: true }               // offer "📋 Open tasks" (Telegram)
 *
 * `internalChain` sends it by Telegram when TELEGRAM_BOT_TOKEN is set,
 * else by WhatsApp through the ERP (`waChain`): Meta reply buttons
 * "Approve n" / "Reject n" inside the 24-hour window; outside it the
 * dispatch result says so and the item is resent as a template — the
 * approval template (OFFICE_WA_APPROVAL_TEMPLATE, quick replies that carry
 * "Approve n" / "Reject n") for an approval, else OFFICE_WA_TEMPLATE.
 * (`wa_text` / `wa_to` are still read for an older caller.)
 */
function waChain(wf, prefix) {
  const build = code(
    wf,
    `${prefix}: build WhatsApp`,
    `
// Telegram carries internal messages once the bot token is set (tgChain).
if (String($env.TELEGRAM_BOT_TOKEN || '').trim()) return [];
const ROLE_MOBILE = { director: $env.DIRECTOR_WA_MOBILE, principal: $env.PRINCIPAL_WA_MOBILE };
const items = $input.all().map((i) => i.json).filter((j) => j && (j.text || j.wa_text));
const ts = Date.now();
const messages = []; const sources = [];
items.forEach((src) => {
  const roles = Array.isArray(src.to) ? src.to : [];
  const to = [...new Set([...roles.map((r) => ROLE_MOBILE[r]), ...(src.wa_to || [])].map((m) => String(m || '').replace(/\\D/g, '').slice(-10)).filter((m) => m.length === 10))];
  const a = src.approval && src.approval.draft_id ? src.approval : null;
  const id = a ? String(a.draft_id).replace(/\\D/g, '') : '';
  let body = String(src.text || src.wa_text || '').trim();
  if (a) body += '\\n\\nTap Approve or Reject — or reply APPROVE ' + id + ' / REJECT ' + id + '.';
  body = body.slice(0, 4000);
  if (!to.length || !body) return;
  const buttons = a ? [{ id: 'approve-' + id, title: 'Approve ' + id }, { id: 'reject-' + id, title: 'Reject ' + id }] : null;
  const idx = sources.length;
  sources.push({ idx, text: body, buttons, approval: a });
  for (const mobile of to) {
    const mid = (n) => 'office-' + idx + '-' + n + '-' + ts + '-' + mobile;
    if (!buttons) { messages.push({ mobile, body, urgent: true, messageId: mid(0) }); continue; }
    // Meta caps a reply-buttons body at 1024 characters. A longer draft goes
    // out whole as text, then a short message carries the buttons.
    if (body.length <= 1000) { messages.push({ mobile, body, buttons, urgent: true, messageId: mid(0) }); continue; }
    messages.push({ mobile, body, urgent: true, messageId: mid(0) });
    messages.push({ mobile, body: '✉️ Draft #' + id + ' above — your decision?', buttons, urgent: true, messageId: mid(1) });
  }
});
if (!messages.length) return [];
return [{ json: { wa: { module: 'notifications', messages }, sources,
  wa_text: sources.map((s) => s.text).join('\\n\\n'), wa_to: [...new Set(messages.map((m) => m.mobile))] } }];
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
// Meta refuses free text — and reply buttons — when the recipient has not
// written to the school number in 24 hours. The ERP's dispatch route says so
// per message (windowClosed; older builds only in the error text).
const res = $input.first().json;
const built = $('${prefix}: build WhatsApp').first().json;
const tpl = ($env.OFFICE_WA_TEMPLATE || '').trim();
const approvalTpl = ($env.OFFICE_WA_APPROVAL_TEMPLATE || '').trim();
if (!tpl && !approvalTpl) return [];
const failed = (res.results || []).filter((r) => r.status === 'failed' && (r.windowClosed || /24h|template/i.test(String(r.error || ''))));
if (!failed.length) return [];
// Meta rejects newlines, tabs and 4+ spaces inside a template parameter.
const flat = (v, max) => String(v || '').replace(/\\s*[\\r\\n\\t]+\\s*/g, ' | ').replace(/ {4,}/g, '   ').trim().slice(0, max);
// Meta caps the rendered template at 1024 characters (error #132005). When
// cutting, keep the tail so a closing line survives.
const trim = (s, max) => (s.length > max ? s.slice(0, max - 160) + ' … ' + s.slice(-140) : s);
// OFFICE_WA_TEMPLATE_KEYS lists the notice template's body variables in order.
// One key: the whole text goes in it. Three keys (the ERP's school-notice
// template: schoolName, noticeTitle, noticeBody): school name, first line, rest.
const keys = ($env.OFFICE_WA_TEMPLATE_KEYS || '1').split(',').map((k) => k.trim()).filter(Boolean);
const noticeMessage = (mobile, raw, tag) => {
  if (!tpl) return null;
  const nl = raw.indexOf('\\n');
  const title = flat(nl > 0 ? raw.slice(0, nl) : raw, 80);
  const rest = flat(trim(nl > 0 ? raw.slice(nl + 1) : raw, 700), 700);
  let variables;
  if (keys.length >= 3) variables = { [keys[0]]: $env.OFFICE_SCHOOL_NAME || 'BHB International School', [keys[1]]: title, [keys[2]]: rest };
  else if (keys.length === 2) variables = { [keys[0]]: title, [keys[1]]: rest };
  else variables = { [keys[0]]: flat(trim(raw, 1000), 1000) };
  return { mobile, urgent: true, messageId: 'office-tpl-' + tag + '-' + Date.now() + '-' + mobile,
    template: { name: tpl, language: $env.OFFICE_WA_TEMPLATE_LANG || 'en', variableKeys: keys, variables } };
};
// One template per (source, number): a draft that went out as text plus a
// buttons message failed twice but is resent once.
const sources = Array.isArray(built.sources) && built.sources.length ? built.sources : [{ idx: 0, text: String(built.wa_text || ''), approval: null }];
const done = new Set(); const messages = [];
for (const r of failed) {
  const m = /^office-(\\d+)-/.exec(String(r.messageId || ''));
  const src = sources[m ? Number(m[1]) : 0] || sources[0];
  const key = src.idx + ':' + r.mobile;
  if (done.has(key)) continue;
  done.add(key);
  const a = src.approval;
  if (a && a.draft_id && approvalTpl) {
    // bhb_office_approval: {{1}} draft id, {{2}} summary. Its two quick
    // replies go out with the payloads "Approve n" / "Reject n", so a tap
    // reaches the poller exactly like a typed reply.
    const id = String(a.draft_id).replace(/\\D/g, '');
    messages.push({ mobile: r.mobile, urgent: true, messageId: 'office-tpl-' + src.idx + '-' + Date.now() + '-' + r.mobile,
      template: { name: approvalTpl, language: $env.OFFICE_WA_APPROVAL_TEMPLATE_LANG || 'en',
        variableKeys: ['draftId', 'draftSummary'],
        variables: { draftId: id, draftSummary: flat(trim(String(a.summary || src.text), 880), 880) },
        quickReplyPayloads: ['Approve ' + id, 'Reject ' + id] } });
    continue;
  }
  const n = noticeMessage(r.mobile, src.text, src.idx);
  if (n) messages.push(n);
}
if (!messages.length) return [];
return [{ json: { wa: { module: 'notifications', messages } } }];
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

/* Headers for the ERP director-assistant endpoint (/api/office/assistant).
 * Both secrets are sent: the ERP accepts a dedicated OFFICE_ASSISTANT_SECRET
 * or the existing WA_DISPATCH_SECRET, so the relay works whichever is set. */
const ASSIST_HEADERS = [
  { name: "x-office-assistant-secret", value: "={{ $env.OFFICE_ASSISTANT_SECRET || $env.WA_DISPATCH_SECRET }}" },
  { name: "x-wa-dispatch-secret", value: "={{ $env.WA_DISPATCH_SECRET }}" },
  { name: "Content-Type", value: "application/json" },
];

/** One Telegram Bot API call per item: `{ tg_method, tg }` → POST. */
function tgCall(wf, name, extra = {}) {
  return wf.add(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/' + $json.tg_method }}",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.tg) }}",
      options: { timeout: 30000 },
    },
    { onError: "continueRegularOutput", ...extra },
  );
}

/**
 * Telegram for the director and the principal (see the item shape above).
 * HTML parse mode, the first line in bold, 4096-character chunks; an
 * approval item gets the ✅ Approve / ❌ Reject inline keyboard
 * (callback_data "approve:<id>" / "reject:<id>") on its last chunk, a
 * `tasks_button` item the "📋 Open tasks" button. Does nothing until
 * TELEGRAM_BOT_TOKEN is set.
 */
function tgChain(wf, prefix) {
  const build = code(
    wf,
    `${prefix}: build Telegram`,
    `${JS_TG}
if (!TG_TOKEN) return [];
const items = $input.all().map((i) => i.json).filter((j) => j && (j.text || j.wa_text));
const out = [];
for (const src of items) {
  const chats = tgChatsFor(Array.isArray(src.to) && src.to.length ? src.to : ['director']);
  const raw = String(src.text || src.wa_text || '').trim();
  if (!chats.length || !raw) continue;
  const nl = raw.indexOf('\\n');
  const html = nl > 0 ? '<b>' + tgEscape(raw.slice(0, nl)) + '</b>' + tgEscape(raw.slice(nl)) : tgEscape(raw);
  const a = src.approval && src.approval.draft_id ? src.approval : null;
  const id = a ? String(a.draft_id).replace(/\\D/g, '') : '';
  let keyboard = null;
  if (a) keyboard = [[{ text: '✅ Approve', callback_data: 'approve:' + id }, { text: '❌ Reject', callback_data: 'reject:' + id }]];
  else if (src.tasks_button) keyboard = [[{ text: '📋 Open tasks', callback_data: 'tasks' }]];
  const chunks = tgChunks(html);
  for (const chat_id of chats) chunks.forEach((text, i) => {
    const tg = { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard && i === chunks.length - 1) tg.reply_markup = { inline_keyboard: keyboard };
    out.push({ json: { tg_method: 'sendMessage', tg } });
  });
}
return out;
`,
  );
  wf.chain(build, tgCall(wf, `${prefix}: send Telegram`));
  return build;
}

/** Internal message → Telegram when the bot token is set, else WhatsApp. */
function internalChain(wf, prefix, from) {
  wf.link(from, tgChain(wf, prefix));
  wf.link(from, waChain(wf, prefix));
}

/* ═══════════════════════════════════════════════════════════════
   1. Receptionist
   ═══════════════════════════════════════════════════════════════ */

function buildReceptionist() {
  const wf = new Workflow(
    "Office — Receptionist",
    "Sorts every email to the school inbox (Haiku), drafts parent/vendor replies (Sonnet) for the director's Approve/Reject tap on WhatsApp, routes CBSE/UDISE+ items to the Academic Incharge, logs the rest.",
  );
  const W = "receptionist";

  /* ── A. New mail ── */
  const trigger = wf.add("New mail in school inbox", "n8n-nodes-base.gmailTrigger", 1.2, {
    pollTimes: { item: [{ mode: "everyMinute" }] },
    simple: false,
    // Only mail addressed to the office alias: the credential may belong to
    // a person's mailbox (the director's), and their private mail must never
    // reach the classifier. SCHOOL_INBOX is the alias, e.g. office@school.
    filters: { labelIds: ["INBOX"], q: "={{ 'to:' + $env.SCHOOL_INBOX }}" },
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
// One message per draft, to the director: Telegram with ✅ Approve / ❌ Reject
// (telegram-office-bot.json acts on the tap), or WhatsApp reply buttons
// before the bot token is set. A draft Claude could not write is a plain note.
const rows = $input.all().map((i) => i.json);
const out = [];
for (const t of rows) {
  const p = t.payload || {};
  if (p.draft_error) {
    out.push({ json: { text: '⚠️ Could not draft a reply for "' + p.in_reply_to_subject + '" (' + p.draft_error + '). Task #' + t.id + ' is open for the office.', to: ['director'] } });
    continue;
  }
  const id = String(t.id);
  const head = 'To: ' + (p.to_name ? p.to_name + ' <' + p.to + '>' : p.to) + '\\nSubject: ' + p.subject;
  const text = '✉️ Draft #' + id + ' (' + p.category + ', ' + (p.language || '?') + ')\\n' + head
    + '\\n\\n' + p.body
    + (p.open_questions && p.open_questions.length ? '\\n\\nOpen: ' + p.open_questions.join('; ') : '')
    + (p.note_for_director ? '\\nNote: ' + p.note_for_director : '');
  out.push({ json: { text, to: ['director'], approval: { draft_id: id, summary: head + '\\n' + p.body } } });
}
return out;
`,
  );
  wf.link("Insert: approval task", buildDirectorWa);
  internalChain(wf, "Approval", buildDirectorWa);

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

  /* ── B. Director's decisions on WhatsApp (poll) — the fallback before
     TELEGRAM_BOT_TOKEN is set; with the token, telegram-office-bot.json
     decides drafts and this branch stays idle. ── */
  const poll = cron(wf, "Every 5 minutes", "*/5 * * * *");
  const pending = sbGet(
    wf,
    "Fetch: pending drafts",
    "office_tasks",
    `tenant_id=eq.${TENANT}&approval_state=eq.pending&source=in.(receptionist,assistant,marketing)&status=eq.open&select=*&order=created_at.asc&limit=50`,
  );
  const collect = code(
    wf,
    "Collect: pending",
    `
if (String($env.TELEGRAM_BOT_TOKEN || '').trim()) return []; // Telegram decides (telegram-office-bot.json)
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
    `tenant_id=eq.${TENANT}&mobile10=eq.{{ String($env.DIRECTOR_WA_MOBILE || '').replace(/\\D/g, '').slice(-10) }}&direction=eq.in&kind=in.(text,button)&created_at=gte.{{ encodeURIComponent($json.since) }}&select=id,body,button_id,created_at&order=created_at.asc&limit=200`,
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
  // A tap logs its label as body ("Approve 42") and its id ("approve-42") or
  // template payload ("Approve 42") as button_id; either names the draft.
  const body = String(r.button_id || r.body || '');
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
return [{ json: { text: acks.join('\\n'), to: ['director'] } }];
`,
  );
  wf.link(patch, ack);
  internalChain(wf, "Decision", ack);

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

  const trigger = cron(wf, "Every day 08:30 IST", "30 8 * * *");
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
return [{ json: { note_row, task_rows, text: wa_text, to: ['principal', 'director'], tasks_button: true } }];
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
  internalChain(wf, "Plan", outputs);

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
let user = 'Morning huddle, ' + it.today + '. You are speaking as ' + it.role + '.\\n\\nAgenda:\\n' + it.agenda.map((a, i) => (i + 1) + '. ' + a.item + ' (asks: ' + a.asks + ')').join('\\n')
  + '\\n\\nTranscript so far:\\n' + transcript.map((t) => t.role + ': ' + t.text).join('\\n\\n')
  + '\\n\\nYesterday\\'s notes:\\n' + (it.notes_digest.join('\\n') || '(none)') + '\\n\\nOpen tasks:\\n' + (it.tasks_digest.join('\\n') || '(none)')
  + '\\n\\nGive your turn: answer the agenda items addressed to you (' + (mine.length || 'none') + ') in at most three sentences each — what you will do, by when — and name anything that needs the director. Return only {"turn":"...","proposed_tasks":[{"title":"...","detail":"...","due_on":"YYYY-MM-DD","to_role":"' + it.role + ' or director"}]}.';
user += ' Do NOT propose a task that repeats an already-open task shown above; reference its #id instead and only propose genuinely new work.';
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
const openRows = (() => { try { return $('Fetch: open tasks').all().map((i) => i.json).filter((t) => t && t.id); } catch (e) { return []; } })();
const open_digest = openRows.map((t) => '#' + t.id + ' [' + t.to_role + '] ' + t.title);
let user = 'Huddle of ' + first.today + ' is over. Agenda:\\n' + first.agenda.map((a, i) => (i + 1) + '. ' + a.item + ' (' + a.asks + ')').join('\\n')
  + '\\n\\nTranscript:\\n' + transcript.map((t) => t.role + ': ' + t.text).join('\\n\\n')
  + '\\n\\nTasks the employees proposed:\\n' + (proposed.map((p) => '- [' + p.by + '] ' + p.title + ' → ' + (p.to_role || p.by) + (p.due_on ? ' by ' + p.due_on : '') + (p.detail ? ': ' + p.detail : '')).join('\\n') || '(none)')
  + '\\n\\nWrite the minutes and the decisions. Every decision is a task for one role with a due date; questions the employees could not settle go to "director". Return only the JSON object described in your charter under "Minutes".';
user += ' Already-open tasks (do NOT raise any of these again - they are already tracked; if unresolved, reference the #id in the minutes and wait, do not create a new task for it): ' + (open_digest.join(' | ') || '(none)');
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
const roles = ['receptionist', 'academic_incharge', 'marketing_manager', 'transport_manager', 'director'];
const task_rows = decisions.map((d) => ({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'chair', to_role: roles.includes(d.to_role) ? d.to_role : 'director',
  title: String(d.title || 'Decision').slice(0, 80), detail: String(d.detail || '').slice(0, 600), status: 'open', source: 'huddle', approval_state: 'none',
  due_on: d.due_on || null, payload: { kind: 'huddle_decision', meeting_date: it.today } }));
const meeting_row = { tenant_id: $env.OFFICE_TENANT_ID, meeting_date: it.today, kind: 'huddle', agenda: it.agenda, transcript: it.transcript, minutes, decisions };
const lines = Array.isArray(m.director_lines) && m.director_lines.length ? m.director_lines : decisions.map((d) => d.to_role + ': ' + d.title + (d.due_on ? ' by ' + d.due_on : ''));
const wa_text = '🧑‍🏫 Huddle ' + it.today + '\\n' + (lines.length ? lines.map((l) => '• ' + l).join('\\n') : '• No decisions today.') + (minutes && !lines.length ? '\\n\\n' + minutes.slice(0, 1500) : '');
return [{ json: { meeting_row, task_rows, text: wa_text, to: ['director', 'principal'], tasks_button: true } }];
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
  internalChain(wf, "Minutes", records);

  return wf;
}

/* ═══════════════════════════════════════════════════════════════
   4. Telegram office bot (@BHB_Office_bot)
   ═══════════════════════════════════════════════════════════════
   n8n's Telegram Trigger is webhook-only and this n8n is loopback-only
   behind an SSH tunnel, so the bot POLLS: every minute, getUpdates with the
   stored offset (workflow static data), then
     - a tap on ✅ Approve / ❌ Reject (callback_data "approve:<id>") or a
       typed APPROVE 42 / REJECT 42 from the director's chat decides the
       draft: Gmail reply on approve, office_tasks patched, the callback
       answered, the original message edited to show the decision;
     - /drafts, /tasks (or the "📋 Open tasks" button), /huddle, /plan,
       /start, /help from the director's or the principal's chat.
   Anything else — any other chat — is ignored (an unknown chat gets its
   chat id from /start, nothing more). One poller per bot: never set a
   webhook on @BHB_Office_bot and never run this workflow twice. */
function buildTelegramBot() {
  const wf = new Workflow(
    "Office: Telegram bot",
    "Polls @BHB_Office_bot every minute: approve/reject taps and typed decisions on the Receptionist's drafts (Gmail reply on approve), and the /drafts /tasks /huddle /plan commands for the director and the principal.",
  );
  const TENANT = "{{ $env.OFFICE_TENANT_ID }}";
  const tick = cron(wf, "Every minute", "* * * * *");
  const buildPoll = code(
    wf,
    "Build: getUpdates",
    `${JS_TG}
if (!TG_TOKEN) return [];
// The offset confirms every earlier update to Telegram; it survives restarts
// in the workflow's static data (saved after each production execution).
const st = $getWorkflowStaticData('global');
const offset = Number(st.tg_offset || 0);
return [{ json: { tg_method: 'getUpdates', tg: { offset, timeout: 0, limit: 100, allowed_updates: ['message', 'callback_query'] } } }];
`,
  );
  const poll = tgCall(wf, "Telegram: getUpdates");
  const parse = code(
    wf,
    "Parse: updates",
    `${JS_TG}
const res = $input.first().json || {};
const updates = res.ok && Array.isArray(res.result) ? res.result : [];
if (!updates.length) return [];
const st = $getWorkflowStaticData('global');
st.tg_offset = Math.max(...updates.map((u) => Number(u.update_id || 0))) + 1;
// (?![a-z]) instead of \\b: JS word boundaries are ASCII-only, so Devanagari words never matched.
// End-anchored: a BARE approve/reject word (optionally a draft number) is a
// decision; anything longer is a free-form instruction for the assistant.
const APPROVE = /^\\s*\\/?(approve|approved|ok|okay|yes|haan|ha|हाँ|हां|ठीक)\\s*#?\\s*(\\d+)?\\s*$/i;
const REJECT = /^\\s*\\/?(reject|rejected|cancel|nahi|nahin|नहीं|रद्द)\\s*#?\\s*(\\d+)?\\s*$/i;
const COMMANDS = { start: 'start', help: 'start', drafts: 'drafts', tasks: 'tasks', huddle: 'huddle', plan: 'plan', marketing: 'marketing', transport: 'transport' };
const out = [];
for (const u of updates) {
  const cq = u.callback_query;
  if (cq) {
    const chat_id = String((cq.message && cq.message.chat && cq.message.chat.id) || (cq.from && cq.from.id) || '');
    const role = tgRoleOf(chat_id);
    const data = String(cq.data || '');
    const base = { chat_id, role, callback_id: cq.id, message_id: cq.message ? cq.message.message_id : null, message_text: cq.message ? String(cq.message.text || '') : '' };
    if (!role) continue;
    const m = /^(approve|reject):(\\d+)$/.exec(data);
    if (m && role === 'director') { out.push({ json: { kind: 'decision', decision: m[1], task_id: Number(m[2]), via: 'tap', ...base } }); continue; }
    if (m) { out.push({ json: { kind: 'command', cmd: 'not_director', ...base } }); continue; }
    const ta = /^(done|snooze):(\\d+)$/.exec(data);
    if (ta && role === 'director') { out.push({ json: { kind: 'taskaction', action: ta[1], task_id: Number(ta[2]), ...base } }); continue; }
    if ((ta || data === 'doneall') && role !== 'director') { out.push({ json: { kind: 'command', cmd: 'not_director', ...base } }); continue; }
    if (data === 'doneall') { out.push({ json: { kind: 'taskaction', action: 'doneall', task_id: null, ...base } }); continue; }
    if (data === 'tasks') { out.push({ json: { kind: 'command', cmd: 'tasks', ...base } }); continue; }
    continue;
  }
  const msg = u.message;
  if (!msg || !msg.text) continue;
  const chat_id = String(msg.chat && msg.chat.id || '');
  const role = tgRoleOf(chat_id);
  const text = String(msg.text || '').trim();
  const base = { chat_id, role, callback_id: null, message_id: null, message_text: '' };
  const cmd = /^\\/([a-z]+)(?:@\\w+)?\\b/i.exec(text);
  if (cmd && COMMANDS[cmd[1].toLowerCase()]) {
    const name = COMMANDS[cmd[1].toLowerCase()];
    if (role || name === 'start') out.push({ json: { kind: 'command', cmd: name, ...base } });
    continue;
  }
  if (!role) continue;
  const ta = /^\\/(done|close|snooze)\\s+#?(\\d+|all)\\b/i.exec(text);
  if (ta) {
    if (role !== 'director') { out.push({ json: { kind: 'command', cmd: 'not_director', ...base } }); continue; }
    const act = ta[1].toLowerCase() === 'close' ? 'done' : ta[1].toLowerCase();
    const arg = ta[2].toLowerCase();
    if (arg === 'all') { if (act === 'done') out.push({ json: { kind: 'taskaction', action: 'doneall', task_id: null, ...base } }); continue; }
    out.push({ json: { kind: 'taskaction', action: act, task_id: Number(arg), ...base } });
    continue;
  }
  let decision = null; let m = text.match(APPROVE);
  if (m) decision = 'approve'; else { m = text.match(REJECT); if (m) decision = 'reject'; }
  if (!decision) {
    // Any other message from the director is a free-form instruction for the
    // office assistant (ERP /api/office/assistant). Non-director chatter is ignored.
    if (role === 'director') out.push({ json: { kind: 'assistant', text, ...base } });
    continue;
  }
  if (role !== 'director') { out.push({ json: { kind: 'command', cmd: 'not_director', ...base } }); continue; }
  out.push({ json: { kind: 'decision', decision, task_id: m[2] ? Number(m[2]) : null, via: 'text', ...base } });
}
return out;
`,
  );
  wf.chain(tick, buildPoll, poll, parse);
  const kind = switchOn(wf, "Switch: update kind", "kind", ["decision", "command", "taskaction", "assistant"]);
  wf.link(parse, kind);

  /* ── decisions ── */
  const pending = sbGet(
    wf,
    "Fetch: pending drafts",
    "office_tasks",
    `tenant_id=eq.${TENANT}&approval_state=eq.pending&source=in.(receptionist,assistant,marketing)&status=eq.open&select=*&order=created_at.asc&limit=50`,
  );
  wf.link(kind, pending, 0);
  const match = code(
    wf,
    "Match: decisions",
    `
const pending = $input.all().map((i) => i.json).filter((r) => r && r.id);
const asks = $('Parse: updates').all().map((i) => i.json).filter((u) => u.kind === 'decision');
const out = []; const decided = new Set();
for (const a of asks) {
  let task = null;
  if (a.task_id) task = pending.find((t) => Number(t.id) === Number(a.task_id));
  else if (pending.length === 1) task = pending[0];
  let ack = '';
  if (!task) ack = a.task_id ? 'No draft #' + a.task_id + ' is waiting.' : (pending.length ? 'Which draft? ' + pending.map((t) => '#' + t.id).join(', ') + ' are waiting — tap its button or reply APPROVE <id>.' : 'No draft is waiting.');
  else if (decided.has(task.id)) ack = 'Draft #' + task.id + ' is already decided.';
  if (ack) { out.push({ json: { ...a, decision: 'none', task: null, ack } }); continue; }
  decided.add(task.id);
  out.push({ json: { ...a, task } });
}
return out;
`,
  );
  wf.link(pending, match);
  const decSwitch = switchOn(wf, "Switch: decision", "decision", ["approve", "reject", "none"]);
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
  // Approve splits by the draft's source. A Receptionist draft is a Gmail
  // reply (as before). An assistant draft is actually SENT by the ERP, which
  // owns WhatsApp dispatch and the Meta-template rules — the bot stays thin.
  const apSrc = switchOn(wf, "Switch: approve source", "task.source", ["receptionist", "assistant", "marketing"]);
  wf.link(decSwitch, apSrc, 0);
  wf.link(apSrc, gmailReply, 0);
  const patchApproved = code(
    wf,
    "Build: approved patch",
    `
const d = $('Match: decisions').item.json;
const sent = $input.item.json;
const now = new Date().toISOString();
return { json: { ...d, task_id: d.task.id, patch: { approval_state: 'approved', status: 'done', decided_by: 'director', decided_at: now, updated_at: now,
  payload: { ...d.task.payload, decision_reply: 'telegram ' + d.via, sent_at: now, gmail_sent_id: sent.id || '' } },
  ack: '✅ Sent reply #' + d.task.id + ' to ' + (d.task.payload.to_name || d.task.payload.to) + '.' } };
`,
    { each: true },
  );
  wf.link(gmailReply, patchApproved);
  // Assistant draft on approve → the ERP performs the real send (wa/dispatch).
  const erpApproveSend = wf.add(
    "ERP: approve send",
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.ERP_BASE_URL }}/api/office/assistant",
      sendHeaders: true,
      headerParameters: { parameters: ASSIST_HEADERS },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ chat_id: $json.chat_id, action: { kind: 'approve_draft', draft: ($json.task.payload || {}).assistant_draft } }) }}",
      options: { timeout: 120000 },
    },
    { onError: "continueRegularOutput", alwaysOutputData: true },
  );
  wf.link(apSrc, erpApproveSend, 1);
  const patchApprovedAssistant = code(
    wf,
    "Build: assistant approved patch",
    `
const d = $('Match: decisions').item.json;
const res = $input.item.json || {};
const now = new Date().toISOString();
// The ERP returns { kind:'action_done', text } once the send has run. Only
// then is the draft closed; if the office was unreachable it stays pending.
if (res.kind === 'action_done') {
  return { json: { ...d, task_id: d.task.id, patch: { approval_state: 'approved', status: 'done', decided_by: 'director', decided_at: now, updated_at: now,
    payload: { ...d.task.payload, decision_reply: 'telegram ' + d.via, sent_at: now, send_result: String(res.text || '') } },
    ack: '✅ ' + String(res.text || 'Sent.') } };
}
return { json: { ...d, task_id: d.task.id, patch: { updated_at: now, payload: { ...d.task.payload, last_error: 'send unreachable ' + now } },
  ack: '⚠️ Could not reach the office to send draft #' + d.task.id + '. It is still waiting — tap Approve again.' } };
`,
    { each: true },
  );
  wf.link(erpApproveSend, patchApprovedAssistant);
  // A Marketing Manager proposal (budget cap, campaign spend, ad copy, beat
  // assignment) has no automated action: approving it only records the
  // director's go-ahead. Nothing spends or publishes from here — a person
  // (or a later phase) acts, and the Marketing Manager applies an approved
  // cap change to office_marketing_budget on its next weekly run.
  const patchApprovedMarketing = code(
    wf,
    "Build: marketing approved patch",
    `
const d = $('Match: decisions').item.json;
const now = new Date().toISOString();
const p = d.task.payload || {};
const what = [p.mk_unit, p.mk_channel].filter(Boolean).join(' / ');
return { json: { ...d, task_id: d.task.id, patch: { approval_state: 'approved', status: 'done', decided_by: 'director', decided_at: now, updated_at: now,
  payload: { ...p, decision_reply: 'telegram ' + d.via, approved_at: now } },
  ack: '✅ Approved #' + d.task.id + (what ? ' (' + what + ')' : '') + ' — ' + String(d.task.title || '').slice(0, 80) + '. Go ahead; the Marketing Manager records it next run.' } };
`,
    { each: true, row: 1 },
  );
  wf.link(apSrc, patchApprovedMarketing, 2);
  const patchRejected = code(
    wf,
    "Build: rejected patch",
    `
const d = $input.item.json;
const now = new Date().toISOString();
return { json: { ...d, task_id: d.task.id, patch: { approval_state: 'rejected', status: 'cancelled', decided_by: 'director', decided_at: now, updated_at: now,
  payload: { ...d.task.payload, decision_reply: 'telegram ' + d.via } },
  ack: '🚫 Draft #' + d.task.id + ' rejected — nothing sent to ' + (d.task.payload.to_name || d.task.payload.to) + '.' } };
`,
    { each: true, row: 1 },
  );
  wf.link(decSwitch, patchRejected, 1);
  const patch = sbPatchTask(wf, "Patch: task decided");
  wf.link(patchApproved, patch);
  wf.link(patchApprovedAssistant, patch);
  wf.link(patchApprovedMarketing, patch);
  wf.link(patchRejected, patch);
  const noDecision = code(
    wf,
    "Build: no decision",
    `
return { json: { ...$input.item.json, patched: false } };
`,
    { each: true, row: 2 },
  );
  wf.link(decSwitch, noDecision, 2);
  const ackTg = code(
    wf,
    "Build: decision replies",
    `${JS_TG}
// Answer the tap, edit the draft message so the decision shows under it
// (the keyboard goes away), or reply to a typed decision.
const built = [];
for (const name of ['Build: approved patch', 'Build: assistant approved patch', 'Build: marketing approved patch', 'Build: rejected patch', 'Build: no decision']) {
  try { for (const x of $(name).all()) built.push(x.json); } catch (e) { /* branch did not run */ }
}
const out = [];
for (const b of built) {
  const ack = String(b.ack || '');
  if (b.callback_id) out.push({ json: { tg_method: 'answerCallbackQuery', tg: { callback_query_id: b.callback_id, text: ack.slice(0, 200) } } });
  if (b.message_id && b.decision !== 'none') {
    const text = tgChunks(String(b.message_text || '') + '\\n\\n' + ack).slice(-1)[0];
    out.push({ json: { tg_method: 'editMessageText', tg: { chat_id: b.chat_id, message_id: b.message_id, text } } });
  } else {
    out.push({ json: { tg_method: 'sendMessage', tg: { chat_id: b.chat_id, text: ack } } });
  }
}
return out;
`,
  );
  wf.link(patch, ackTg);
  wf.link(noDecision, ackTg);
  const reply = tgCall(wf, "Telegram: reply");
  wf.link(ackTg, reply);

  /* ── commands ── */
  const openTasks = sbGet(
    wf,
    "Fetch: open tasks",
    "office_tasks",
    `tenant_id=eq.${TENANT}&status=in.(open,doing)&select=id,from_role,to_role,title,detail,status,due_on,source,approval_state,payload,created_at&order=created_at.asc&limit=100`,
    { row: 1 },
  );
  wf.link(kind, openTasks, 1);
  const huddle = sbGet(
    wf,
    "Fetch: latest huddle",
    "office_meetings",
    `tenant_id=eq.${TENANT}&kind=eq.huddle&select=meeting_date,minutes,decisions&order=meeting_date.desc&limit=1`,
    { row: 1 },
  );
  const plan = sbGet(
    wf,
    "Fetch: latest plan",
    "office_notes",
    `tenant_id=eq.${TENANT}&role=eq.academic_incharge&select=body,facts,created_at&order=created_at.desc&limit=1`,
    { row: 1 },
  );
  const mktgNote = sbGet(
    wf,
    "Fetch: latest marketing",
    "office_notes",
    `tenant_id=eq.${TENANT}&role=eq.marketing_manager&select=body,facts,created_at&order=created_at.desc&limit=1`,
    { row: 1 },
  );
  const mktgBudget = sbGet(
    wf,
    "Fetch: marketing budget",
    "office_marketing_budget",
    `tenant_id=eq.${TENANT}&status=neq.archived&select=month,unit,channel,cap_amount,allocated,spent,currency&order=month.desc&limit=100`,
    { row: 1 },
  );
  const transNote = sbGet(
    wf,
    "Fetch: latest transport",
    "office_notes",
    `tenant_id=eq.${TENANT}&role=eq.transport_manager&select=body,facts,created_at&order=created_at.desc&limit=1`,
    { row: 1 },
  );
  const transBudget = sbGet(
    wf,
    "Fetch: transport budget",
    "office_transport_budget",
    `tenant_id=eq.${TENANT}&status=neq.archived&select=month,channel,cap_amount,allocated,spent,currency&order=month.desc&limit=100`,
    { row: 1 },
  );
  wf.chain(openTasks, huddle, plan, mktgNote, mktgBudget, transNote, transBudget);
  const commandReplies = code(
    wf,
    "Build: command replies",
    `${JS_TG}${JS_DATES}
const rows = (name) => { try { return $(name).all().map((i) => i.json).filter((r) => r && Object.keys(r).length); } catch (e) { return []; } };
const tasks = rows('Fetch: open tasks').filter((r) => r.id);
const meeting = rows('Fetch: latest huddle')[0] || null;
const planNote = rows('Fetch: latest plan')[0] || null;
const mktg = rows('Fetch: latest marketing')[0] || null;
const budgetRows = rows('Fetch: marketing budget');
const trans = rows('Fetch: latest transport')[0] || null;
const transBudgetRows = rows('Fetch: transport budget');
const asks = $('Parse: updates').all().map((i) => i.json).filter((u) => u.kind === 'command');
const today = isoDate(istNow());
const line = (t) => '#' + t.id + ' [' + t.to_role + '] ' + t.title + (t.due_on ? ' (due ' + t.due_on + ')' : '') + (t.approval_state === 'pending' ? ' — waiting for you' : '');
const out = [];
const send = (chat_id, text, keyboard) => {
  const chunks = tgChunks(text);
  chunks.forEach((c, i) => {
    const tg = { chat_id, text: c, parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard && i === chunks.length - 1) tg.reply_markup = { inline_keyboard: keyboard };
    out.push({ json: { tg_method: 'sendMessage', tg } });
  });
};
for (const a of asks) {
  if (a.callback_id) out.push({ json: { tg_method: 'answerCallbackQuery', tg: { callback_query_id: a.callback_id } } });
  if (a.cmd === 'start') {
    const who = a.role ? 'You are the ' + a.role + '.' : 'This chat is not registered yet. Give the office this chat id: <code>' + tgEscape(a.chat_id) + '</code>';
    send(a.chat_id, '<b>BHB office bot</b>\\n' + who + (a.role ? '\\n\\n/drafts — replies waiting for your decision\\n/tasks — open tasks (tap to close or defer)\\n/huddle — this morning\\'s minutes\\n/plan — today\\'s substitution plan\\n/marketing — cost per lead, spend vs budget, this week\\'s survey beats\\n/transport — fleet safety, fuel, spend vs budget' : ''));
    continue;
  }
  if (a.cmd === 'not_director') { send(a.chat_id, 'Only the director decides drafts.'); continue; }
  if (a.cmd === 'drafts') {
    const drafts = tasks.filter((t) => t.approval_state === 'pending' && t.source === 'receptionist');
    if (!drafts.length) { send(a.chat_id, 'No draft is waiting for a decision.'); continue; }
    const text = '<b>Drafts waiting (' + drafts.length + ')</b>\\n' + drafts.map((t) => { const p = t.payload || {}; return '#' + t.id + ' ' + tgEscape((p.category || '') + ' → ' + (p.to_name || p.to || '') + ' — ' + (p.subject || t.title)); }).join('\\n');
    const keyboard = a.role === 'director' ? drafts.slice(0, 10).map((t) => [{ text: '✅ Approve ' + t.id, callback_data: 'approve:' + t.id }, { text: '❌ Reject ' + t.id, callback_data: 'reject:' + t.id }]) : null;
    send(a.chat_id, text, keyboard);
    continue;
  }
  if (a.cmd === 'tasks') {
    if (!tasks.length) { send(a.chat_id, 'No open tasks.'); continue; }
    const body = '<b>Open tasks (' + tasks.length + ')</b>\\n' + tasks.map((t) => tgEscape(line(t))).join('\\n');
    let keyboard = null;
    if (a.role === 'director') {
      keyboard = tasks.slice(0, 8).map((t) => [{ text: '✅ Done ' + t.id, callback_data: 'done:' + t.id }, { text: '💤 Snooze ' + t.id, callback_data: 'snooze:' + t.id }]);
      keyboard.push([{ text: '✅ Clear all ' + tasks.length, callback_data: 'doneall' }]);
    }
    send(a.chat_id, body + (tasks.length > 8 ? '\\n\\n(Buttons for the first 8 - for the rest reply /done <id> or /snooze <id>.)' : ''), keyboard);
    continue;
  }
  if (a.cmd === 'huddle') {
    if (!meeting) { send(a.chat_id, 'No huddle on record yet.'); continue; }
    const dec = Array.isArray(meeting.decisions) ? meeting.decisions : [];
    send(a.chat_id, '<b>Huddle ' + tgEscape(meeting.meeting_date) + '</b>\\n' + tgEscape(String(meeting.minutes || '').slice(0, 3000)) + (dec.length ? '\\n\\n<b>Decisions</b>\\n' + dec.map((d) => tgEscape('• ' + (d.to_role || '') + ': ' + (d.title || '') + (d.due_on ? ' by ' + d.due_on : ''))).join('\\n') : ''));
    continue;
  }
  if (a.cmd === 'plan') {
    if (!planNote) { send(a.chat_id, 'No substitution plan on record yet.'); continue; }
    const when = String(planNote.created_at || '').slice(0, 10);
    send(a.chat_id, (when === today ? '<b>Today\\'s plan</b>\\n' : '<b>No plan yet today — last plan ' + tgEscape(when) + '</b>\\n') + tgEscape(String(planNote.body || '').slice(0, 3500)));
    continue;
  }
  if (a.cmd === 'marketing') {
    const month = today.slice(0, 7);
    const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const thisMonth = budgetRows.filter((b) => String(b.month || '').slice(0, 7) === month);
    const f = (mktg && mktg.facts) || {};
    const lines = ['<b>Marketing — ' + tgEscape(month) + '</b>'];
    // Cost per lead (from the latest weekly note's facts; never invented here).
    const cpl = Array.isArray(f.cost_per_lead) ? f.cost_per_lead : [];
    if (cpl.length) {
      lines.push('\\n<b>Cost per lead</b>');
      for (const c of cpl) lines.push(tgEscape('• ' + (c.unit || '?') + ' / ' + (c.channel || '?') + ': ' + (c.leads != null ? c.leads + ' leads' : '') + (c.cpl != null && c.cpl !== '' ? ', CPL ' + (typeof c.cpl === 'number' ? inr(c.cpl) : c.cpl) : '')));
    }
    // Spend vs budget (caps are live from the budget table; spent is from the note).
    lines.push('\\n<b>Spend vs budget</b>');
    for (const b of thisMonth) lines.push(tgEscape('• ' + (b.unit || '?') + ' / ' + (b.channel || '?') + ': cap ' + inr(b.cap_amount) + ', allocated ' + inr(b.allocated) + ', spent ' + (b.spent != null ? inr(b.spent) : 'not known')));
    // Monthly per-portal ask: Google Ads, Facebook, WhatsApp, for school + ITI.
    const askPortals = [['google_ads', 'Google Ads'], ['meta', 'Facebook'], ['whatsapp', 'WhatsApp']];
    const askUnits = [['school', 'School'], ['iti', 'ITI']];
    const have = new Set(thisMonth.map((b) => (b.unit || '') + '/' + (b.channel || '')));
    const missing = [];
    for (const [u, uL] of askUnits) for (const [c, cL] of askPortals) if (!have.has(u + '/' + c)) missing.push(uL + ' / ' + cL);
    if (missing.length) {
      lines.push(tgEscape('Not set for ' + month + ' yet: ' + missing.join(', ') + '.'));
      lines.push(tgEscape('Reply with the amounts and I\\'ll set them — e.g. "Google 5000, Facebook 3000, WhatsApp 2000 for the school".'));
    }
    // Week's beat plan.
    const beats = Array.isArray(f.beat_plan) ? f.beat_plan : [];
    if (beats.length) {
      lines.push('\\n<b>This week\\'s beats</b>');
      for (const bt of beats.slice(0, 8)) lines.push(tgEscape((bt.rank ? bt.rank + '. ' : '• ') + (bt.beat || (Array.isArray(bt.villages) ? bt.villages.slice(0, 3).join(', ') : '')) + (bt.child_population ? ' — ~' + bt.child_population + ' children' : '') + (bt.past_enquiries != null ? ', ' + bt.past_enquiries + ' past enq' : '')));
    }
    if (!cpl.length && !beats.length) {
      if (mktg) { lines.push('\\n' + tgEscape(String(mktg.body || '').slice(0, 2500))); }
      else lines.push('\\nNo weekly marketing note on record yet — the Marketing Manager runs Monday morning.');
    }
    send(a.chat_id, lines.join('\\n'));
    continue;
  }
  if (a.cmd === 'transport') {
    const month = today.slice(0, 7);
    const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const thisMonth = transBudgetRows.filter((b) => String(b.month || '').slice(0, 7) === month);
    const f = (trans && trans.facts) || {};
    const lines = ['<b>Transport — ' + tgEscape(month) + '</b>'];
    // Fleet safety, from the latest note's facts (never invented here).
    const fs = Array.isArray(f.fleet_safety) ? f.fleet_safety : [];
    const silent = fs.filter((b) => b.status && b.status !== 'reporting');
    if (fs.length) {
      lines.push('\\n<b>Fleet</b>');
      lines.push(tgEscape(fs.length + ' bus(es); ' + (fs.length - silent.length) + ' reporting' + (silent.length ? ', ' + silent.length + ' not' : '')));
      for (const b of silent.slice(0, 8)) lines.push(tgEscape('• ' + (b.bus || '?') + ': ' + (b.status || '') + (b.last_seen ? ' (last ' + b.last_seen + ')' : '')));
    }
    if (f.alerts_sos != null || f.alerts_overspeed != null) lines.push(tgEscape('Alerts (24h): ' + (f.alerts_sos || 0) + ' SOS, ' + (f.alerts_overspeed || 0) + ' over-speed'));
    // Fuel register state.
    if (f.fuel_last_fill) lines.push(tgEscape('Fuel: last fill ' + f.fuel_last_fill + (f.fuel_days_stale != null && f.fuel_days_stale > 7 ? ' (' + f.fuel_days_stale + ' days ago — register stale)' : '') + (f.fuel_month_spend != null ? ', spent ' + inr(f.fuel_month_spend) + ' this month' : '')));
    // Spend vs budget (caps live from the transport budget table).
    lines.push('\\n<b>Spend vs budget</b>');
    if (thisMonth.length) for (const b of thisMonth) lines.push(tgEscape('• ' + (b.channel || '?') + ': cap ' + inr(b.cap_amount) + ', allocated ' + inr(b.allocated) + ', spent ' + (b.spent != null ? inr(b.spent) : 'not known')));
    else lines.push(tgEscape('No cap set for ' + month + ' yet.'));
    // Monthly ask: diesel, maintenance for the fleet.
    const askChannels = [['diesel', 'Diesel'], ['maintenance', 'Maintenance']];
    const have = new Set(thisMonth.map((b) => b.channel || ''));
    const missing = askChannels.filter(([c]) => !have.has(c)).map(([, cL]) => cL);
    if (missing.length) {
      lines.push(tgEscape('Not set for ' + month + ' yet: ' + missing.join(', ') + '.'));
      lines.push(tgEscape('Reply with the amounts and I\\'ll set them — e.g. "diesel 40000, maintenance 10000 this month".'));
    }
    if (!fs.length && !thisMonth.length) {
      if (trans) lines.push('\\n' + tgEscape(String(trans.body || '').slice(0, 2500)));
      else lines.push('\\nNo transport note on record yet — the Transport Manager runs every morning.');
    }
    send(a.chat_id, lines.join('\\n'));
    continue;
  }
}
return out;
`,
    { row: 1 },
  );
  wf.link(mktgBudget, commandReplies);
  wf.link(commandReplies, reply);

  /* -- task actions: done / snooze / clear -- */
  const applyTaskActions = code(
    wf,
    "Apply: task actions",
    `${JS_TG}${JS_DATES}
return (async () => {
const asks = $('Parse: updates').all().map((i) => i.json).filter((u) => u.kind === 'taskaction');
const SB = String($env.SUPABASE_URL || '').replace(/\\/$/, '');
const KEY = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
const TENANT = String($env.OFFICE_TENANT_ID || '');
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const now = new Date().toISOString();
const tomorrow = isoDate(new Date(istNow().getTime() + 86400000));
const sb = async (method, pathq, body) => {
  const res = await this.helpers.httpRequest({ method, url: SB + '/rest/v1/' + pathq, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (typeof res === 'string') { try { return JSON.parse(res); } catch (e) { return []; } }
  return res;
};
const open = await sb('GET', 'office_tasks?tenant_id=eq.' + TENANT + '&status=in.(open,doing)&select=id,to_role,title,due_on,payload&order=created_at.asc&limit=200');
const openArr = Array.isArray(open) ? open : [];
const openIds = new Set(openArr.map((t) => Number(t.id)));
const out = [];
const seen = new Set();
for (const a of asks) {
  if (a.callback_id) out.push({ json: { tg_method: 'answerCallbackQuery', tg: { callback_query_id: a.callback_id } } });
  let ids = [];
  if (a.action === 'doneall') ids = openArr.map((t) => Number(t.id));
  else if (a.task_id && openIds.has(Number(a.task_id))) ids = [Number(a.task_id)];
  if (!ids.length) { out.push({ json: { tg_method: 'sendMessage', tg: { chat_id: a.chat_id, text: a.task_id ? 'No open task #' + a.task_id + '.' : 'No open tasks to clear.' } } }); continue; }
  let done = 0;
  for (const id of ids) {
    if (seen.has(id)) continue; seen.add(id);
    const cur = openArr.find((t) => Number(t.id) === id) || {};
    const patch = a.action === 'snooze' ? { due_on: tomorrow, updated_at: now, payload: { ...(cur.payload || {}), snoozed_until: tomorrow, snoozed_by: 'director' } } : { status: 'done', decided_by: 'director', decided_at: now, updated_at: now };
    try { await sb('PATCH', 'office_tasks?id=eq.' + id + '&tenant_id=eq.' + TENANT, patch); done += 1; } catch (e) {}
  }
  const label = a.action === 'doneall' ? ('Cleared ' + done + ' open task' + (done === 1 ? '' : 's') + '.') : (a.action === 'snooze' ? ('Task #' + ids[0] + ' snoozed to ' + tomorrow + '.') : ('Task #' + ids[0] + ' closed.'));
  out.push({ json: { tg_method: 'sendMessage', tg: { chat_id: a.chat_id, text: '✅ ' + label } } });
}
return out;
})();
`,
  );
  wf.link(kind, applyTaskActions, 2);
  wf.link(applyTaskActions, reply);

  /* ── assistant: any other director message → the ERP office brain ──
     The bot is a thin relay: it POSTs the text to /api/office/assistant and
     renders the reply. 'answer'/'action_done'/'error' → a text message;
     'file' → a Telegram document; 'draft' → a pending office_tasks row plus
     an Approve/Reject message (whose tap flows through the decision path
     above, where an assistant draft is sent by the ERP). */
  const assistReq = code(
    wf,
    "Build: assistant request",
    `
const asks = $('Parse: updates').all().map((i) => i.json).filter((u) => u.kind === 'assistant');
return asks.map((a) => ({ json: { chat_id: a.chat_id,
  assist: { text: a.text, chat_id: a.chat_id, locale: /[\\u0900-\\u097F]/.test(a.text || '') ? 'hi' : 'en' } } }));
`,
  );
  wf.link(kind, assistReq, 3);
  const erpAssist = wf.add(
    "ERP: assistant",
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.ERP_BASE_URL }}/api/office/assistant",
      sendHeaders: true,
      headerParameters: { parameters: ASSIST_HEADERS },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.assist) }}",
      options: { timeout: 120000 },
    },
    { onError: "continueRegularOutput", alwaysOutputData: true },
  );
  wf.link(assistReq, erpAssist);
  const routeAssist = code(
    wf,
    "Route: assistant reply",
    `${JS_TG}
// One ERP response per asked message (paired by order). Classify each into a
// text reply, a document to send, or a draft to store + offer for approval.
const reqs = $('Build: assistant request').all().map((i) => i.json);
const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const r = (items[i] && items[i].json) || {};
  const chat_id = (reqs[i] && reqs[i].chat_id) || r.chat_id || TG_CHATS.director;
  const kind = String(r.kind || '');
  if (!kind) {
    out.push({ json: { _route: 'text', chat_id, tg_method: 'sendMessage', tg: { chat_id, text: 'The office assistant could not be reached just now. Please try again in a moment.', parse_mode: 'HTML', disable_web_page_preview: true } } });
    continue;
  }
  if (kind === 'file' && (r.fileBase64 || r.fileUrl)) {
    if (r.fileBase64) {
      out.push({ json: { _route: 'file', chat_id, caption: String(r.caption || '').slice(0, 1000) },
        binary: { data: { data: r.fileBase64, mimeType: r.mime || 'application/pdf', fileName: r.filename || 'report.pdf' } } });
    } else {
      out.push({ json: { _route: 'text', chat_id, tg_method: 'sendDocument', tg: { chat_id, document: r.fileUrl, caption: String(r.caption || '').slice(0, 1000) } } });
    }
    continue;
  }
  if (kind === 'draft' && r.draft) {
    const summary = String(r.summary || (r.draft && r.draft.recipientLabel) || 'Draft');
    out.push({ json: { _route: 'draft', chat_id, draft: r.draft, summary,
      row: { tenant_id: $env.OFFICE_TENANT_ID, from_role: 'director', to_role: 'director',
        title: summary.slice(0, 80), detail: String(r.draft.body || '').slice(0, 600),
        status: 'open', source: 'assistant', approval_state: 'pending',
        payload: { assistant_draft: r.draft, summary, kind: 'assistant_draft' } } } });
    continue;
  }
  const text = String(r.text || 'Done.');
  for (const chunk of tgChunks(tgEscape(text))) {
    out.push({ json: { _route: 'text', chat_id, tg_method: 'sendMessage', tg: { chat_id, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true } } });
  }
}
return out;
`,
  );
  wf.link(erpAssist, routeAssist);
  const assistRoute = switchOn(wf, "Switch: assistant route", "_route", ["text", "file", "draft"]);
  wf.link(routeAssist, assistRoute);
  // text → the shared reply sender (sendMessage / editMessageText etc.)
  wf.link(assistRoute, reply, 0);
  // file → sendDocument (multipart with the PDF as binary)
  const sendDoc = wf.add(
    "Telegram: sendDocument",
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendDocument' }}",
      sendBody: true,
      contentType: "multipart-form-data",
      bodyParameters: {
        parameters: [
          { name: "chat_id", value: "={{ $json.chat_id }}" },
          { name: "caption", value: "={{ $json.caption }}" },
          { parameterType: "formBinaryData", name: "document", inputDataFieldName: "data" },
        ],
      },
      options: { timeout: 120000 },
    },
    { onError: "continueRegularOutput" },
  );
  wf.link(assistRoute, sendDoc, 1);
  // draft → store a pending office_tasks row, then offer Approve / Reject
  const insertDraft = sbInsert(wf, "Insert: assistant draft", "office_tasks", "row", { alwaysOutputData: true });
  wf.link(assistRoute, insertDraft, 2);
  const draftMsg = code(
    wf,
    "Build: draft approval",
    `${JS_TG}
// The insert returns the created rows (return=representation); pair each with
// its draft (same order) and send the body with Approve/Reject buttons whose
// callback_data is approve:<id> / reject:<id> — the decision path acts on it.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.id);
const asks = $('Route: assistant reply').all().map((i) => i.json).filter((r) => r._route === 'draft');
const out = [];
for (let i = 0; i < rows.length; i++) {
  const id = rows[i].id;
  const a = asks[i] || {};
  const d = a.draft || {};
  const chat_id = a.chat_id || TG_CHATS.director;
  const to = d.recipientLabel ? ('\\n<i>To: ' + tgEscape(d.recipientLabel) + (d.recipient && d.recipient.count ? ' (' + d.recipient.count + ')' : '') + '</i>') : '';
  const head = '✍️ <b>Draft for approval</b>\\n' + tgEscape(a.summary || d.recipientLabel || '') + to;
  const text = tgChunks(head + '\\n\\n' + tgEscape(String(d.body || ''))).slice(-1)[0];
  out.push({ json: { tg_method: 'sendMessage', tg: { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'approve:' + id }, { text: '❌ Reject', callback_data: 'reject:' + id }]] } } } });
}
return out;
`,
  );
  wf.link(insertDraft, draftMsg);
  wf.link(draftMsg, reply);
  return wf;
}

/* ═══════════════════════════════════════════════════════════════
   5. Marketing Manager
   ═══════════════════════════════════════════════════════════════
   Monday 06:00 IST (before the 06:30 huddle). Reads the monthly budget
   caps (office_marketing_budget), the villages within 15 km (village_travel
   + village_demographics), enquiries by village (admission_lead_market_state)
   and by source (admission_desk_leads), last fortnight's field survey
   (survey_days / survey_captures), the active beats, any director-approved
   cap change, and — best effort — Google Ads performance for the one shared
   account (school + ITI kept apart by campaign). Sonnet drafts the weekly
   marketing note: cost per lead by unit, spend vs budget, a ranked 15 km
   beat plan, and Meta/WhatsApp campaign drafts. Nothing spends or publishes:
   the note and a 📋 button go to the director and principal, and every
   proposal (cap change, campaign spend, ad copy, beat assignment) is a
   pending office_tasks row with its own Approve/Reject on Telegram. Within
   an existing cap the Manager sets its own allocation (a write to
   office_marketing_budget only); raising a cap or spending where none is set
   waits for the director. */
function buildMarketingManager() {
  const wf = new Workflow(
    "Office — Marketing Manager",
    "Monday 06:00 IST: reads the marketing budget caps, Google Ads (best effort; waiting on verification), 15 km villages + census + enquiries, and the field survey; Sonnet drafts cost-per-lead, spend-vs-budget, a ranked beat plan and Meta/WhatsApp campaign drafts; the note goes to the director/principal and every spend or public word is a pending office_tasks row approved on Telegram.",
  );
  const W = "marketing-manager";

  const trigger = cron(wf, "Every Monday 06:00 IST", "0 6 * * 1");
  const ctx = code(
    wf,
    "Context",
    `${JS_DATES}
const now = istNow();
const today = isoDate(now);
const monthStart = today.slice(0, 8) + '01';
const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
const weekStart = isoDate(new Date(now.getTime() - dow * 86400000));
const since = (n) => isoDate(new Date(now.getTime() - n * 86400000));
return [{ json: { today, monthStart, weekStart, weekday: now.getUTCDay(), ay: academicYearCode(now),
  since7: since(7), since14: since(14), since30: since(30), since90: since(90),
  since7iso: new Date(Date.now() - 7 * 86400000).toISOString(), run_at: new Date().toISOString() } }];
`,
  );
  wf.chain(trigger, ctx);

  const getBudget = sbGet(
    wf,
    "Fetch: budget this month",
    "office_marketing_budget",
    `tenant_id=eq.${TENANT}&status=neq.archived&select=month,unit,channel,cap_amount,allocated,spent,currency&order=month.desc&limit=200`,
  );
  const getApprovedCaps = sbGet(
    wf,
    "Fetch: approved cap changes",
    "office_tasks",
    `tenant_id=eq.${TENANT}&source=eq.marketing&approval_state=eq.approved&status=eq.done&select=id,title,payload,decided_at&order=decided_at.desc&limit=50`,
  );
  // Villages within 15 km by road (village_travel.distance_km), census joined
  // in (FK village_travel.village_id → village_demographics.id). ~226 rows:
  // one bounded page, not the whole ~4k-village table.
  const getVillages = sbGet(
    wf,
    "Fetch: villages within 15km",
    "village_travel",
    `tenant_id=eq.${TENANT}&distance_km=lte.15&select=village_id,distance_km,duration_minutes,village_demographics(id,village_name,block_name,estimated_current_child_pop,child_0_6_total_2011)&order=distance_km.asc&limit=400`,
  );
  const getLeadVillages = sbGet(
    wf,
    "Fetch: enquiries by village",
    "admission_lead_market_state",
    `tenant_id=eq.${TENANT}&village_id=not.is.null&select=village_id,lead_score,lead_status,touchpoints&limit=1000`,
  );
  const getRecentLeads = sbGet(
    wf,
    "Fetch: recent leads",
    "admission_desk_leads",
    `tenant_id=eq.${TENANT}&lead_date=gte.{{ $('Context').first().json.since90 }}&select=id,source,stage,lead_date&order=lead_date.desc&limit=1000`,
  );
  const getSurveyDays = sbGet(
    wf,
    "Fetch: recent survey days",
    "survey_days",
    `tenant_id=eq.${TENANT}&day=gte.{{ $('Context').first().json.since14 }}&select=day,status,beat_id,member_name,staff_id&order=day.desc&limit=500`,
  );
  const getCaptures = sbGet(
    wf,
    "Fetch: survey captures 7d",
    "survey_captures",
    `tenant_id=eq.${TENANT}&captured_at=gte.{{ encodeURIComponent($('Context').first().json.since7iso) }}&select=id,lead_id,captured_at&limit=1000`,
  );
  const getBeats = sbGet(
    wf,
    "Fetch: active beats",
    "admission_survey_beats",
    `tenant_id=eq.${TENANT}&is_active=eq.true&select=id,code,name,area,target_households,note&limit=200`,
  );
  const getTasks = sbGet(
    wf,
    "Fetch: my open tasks",
    "office_tasks",
    `tenant_id=eq.${TENANT}&to_role=eq.marketing_manager&status=in.(open,doing)&select=id,title,detail,due_on,from_role,created_at&order=due_on.asc.nullslast&limit=50`,
  );
  wf.chain(ctx, getBudget, getApprovedCaps, getVillages, getLeadVillages, getRecentLeads, getSurveyDays, getCaptures, getBeats, getTasks);

  // Google Ads — the one shared account (school + ITI). Best effort: the
  // account is paused for advertiser verification and no service-account key
  // is on the VM yet, so this returns ads_status 'pending' and NO numbers
  // until the director sets the env below and verification clears. When set,
  // it signs a service-account JWT, gets an OAuth token (scope adwords) and
  // runs a GAQL report; a campaign is school or iti by its name (contains
  // "ITI") until proper campaign labels are applied. Any failure is reported,
  // never guessed. require('crypto') only runs when configured — the compose
  // file sets NODE_FUNCTION_ALLOW_BUILTIN=crypto.
  const googleAds = code(
    wf,
    "Google Ads: read",
    `
return (async () => {
  const cid = String($env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\\D/g, '');
  const clientEmail = String($env.GOOGLE_ADS_CLIENT_EMAIL || '').trim();
  let privateKey = String($env.GOOGLE_ADS_PRIVATE_KEY || '').trim();
  const saJson = String($env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON || '').trim();
  const devToken = String($env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  const loginCid = String($env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\\D/g, '');
  const impersonate = String($env.GOOGLE_ADS_IMPERSONATE_EMAIL || '').trim();
  const apiVer = String($env.GOOGLE_ADS_API_VERSION || 'v21').trim();
  let email = clientEmail, key = privateKey;
  if (saJson) { try { const j = JSON.parse(saJson); email = email || j.client_email; key = key || j.private_key; } catch (e) {} }
  if (key) key = key.replace(/\\\\n/g, '\\n');
  const pending = (note) => [{ json: { ads_status: 'pending', ads_note: note, ads_by_unit: [], campaigns: [] } }];
  if (!cid || !email || !key) return pending('Google Ads not configured — waiting on advertiser verification and the service-account key on the VM.');
  try {
    const crypto = require('crypto');
    const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
    const nowS = Math.floor(Date.now() / 1000);
    const claim = { iss: email, scope: 'https://www.googleapis.com/auth/adwords', aud: 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 };
    if (impersonate) claim.sub = impersonate;
    const signingInput = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(claim);
    const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key).toString('base64url');
    const assertion = signingInput + '.' + signature;
    const tok = await this.helpers.httpRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion), json: true });
    const accessToken = tok && tok.access_token;
    if (!accessToken) return pending('Google Ads token exchange returned no access_token.');
    const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    if (devToken) headers['developer-token'] = devToken;
    if (loginCid) headers['login-customer-id'] = loginCid;
    const gaql = 'SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS';
    const res = await this.helpers.httpRequest({ method: 'POST', url: 'https://googleads.googleapis.com/' + apiVer + '/customers/' + cid + '/googleAds:searchStream',
      headers, body: { query: gaql }, json: true });
    const batches = Array.isArray(res) ? res : [res];
    const byCampaign = {};
    for (const b of batches) for (const r of (b.results || [])) {
      const c = r.campaign || {}; const m = r.metrics || {};
      const id = String(c.id || '');
      const unit = /\\biti\\b/i.test(String(c.name || '')) ? 'iti' : 'school';
      const row = byCampaign[id] || (byCampaign[id] = { campaign: c.name || id, unit, status: c.status || '', cost: 0, clicks: 0, impressions: 0, conversions: 0 });
      row.cost += Number(m.costMicros || m.cost_micros || 0) / 1e6;
      row.clicks += Number(m.clicks || 0); row.impressions += Number(m.impressions || 0); row.conversions += Number(m.conversions || 0);
    }
    const campaigns = Object.values(byCampaign);
    const byUnit = {};
    for (const c of campaigns) { const u = byUnit[c.unit] || (byUnit[c.unit] = { unit: c.unit, cost: 0, clicks: 0, conversions: 0, campaigns: 0 }); u.cost += c.cost; u.clicks += c.clicks; u.conversions += c.conversions; u.campaigns += 1; }
    return [{ json: { ads_status: 'ok', ads_note: 'Google Ads LAST_30_DAYS (' + campaigns.length + ' campaigns). Unit split by campaign name until labels are applied.', ads_by_unit: Object.values(byUnit), campaigns } }];
  } catch (e) {
    return pending('Google Ads read failed: ' + String((e && e.message) || e).slice(0, 300) + ' (account may still be paused for verification).');
  }
})();
`,
  );
  wf.chain(getTasks, googleAds);

  const assemble = code(
    wf,
    "Assemble",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.marketing_manager)};
const ctx = $('Context').first().json;
const rows = (name) => { try { return $(name).all().map((i) => i.json).filter((r) => r && Object.keys(r).length); } catch (e) { return []; } };
const budget = rows('Fetch: budget this month').filter((b) => String(b.month || '').slice(0, 10) === ctx.monthStart);
const approvedCaps = rows('Fetch: approved cap changes');
const villages = rows('Fetch: villages within 15km');
const leadVillages = rows('Fetch: enquiries by village');
const recentLeads = rows('Fetch: recent leads');
const surveyDays = rows('Fetch: recent survey days');
const captures = rows('Fetch: survey captures 7d');
const beats = rows('Fetch: active beats');
const tasks = rows('Fetch: my open tasks');
const ads = (() => { try { return $('Google Ads: read').first().json; } catch (e) { return { ads_status: 'pending', ads_note: 'Google Ads node did not run.', ads_by_unit: [], campaigns: [] }; } })();

// enquiries per village_id from the market-state table
const enqByVillage = {};
for (const l of leadVillages) enqByVillage[l.village_id] = (enqByVillage[l.village_id] || 0) + 1;

// rank the 15 km villages: child population first, past enquiries as a tie-shaper
const ranked = villages.map((v) => {
  const d = v.village_demographics || {};
  const child = Number(d.estimated_current_child_pop || d.child_0_6_total_2011 || 0);
  const enq = enqByVillage[v.village_id] || 0;
  return { village: d.village_name || v.village_id, block: d.block_name || '', distance_km: v.distance_km, child_population: child, past_enquiries: enq };
}).sort((a, b) => (b.child_population - a.child_population) || (b.past_enquiries - a.past_enquiries));
const topVillages = ranked.slice(0, 45);

// enquiries by source (last 30 days) and recent volume
const d30 = ctx.since30;
const bySource = {};
let leads30 = 0, leads7 = 0;
for (const l of recentLeads) {
  if (l.lead_date >= d30) { leads30 += 1; bySource[l.source || 'unknown'] = (bySource[l.source || 'unknown'] || 0) + 1; }
  if (l.lead_date >= ctx.since7) leads7 += 1;
}
const surveySummary = { days_14d: surveyDays.length, days_active_now: surveyDays.filter((s) => s.status === 'active').length, captures_7d: captures.length };

const data = {
  week_of: ctx.weekStart, month: ctx.monthStart, academic_year: ctx.ay,
  budget_caps: budget.map((b) => ({ unit: b.unit, channel: b.channel, cap: Number(b.cap_amount || 0), allocated: Number(b.allocated || 0), spent: b.spent == null ? 'not known' : Number(b.spent), currency: b.currency || 'INR' })),
  budget_set: budget.length > 0,
  approved_cap_changes: approvedCaps.map((t) => ({ title: t.title, unit: (t.payload || {}).mk_unit, channel: (t.payload || {}).mk_channel, amount: (t.payload || {}).amount, decided_at: t.decided_at })),
  google_ads: { status: ads.ads_status, note: ads.ads_note, by_unit: ads.ads_by_unit || [], campaigns: (ads.campaigns || []).slice(0, 30) },
  enquiries_last_30d: leads30, enquiries_last_7d: leads7, enquiries_by_source_30d: bySource,
  villages_within_15km: villages.length, top_villages: topVillages,
  active_beats: beats.map((b) => ({ code: b.code, name: b.name, area: b.area, target_households: b.target_households })),
  field_survey: surveySummary,
  my_open_tasks: tasks.map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, from: t.from_role })),
};
const user = 'Prepare this week\\'s marketing review and plan from the data below. Keep the school and the ITI on separate lines. Where a cost per lead has no spend or no attributed leads, write "not known" — do not invent. Return only the JSON object described in your charter under "Output format".\\n\\n' + JSON.stringify(data);
return [{ json: { ctx, counts: { villages: villages.length, leads30, leads7, beats: beats.length, proposals_in: 0 }, ads_status: ads.ads_status, budget_set: budget.length > 0,
  request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 3000, effort: 'medium' }) } }];
`,
  );
  wf.chain(googleAds, assemble);

  const parse = claudeCall(wf, { key: "marketing", workflow: W, role: "marketing_manager", carryFrom: assemble, each: false });

  const outputs = code(
    wf,
    "Build: outputs",
    `
const it = $input.first().json;
const p = it.parsed || {};
const summary = it.parse_error ? ('Marketing note could not be structured: ' + it.parse_error + '\\n' + String(it.text || '').slice(0, 800)) : String(p.summary || '').trim();
const cpl = Array.isArray(p.cost_per_lead) ? p.cost_per_lead : [];
const svb = Array.isArray(p.spend_vs_budget) ? p.spend_vs_budget : [];
const beats = Array.isArray(p.beat_plan) ? p.beat_plan : [];
const proposals = Array.isArray(p.proposals) ? p.proposals : [];
const drafts = Array.isArray(p.drafts) ? p.drafts : [];
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const UNIT = ['school', 'iti', 'shared'];
const CHAN = ['google_ads', 'meta', 'whatsapp', 'survey', 'other'];

const cplLines = cpl.map((c) => '• ' + (c.unit || '?') + ' / ' + (c.channel || '?') + ': ' + (c.leads != null ? c.leads + ' leads' : '') + (c.cpl != null && c.cpl !== '' ? ', CPL ' + (typeof c.cpl === 'number' ? inr(c.cpl) : c.cpl) : ''));
const svbLines = svb.map((s) => '• ' + (s.unit || '?') + ' / ' + (s.channel || '?') + ': cap ' + inr(s.cap) + ', allocated ' + inr(s.allocated) + ', spent ' + (s.spent == null || s.spent === '' ? 'not known' : (typeof s.spent === 'number' ? inr(s.spent) : s.spent)));
const beatLines = beats.slice(0, 10).map((b) => (b.rank ? b.rank + '. ' : '• ') + (b.beat || (Array.isArray(b.villages) ? b.villages.slice(0, 3).join(', ') : '')) + (b.child_population ? ' — ~' + b.child_population + ' children' : '') + (b.past_enquiries != null ? ', ' + b.past_enquiries + ' past enq' : ''));
const head = '📣 Marketing — week of ' + it.ctx.weekStart;

// Monthly budget ask — Google Ads, Facebook (Meta), WhatsApp, for the school
// and the ITI. We ask whenever a cap is missing for the CURRENT month, so each
// new month (which starts with no caps) prompts the director, and the nudge
// auto-clears per portal as each is set. The director answers in the Telegram
// console — "Google 5000, Facebook 3000, WhatsApp 2000 for the school" — and
// the ERP records it (set_marketing_budget). No figure is ever guessed here.
const ASK_PORTALS = [['google_ads', 'Google Ads'], ['meta', 'Facebook'], ['whatsapp', 'WhatsApp']];
const ASK_UNITS = [['school', 'School'], ['iti', 'ITI']];
const allBudget = (() => { try { return $('Fetch: budget this month').all().map((i) => i.json).filter((r) => r && r.month); } catch (e) { return []; } })();
const prevMonthStart = (() => { const d = new Date(it.ctx.monthStart + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const capRow = (m, u, c) => allBudget.find((r) => String(r.month || '').slice(0, 10) === m && (r.unit || '') === u && (r.channel || '') === c);
const askMissing = [];
for (const [u, uLabel] of ASK_UNITS) for (const [c, cLabel] of ASK_PORTALS) {
  if (!capRow(it.ctx.monthStart, u, c)) { const prev = capRow(prevMonthStart, u, c); askMissing.push({ u, c, uLabel, cLabel, prevCap: prev ? Number(prev.cap_amount || 0) : null }); }
}
const monthName = (() => { try { return new Date(it.ctx.monthStart + 'T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return String(it.ctx.monthStart || '').slice(0, 7); } })();
const budgetAsk = askMissing.length
  ? '🧮 Ad budget for ' + monthName + ' not set yet:\\n' + askMissing.map((m) => '• ' + m.uLabel + ' / ' + m.cLabel + (m.prevCap != null ? ' (last month ' + inr(m.prevCap) + ')' : '')).join('\\n') + '\\n\\nReply here with the amounts and I\\'ll set them — e.g. "Google 5000, Facebook 3000, WhatsApp 2000 for the school".'
  : '';

const wa_text = [head, summary,
  it.ads_status !== 'ok' ? 'Google Ads: not known — waiting on verification/keys.' : '',
  cplLines.length ? 'Cost per lead:\\n' + cplLines.join('\\n') : '',
  svbLines.length ? 'Spend vs budget:\\n' + svbLines.join('\\n') : '',
  budgetAsk,
  beatLines.length ? 'This week\\'s beats:\\n' + beatLines.join('\\n') : '',
  (proposals.length || drafts.length) ? (proposals.length + drafts.length) + ' proposal(s) below for your Approve/Reject.' : ''].filter(Boolean).join('\\n\\n');

const note_row = { tenant_id: $env.OFFICE_TENANT_ID, role: 'marketing_manager', note_date: it.ctx.today,
  body: wa_text.slice(0, 4000),
  facts: { week: it.ctx.weekStart, cost_per_lead: cpl, spend_vs_budget: svb, beat_plan: beats.slice(0, 12), proposals: proposals.length, drafts: drafts.length,
    ads_status: it.ads_status, budget_set: it.budget_set, budget_ask_month: askMissing.length ? it.ctx.monthStart : '', budget_ask_missing: askMissing.map((m) => m.u + '/' + m.c), villages_15km: it.counts.villages, leads_30d: it.counts.leads30, leads_7d: it.counts.leads7, parse_error: it.parse_error || '' } };

// Gated proposals (cap change, campaign spend, beat assignment) and campaign
// drafts (ad copy) each become ONE pending office_tasks row the director
// approves on Telegram. Capped at 8 so the board does not flood.
const task_rows = [];
for (const pr of proposals) {
  task_rows.push({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'marketing_manager', to_role: 'director',
    title: String(pr.title || 'Marketing proposal').slice(0, 80), detail: String(pr.detail || '').slice(0, 600),
    status: 'open', source: 'marketing', approval_state: 'pending',
    payload: { kind: 'marketing_proposal', mk_kind: String(pr.kind || ''), mk_unit: UNIT.includes(pr.unit) ? pr.unit : '', mk_channel: CHAN.includes(pr.channel) ? pr.channel : '', amount: Number(pr.amount || 0), week: it.ctx.weekStart } });
}
for (const d of drafts) {
  const detail = String(d.copy || '').slice(0, 480) + (d.creative_brief ? '\\n\\nBrief: ' + String(d.creative_brief).slice(0, 200) : '') + '\\nProposed spend: ' + (d.proposed_spend ? inr(d.proposed_spend) : 'not stated');
  task_rows.push({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'marketing_manager', to_role: 'director',
    title: ('Approve ' + (d.channel || '') + ' copy (' + (d.unit || '') + ', ' + (d.language || '') + ')').slice(0, 80), detail: detail.slice(0, 600),
    status: 'open', source: 'marketing', approval_state: 'pending',
    payload: { kind: 'marketing_draft', mk_kind: 'ad_copy', mk_unit: UNIT.includes(d.unit) ? d.unit : '', mk_channel: CHAN.includes(d.channel) ? d.channel : '', amount: Number(d.proposed_spend || 0), language: d.language || '', copy: String(d.copy || '').slice(0, 2000), week: it.ctx.weekStart } });
}
const capped = task_rows.slice(0, 8);

// Budget writes the Manager may make on its own: an allocation WITHIN an
// existing cap, and a director-approved cap change (idempotent). Never a new
// or larger cap on its own — that is one of the proposals above.
const existing = (() => { try { return $('Fetch: budget this month').all().map((i) => i.json).filter((r) => r && r.month); } catch (e) { return []; } })();
const curCaps = {};
for (const r of existing) if (String(r.month || '').slice(0, 10) === it.ctx.monthStart) curCaps[(r.unit || '') + ':' + (r.channel || '')] = r;
const now = new Date().toISOString();
const budget_upserts = [];
for (const s of svb) {
  const cap = curCaps[(s.unit || '') + ':' + (s.channel || '')];
  if (!cap) continue;
  const alloc = Math.max(0, Math.min(Number(s.allocated || 0), Number(cap.cap_amount || 0)));
  budget_upserts.push({ tenant_id: $env.OFFICE_TENANT_ID, month: it.ctx.monthStart, unit: s.unit, channel: s.channel, allocated: alloc, updated_at: now });
}
const approved = (() => { try { return $('Fetch: approved cap changes').all().map((i) => i.json).filter((r) => r && r.id); } catch (e) { return []; } })();
approved.sort((a, b) => String(a.decided_at || '').localeCompare(String(b.decided_at || '')));
for (const t of approved) {
  const pl = t.payload || {};
  if (pl.mk_kind !== 'budget_cap' || !UNIT.includes(pl.mk_unit) || !CHAN.includes(pl.mk_channel) || !(Number(pl.amount) > 0)) continue;
  budget_upserts.push({ tenant_id: $env.OFFICE_TENANT_ID, month: it.ctx.monthStart, unit: pl.mk_unit, channel: pl.mk_channel, cap_amount: Number(pl.amount), status: 'active', decided_by: 'director', decided_at: t.decided_at || now, updated_at: now });
}

return [{ json: { note_row, task_rows: capped, budget_upserts, text: wa_text, to: ['director', 'principal'], tasks_button: true } }];
`,
  );
  wf.link(parse, outputs);
  wf.link(outputs, sbInsert(wf, "Insert: marketing note", "office_notes", "note_row"));

  // allocations + approved caps → office_marketing_budget (upsert on the
  // (tenant, month, unit, channel) unique key; merge so an allocation-only
  // row keeps its cap).
  const budgetFilter = code(
    wf,
    "Budget upserts?",
    `
const u = $input.first().json.budget_upserts || [];
return u.length ? [{ json: { rows: u } }] : [];
`,
    { row: 1 },
  );
  wf.link(outputs, budgetFilter);
  const upsertBudget = wf.add(
    "Upsert: marketing budget",
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.SUPABASE_URL }}/rest/v1/office_marketing_budget?on_conflict=tenant_id,month,unit,channel",
      sendHeaders: true,
      headerParameters: {
        parameters: [...SB_HEADERS, { name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.rows) }}",
      options: { timeout: 30000 },
    },
    { row: 1, onError: "continueRegularOutput" },
  );
  wf.link(budgetFilter, upsertBudget);

  // Proposals → pending office_tasks → one Approve/Reject message each.
  const proposalsFilter = code(
    wf,
    "Proposals to insert",
    `
const r = $input.first().json.task_rows || [];
return r.length ? [{ json: { rows: r } }] : [];
`,
    { row: 2 },
  );
  wf.link(outputs, proposalsFilter);
  const insertProposals = sbInsert(wf, "Insert: marketing proposals", "office_tasks", "rows", { row: 2, alwaysOutputData: true });
  wf.link(proposalsFilter, insertProposals);
  const approvalMsgs = code(
    wf,
    "Build: marketing approvals",
    `
const rows = $input.all().map((i) => i.json).filter((r) => r && r.id);
const out = [];
for (const t of rows) {
  const p = t.payload || {};
  const what = [p.mk_unit, p.mk_channel].filter(Boolean).join(' / ');
  const amt = Number(p.amount || 0) > 0 ? ' ₹' + Number(p.amount).toLocaleString('en-IN') : '';
  const head = '🧾 Proposal #' + t.id + (what ? ' (' + what + ')' : '') + amt;
  const text = head + '\\n' + String(t.title || '') + '\\n\\n' + String(t.detail || '');
  out.push({ json: { text, to: ['director'], approval: { draft_id: String(t.id), summary: (head + ' — ' + String(t.title || '')).slice(0, 300) } } });
}
return out;
`,
    { row: 2 },
  );
  wf.link(insertProposals, approvalMsgs);
  internalChain(wf, "Marketing approval", approvalMsgs);

  // The weekly note + a 📋 Open tasks button to the director and principal.
  internalChain(wf, "Marketing", outputs);

  return wf;
}

/* ═══════════════════════════════════════════════════════════════
   6. Transport Manager
   ═══════════════════════════════════════════════════════════════
   Daily 06:15 IST (before the 06:30 huddle). Safety first: reads the live GPS
   positions (fleet_vehicle_positions) and the fleet-edge SOS/over-speed events,
   then the fuel register, loan/payable dues, the transport budget caps, and the
   transport desk (vehicles, routes, assignments, fee policy) for the expected
   fleet and fee coverage. Sonnet writes the morning note: which buses are
   reporting, any SOS / over-speed, the fuel register's state and spend, dues
   coming up, and spend vs budget. Nothing drives, spends or sends: the note
   goes to the director and principal, anything needing the director is one
   plain open office_tasks row (closed/snoozed on Telegram), and each month it
   asks the director for the diesel/maintenance budget (set on the console).
   The real-time SOS already WhatsApps the office; this is the morning summary.
   Empty loan/payable tables and a stale fuel register are reported as such,
   never guessed; a bus with no recent ping is "not reporting", never "did not
   run". */
function buildTransportManager() {
  const wf = new Workflow(
    "Office — Transport Manager",
    "Daily 06:15 IST: reads GPS positions + fleet-edge SOS/over-speed, the fuel register, loan/payable dues, the transport budget caps and the transport desk; Sonnet writes a safety-first morning note (buses reporting, alerts, fuel, dues, spend vs budget) to the director/principal; anything needing the director is a plain open task and each month it asks for the diesel/maintenance budget.",
  );
  const W = "transport-manager";

  const trigger = cron(wf, "Every day 06:15 IST", "15 6 * * *");
  const ctx = code(
    wf,
    "Context",
    `${JS_DATES}
const now = istNow();
const today = isoDate(now);
const monthStart = today.slice(0, 8) + '01';
const since = (h) => new Date(Date.now() - h * 3600000).toISOString();
return [{ json: { today, monthStart, ay: academicYearCode(now),
  since12h: since(12), since24h: since(24), since48h: since(48), run_at: new Date().toISOString() } }];
`,
  );
  wf.chain(trigger, ctx);

  const getPositions = sbGet(
    wf,
    "Fetch: positions 12h",
    "fleet_vehicle_positions",
    `tenant_id=eq.${TENANT}&recorded_at=gte.{{ encodeURIComponent($('Context').first().json.since12h) }}&select=registration_number,vehicle_ref,recorded_at,speed_kmh,ignition_on,gps_fix,fuel_percent,odometer_km&order=recorded_at.desc&limit=2000`,
  );
  const getAlerts = sbGet(
    wf,
    "Fetch: alerts 24h",
    "fleet_edge_events",
    `tenant_id=eq.${TENANT}&event_at=gte.{{ encodeURIComponent($('Context').first().json.since24h) }}&alert_name=not.is.null&select=alert_name,registration_number,vehicle_ref,event_at&order=event_at.desc&limit=200`,
  );
  const getFuel = sbGet(
    wf,
    "Fetch: fuel fills",
    "transport_fuel_fills",
    `tenant_id=eq.${TENANT}&voided_at=is.null&select=fill_date,vehicle_id,quantity,amount_paise,odometer_km,dealer_name,fuel_type&order=fill_date.desc&limit=60`,
  );
  const getLoans = sbGet(
    wf,
    "Fetch: loan schedule",
    "accounts_desk_owner_loan_schedule",
    `tenant_id=eq.${TENANT}&status=neq.paid&select=loan_id,installment_no,due_on,amount_paise,status&order=due_on.asc&limit=50`,
  );
  const getPayables = sbGet(
    wf,
    "Fetch: transport payables",
    "transport_payables",
    `tenant_id=eq.${TENANT}&status=neq.paid&select=id,vehicle_id,dealer_id,amount_paise,due_on,status,source_type&order=due_on.asc&limit=50`,
  );
  const getBudget = sbGet(
    wf,
    "Fetch: transport budget",
    "office_transport_budget",
    `tenant_id=eq.${TENANT}&status=neq.archived&select=month,channel,cap_amount,allocated,spent,currency&order=month.desc&limit=200`,
  );
  const getSlices = sbGet(
    wf,
    "Fetch: transport desk",
    "transport_desk_slices",
    `tenant_id=eq.${TENANT}&slice_key=in.(vehicles,routes,assignments,feePolicy)&select=slice_key,payload`,
  );
  const getTasks = sbGet(
    wf,
    "Fetch: my open tasks",
    "office_tasks",
    `tenant_id=eq.${TENANT}&to_role=eq.transport_manager&status=in.(open,doing)&select=id,title,detail,due_on,from_role,created_at&order=due_on.asc.nullslast&limit=50`,
  );
  wf.chain(ctx, getPositions, getAlerts, getFuel, getLoans, getPayables, getBudget, getSlices, getTasks);

  const assemble = code(
    wf,
    "Assemble",
    `${JS_REQUEST}
const SYSTEM = ${JSON.stringify(ROLE_CHARTERS.transport_manager)};
const ctx = $('Context').first().json;
const rows = (name) => { try { return $(name).all().map((i) => i.json).filter((r) => r && Object.keys(r).length); } catch (e) { return []; } };
const positions = rows('Fetch: positions 12h');
const alertRows = rows('Fetch: alerts 24h');
const fuel = rows('Fetch: fuel fills');
const loans = rows('Fetch: loan schedule');
const payables = rows('Fetch: transport payables');
const budget = rows('Fetch: transport budget');
const sliceRows = rows('Fetch: transport desk');
const tasks = rows('Fetch: my open tasks');

const sliceOf = (k) => { const r = sliceRows.find((s) => s.slice_key === k); return r ? r.payload : null; };
const vehicles = Array.isArray(sliceOf('vehicles')) ? sliceOf('vehicles') : [];
const assignments = Array.isArray(sliceOf('assignments')) ? sliceOf('assignments') : [];
const feePolicy = sliceOf('feePolicy') || {};
const norm = (s) => String(s || '').replace(/\\s/g, '').toUpperCase();

// Expected fleet from the transport desk (active buses only).
const expected = vehicles.filter((v) => v && v.isActive !== false && v.status !== 'retired' && v.status !== 'inactive')
  .map((v) => ({ reg: norm(v.registrationNo), name: v.name || '', driver: v.driverName || '', mobile: v.driverMobile || '' }))
  .filter((v) => v.reg || v.name);

// GPS positions → last-seen per registration.
const seen = {};
for (const p of positions) {
  const reg = norm(p.registration_number);
  if (!reg) continue;
  const cur = seen[reg] || (seen[reg] = { reg, last_seen: p.recorded_at, pings: 0, gps: false });
  cur.pings += 1;
  if (!cur.last_seen || p.recorded_at > cur.last_seen) cur.last_seen = p.recorded_at;
  if (p.gps_fix) cur.gps = true;
}
const nowMs = Date.now();
const hoursSince = (iso) => { const ms = new Date(iso).getTime(); return isFinite(ms) ? Math.round((nowMs - ms) / 36000) / 100 : null; };
const fleet = expected.map((v) => {
  const s = seen[v.reg];
  let status = 'silent', last_seen = null, flag = null;
  if (s) {
    last_seen = s.last_seen;
    const h = hoursSince(s.last_seen);
    if (h != null && h <= 3) status = s.gps ? 'reporting' : 'no_gps';
    else status = 'silent';
    if (status === 'silent') flag = 'last seen ' + (h != null ? h + 'h ago' : 'unknown');
    else if (status === 'no_gps') flag = 'pinging without a GPS fix';
  } else { flag = 'no ping in the last 12h'; }
  return { bus: v.reg || v.name, name: v.name, driver: v.driver, status, last_seen, flag };
});
// Trackers that ping but map to no expected bus (e.g. registration 'NA').
const expectedRegs = new Set(expected.map((v) => v.reg).filter(Boolean));
const unmapped = Object.values(seen).filter((s) => !expectedRegs.has(s.reg)).map((s) => ({ reg: s.reg, pings: s.pings, last_seen: s.last_seen }));

// Fleet-edge alerts in the last 24h.
let sos = 0, overspeed = 0;
const alertItems = [];
for (const a of alertRows) {
  const n = String(a.alert_name || '');
  if (/sos|panic/i.test(n)) sos += 1; else if (/speed/i.test(n)) overspeed += 1;
  if (alertItems.length < 10) alertItems.push({ kind: /sos|panic/i.test(n) ? 'sos' : 'overspeed', bus: a.registration_number || a.vehicle_ref || '', at: a.event_at });
}

// Fuel register: last fill, staleness, this month's spend, rough mileage.
const monthYm = ctx.monthStart.slice(0, 7);
let monthSpend = 0;
for (const f of fuel) if (String(f.fill_date || '').slice(0, 7) === monthYm) monthSpend += Number(f.amount_paise || 0) / 100;
const lastFill = fuel[0] ? fuel[0].fill_date : null;
const daysStale = lastFill ? Math.round((nowMs - new Date(lastFill + 'T00:00:00Z').getTime()) / 86400000) : null;
const byVeh = {};
for (const f of fuel) (byVeh[f.vehicle_id] || (byVeh[f.vehicle_id] = [])).push(f);
const mileage = [];
for (const vid of Object.keys(byVeh)) {
  const withOdo = byVeh[vid].filter((f) => Number(f.odometer_km) > 0).sort((a, b) => String(b.fill_date).localeCompare(String(a.fill_date)));
  if (withOdo.length >= 2) { const d = Number(withOdo[0].odometer_km) - Number(withOdo[1].odometer_km); const litres = Number(withOdo[0].quantity || 0); if (d > 0 && litres > 0) mileage.push({ vehicle_id: vid, kmpl: Math.round(d / litres * 100) / 100 }); }
}

// Transport-fee coverage from the desk assignments (expected only — paid status
// is not yet wired to the fees ledger).
const activeAssign = assignments.filter((a) => a && !a.effectiveTo && !a.boardingSuspended);
const transportStudents = activeAssign.length;
const expectedFee = Math.round(activeAssign.reduce((s, a) => s + Number(a.monthlyFeePaise || 0), 0) / 100);

// Obligations from the records on file (empty is reported as empty).
const obligations = [];
for (const l of loans) obligations.push({ kind: 'emi', what: 'Loan ' + (l.loan_id || '') + ' instalment ' + (l.installment_no || ''), due_on: l.due_on, amount: Number(l.amount_paise || 0) / 100, status: l.status });
for (const p of payables) obligations.push({ kind: 'payable', what: 'Payable ' + (p.source_type || ''), due_on: p.due_on, amount: Number(p.amount_paise || 0) / 100, status: p.status });
const obligationsEmpty = obligations.length === 0;

const caps = budget;
const capsThisMonth = caps.filter((b) => String(b.month || '').slice(0, 10) === ctx.monthStart);

const data = {
  date: ctx.today, month: ctx.monthStart, academic_year: ctx.ay,
  fleet, unmapped_trackers: unmapped, buses_expected: expected.length, buses_reporting: fleet.filter((b) => b.status === 'reporting').length,
  alerts_24h: { sos, overspeed, items: alertItems },
  fuel: { last_fill: lastFill, days_since_last_fill: daysStale, month_spend: monthSpend, recent: fuel.slice(0, 8).map((f) => ({ fill_date: f.fill_date, vehicle_id: f.vehicle_id, litres: Number(f.quantity || 0), amount: Number(f.amount_paise || 0) / 100, dealer: f.dealer_name || '' })), mileage_kmpl: mileage },
  transport_fee: { students: transportStudents, expected_monthly_fee: expectedFee, note: 'per-student paid status not yet wired to the fees ledger' },
  obligations, obligations_note: obligationsEmpty ? 'No loan/EMI or dealer-payable records on file.' : '',
  repair_approval_threshold: Number(feePolicy.repairApprovalPaise || 0) / 100,
  budget_caps: capsThisMonth.map((b) => ({ channel: b.channel, cap: Number(b.cap_amount || 0), allocated: Number(b.allocated || 0), spent: b.spent == null ? 'not known' : Number(b.spent), currency: b.currency || 'INR' })),
  budget_set: capsThisMonth.length > 0,
  my_open_tasks: tasks.map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, from: t.from_role })),
};
const user = 'Write this morning\\'s transport note from the data below. Safety first: name any bus that is not reporting and any SOS or over-speed. Do not say a bus did or did not run — only whether it is reporting. Where a figure is missing (a fuel-register gap, no EMI records, spend not known), say so plainly; never invent one. Return only the JSON object described in your charter under "Output format".\\n\\n' + JSON.stringify(data);
return [{ json: { ctx, fleet, alerts: { sos, overspeed, items: alertItems }, fuelInfo: { last_fill: lastFill, days_stale: daysStale, month_spend: monthSpend }, dues: { transport_students: transportStudents, expected_monthly_fee: expectedFee }, obligations, obligations_empty: obligationsEmpty, caps, budget_set: capsThisMonth.length > 0,
  request: claudeRequest({ model: ${JSON.stringify(MODELS.write)}, system: SYSTEM, user, maxTokens: 3000, effort: 'medium' }) } }];
`,
  );
  wf.chain(getTasks, assemble);

  const parse = claudeCall(wf, { key: "transport", workflow: W, role: "transport_manager", carryFrom: assemble, each: false });

  const outputs = code(
    wf,
    "Build: outputs",
    `
const it = $input.first().json;
const p = it.parsed || {};
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const CHAN = ['diesel', 'maintenance', 'insurance', 'other'];
const summary = it.parse_error ? ('Transport note could not be structured: ' + it.parse_error + '\\n' + String(it.text || '').slice(0, 800)) : String(p.summary || '').trim();
const fleet = Array.isArray(it.fleet) ? it.fleet : [];
const silent = fleet.filter((b) => b.status && b.status !== 'reporting');
const alerts = it.alerts || { sos: 0, overspeed: 0 };
const fuelInfo = it.fuelInfo || {};
const caps = Array.isArray(it.caps) ? it.caps : [];
const dues = it.dues || {};
const proposals = Array.isArray(p.proposals) ? p.proposals : [];
const svb = Array.isArray(p.spend_vs_budget) ? p.spend_vs_budget : [];

const head = '🚌 Transport — ' + it.ctx.today;
const fleetLine = fleet.length
  ? (fleet.length + ' bus(es): ' + (fleet.length - silent.length) + ' reporting' + (silent.length ? ', ' + silent.length + ' NOT — ' + silent.map((b) => b.bus).join(', ') : ''))
  : 'No buses on the transport desk roster.';
const alertLine = (alerts.sos || alerts.overspeed) ? ('⚠️ ' + (alerts.sos || 0) + ' SOS, ' + (alerts.overspeed || 0) + ' over-speed in 24h') : '';
const fuelLine = fuelInfo.last_fill
  ? ('Fuel: last fill ' + fuelInfo.last_fill + (fuelInfo.days_stale != null && fuelInfo.days_stale > 7 ? ' (' + fuelInfo.days_stale + 'd ago — register stale)' : '') + (fuelInfo.month_spend != null ? ', ' + inr(fuelInfo.month_spend) + ' this month' : ''))
  : 'Fuel: no fills on record.';
const svbLines = svb.map((s) => '• ' + (s.channel || '?') + ': cap ' + inr(s.cap) + ', allocated ' + inr(s.allocated) + ', spent ' + (s.spent == null || s.spent === '' ? 'not known' : (typeof s.spent === 'number' ? inr(s.spent) : s.spent)));
const duesLine = dues.transport_students ? (dues.transport_students + ' students on transport; expected ' + inr(dues.expected_monthly_fee) + '/month (per-student paid status not yet wired to the fees ledger)') : '';
const obLines = (Array.isArray(it.obligations) ? it.obligations : []).slice(0, 6).map((o) => '• ' + (o.what || o.kind || '') + (o.due_on ? ' due ' + o.due_on : '') + (o.amount ? ' ' + inr(o.amount) : ''));

// Monthly budget ask — diesel and maintenance for the fleet. Ask whenever a cap
// is missing for the CURRENT month, so each new month prompts the director and
// the nudge auto-clears per channel as each is set. The director answers in the
// Telegram console ("diesel 40000, maintenance 10000") and the ERP records it
// (set_transport_budget). No figure is ever guessed here.
const ASK = [['diesel', 'Diesel'], ['maintenance', 'Maintenance']];
const capAt = (m, c) => caps.find((r) => String(r.month || '').slice(0, 10) === m && (r.channel || '') === c);
const prevMonthStart = (() => { const d = new Date(it.ctx.monthStart + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const askMissing = [];
for (const [c, l] of ASK) { if (!capAt(it.ctx.monthStart, c)) { const prev = capAt(prevMonthStart, c); askMissing.push({ c, l, prev: prev ? Number(prev.cap_amount || 0) : null }); } }
const monthName = (() => { try { return new Date(it.ctx.monthStart + 'T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return String(it.ctx.monthStart || '').slice(0, 7); } })();
const budgetAsk = askMissing.length
  ? '🧮 Fleet budget for ' + monthName + ' not set yet:\\n' + askMissing.map((m) => '• ' + m.l + (m.prev != null ? ' (last month ' + inr(m.prev) + ')' : '')).join('\\n') + '\\n\\nReply here with the amounts — e.g. "diesel 40000, maintenance 10000 this month".'
  : '';

const wa_text = [head, summary, fleetLine, alertLine, fuelLine, duesLine,
  obLines.length ? 'Coming due:\\n' + obLines.join('\\n') : (it.obligations_empty ? 'EMI / dealer payables: no records on file — enter them to track.' : ''),
  svbLines.length ? 'Spend vs budget:\\n' + svbLines.join('\\n') : '',
  budgetAsk,
  proposals.length ? proposals.length + ' item(s) added to your /tasks.' : ''].filter(Boolean).join('\\n\\n');

const note_row = { tenant_id: $env.OFFICE_TENANT_ID, role: 'transport_manager', note_date: it.ctx.today,
  body: wa_text.slice(0, 4000),
  facts: { fleet_safety: fleet, alerts_sos: alerts.sos || 0, alerts_overspeed: alerts.overspeed || 0,
    fuel_last_fill: fuelInfo.last_fill || '', fuel_days_stale: fuelInfo.days_stale == null ? null : fuelInfo.days_stale, fuel_month_spend: fuelInfo.month_spend == null ? null : fuelInfo.month_spend,
    transport_students: dues.transport_students || 0, expected_monthly_fee: dues.expected_monthly_fee || 0,
    budget_ask_month: askMissing.length ? it.ctx.monthStart : '', budget_ask_missing: askMissing.map((m) => m.c), parse_error: it.parse_error || '' } };

// Anything needing the director becomes ONE plain open office_tasks row (shown
// in /tasks, closed or snoozed there). Nothing here is auto-approved or sent.
const task_rows = [];
for (const pr of proposals) {
  task_rows.push({ tenant_id: $env.OFFICE_TENANT_ID, from_role: 'transport_manager', to_role: 'director',
    title: String(pr.title || 'Transport item').slice(0, 80), detail: String(pr.detail || '').slice(0, 600),
    status: 'open', source: 'transport', approval_state: 'none',
    payload: { kind: 'transport_proposal', tr_kind: String(pr.kind || ''), tr_channel: CHAN.includes(pr.channel) ? pr.channel : '', amount: Number(pr.amount || 0), day: it.ctx.today } });
}
const capped = task_rows.slice(0, 8);

// Allocation WITHIN an existing cap only (never a new or larger cap on its own).
const curCaps = {};
for (const c of caps) if (String(c.month || '').slice(0, 10) === it.ctx.monthStart) curCaps[c.channel] = c;
const now = new Date().toISOString();
const budget_upserts = [];
for (const s of svb) {
  const cap = curCaps[s.channel];
  if (!cap) continue;
  const alloc = Math.max(0, Math.min(Number(s.allocated || 0), Number(cap.cap_amount || 0)));
  budget_upserts.push({ tenant_id: $env.OFFICE_TENANT_ID, month: it.ctx.monthStart, channel: s.channel, allocated: alloc, updated_at: now });
}

return [{ json: { note_row, task_rows: capped, budget_upserts, text: wa_text, to: ['director', 'principal'], tasks_button: true } }];
`,
  );
  wf.link(parse, outputs);
  wf.link(outputs, sbInsert(wf, "Insert: transport note", "office_notes", "note_row"));

  // Allocations → office_transport_budget (upsert on the (tenant, month,
  // channel) unique key; merge so an allocation-only row keeps its cap).
  const budgetFilter = code(
    wf,
    "Transport budget upserts?",
    `
const u = $input.first().json.budget_upserts || [];
return u.length ? [{ json: { rows: u } }] : [];
`,
    { row: 1 },
  );
  wf.link(outputs, budgetFilter);
  const upsertBudget = wf.add(
    "Upsert: transport budget",
    "n8n-nodes-base.httpRequest",
    4.2,
    {
      method: "POST",
      url: "={{ $env.SUPABASE_URL }}/rest/v1/office_transport_budget?on_conflict=tenant_id,month,channel",
      sendHeaders: true,
      headerParameters: {
        parameters: [...SB_HEADERS, { name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.rows) }}",
      options: { timeout: 30000 },
    },
    { row: 1, onError: "continueRegularOutput" },
  );
  wf.link(budgetFilter, upsertBudget);

  // Director items → plain open office_tasks (no approval branch; the director
  // closes or snoozes them from /tasks like any other open task).
  const tasksFilter = code(
    wf,
    "Transport tasks to insert",
    `
const r = $input.first().json.task_rows || [];
return r.length ? [{ json: { rows: r } }] : [];
`,
    { row: 2 },
  );
  wf.link(outputs, tasksFilter);
  const insertTasks = sbInsert(wf, "Insert: transport tasks", "office_tasks", "rows", { row: 2, alwaysOutputData: true });
  wf.link(tasksFilter, insertTasks);

  // The morning note + a 📋 Open tasks button to the director and principal.
  internalChain(wf, "Transport", outputs);

  return wf;
}

/* ─── write ─────────────────────────────────────────────────── */

const builds = {
  "receptionist.json": buildReceptionist,
  "academic-incharge.json": buildAcademicIncharge,
  "morning-huddle.json": buildMorningHuddle,
  "marketing-manager.json": buildMarketingManager,
  "transport-manager.json": buildTransportManager,
  "telegram-office-bot.json": buildTelegramBot,
};

fs.mkdirSync(outDir, { recursive: true });
for (const [file, build] of Object.entries(builds)) {
  const wf = build();
  const json = JSON.stringify(wf.toJSON(), null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, file), json);
  console.log(`${file}: ${wf.nodes.length} nodes, ${Buffer.byteLength(json)} bytes`);
}

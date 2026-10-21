#!/usr/bin/env node
/**
 * Static checks on ../workflows/*.json — run after build-workflows.mjs and
 * before importing:
 *   - each file parses and has nodes + connections + settings;
 *   - node names are unique and every connection points at a real node;
 *   - every Code node's JavaScript at least parses (syntax errors would
 *     otherwise surface only at 6 am);
 *   - every Claude call sets the model ids, the anthropic-version header
 *     and a cache_control system block; the charters embedded in the JSON
 *     are byte-identical to ../charters/*.md (i.e. the build is current);
 *   - exactly one usage-ledger insert per Claude call.
 * Exit 1 on the first failure so CI can run it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const wfDir = path.join(root, "workflows");
const charterDir = path.join(root, "charters");

const read = (p) => fs.readFileSync(p, "utf8");
const house = read(path.join(charterDir, "_house-rules.md")).trim();
const charters = Object.fromEntries(
  ["receptionist", "academic-incharge", "chair"].map((n) => [
    n,
    `${house}\n\n---\n\n${read(path.join(charterDir, `${n}.md`)).trim()}`,
  ]),
);

let failures = 0;
const fail = (file, msg) => {
  failures += 1;
  console.error(`✗ ${file}: ${msg}`);
};

for (const file of fs.readdirSync(wfDir).filter((f) => f.endsWith(".json")).sort()) {
  const text = read(path.join(wfDir, file));
  let wf;
  try {
    wf = JSON.parse(text);
  } catch (e) {
    fail(file, `invalid JSON: ${e.message}`);
    continue;
  }
  if (!Array.isArray(wf.nodes) || !wf.connections || !wf.settings) {
    fail(file, "missing nodes/connections/settings");
    continue;
  }
  const names = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) fail(file, `duplicate node name "${n.name}"`);
    names.add(n.name);
    if (!n.type || !n.typeVersion || !n.id) fail(file, `node "${n.name}" lacks type/typeVersion/id`);
  }
  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) fail(file, `connection from unknown node "${from}"`);
    for (const out of c.main || []) for (const link of out) {
      if (!names.has(link.node)) fail(file, `"${from}" links to unknown node "${link.node}"`);
    }
  }
  const triggers = wf.nodes.filter((n) => /Trigger$/i.test(n.type));
  if (!triggers.length) fail(file, "no trigger node");

  // Code nodes must at least parse. n8n's sandbox provides $input, $json,
  // $env, $(…), $runIndex, $now; `new Function` only checks syntax.
  for (const n of wf.nodes.filter((n) => n.type === "n8n-nodes-base.code")) {
    try {
      new Function("$input", "$json", "$env", "$", "$runIndex", "$now", n.parameters.jsCode);
    } catch (e) {
      fail(file, `Code node "${n.name}" does not parse: ${e.message}`);
    }
  }

  // Claude calls.
  const claude = wf.nodes.filter(
    (n) => n.type === "n8n-nodes-base.httpRequest" && /api\.anthropic\.com\/v1\/messages/.test(n.parameters.url || ""),
  );
  for (const n of claude) {
    const headers = (n.parameters.headerParameters?.parameters || []).map((h) => h.name);
    for (const h of ["x-api-key", "anthropic-version"]) {
      if (!headers.includes(h)) fail(file, `"${n.name}" lacks header ${h}`);
    }
    const ver = (n.parameters.headerParameters?.parameters || []).find((h) => h.name === "anthropic-version")?.value;
    if (ver !== "2023-06-01") fail(file, `"${n.name}" anthropic-version is ${ver}`);
    const feeders = Object.entries(wf.connections)
      .filter(([, c]) => (c.main || []).some((out) => out.some((l) => l.node === n.name)))
      .map(([from]) => from);
    const usage = (wf.connections[`Parse: ${n.name.replace(/^Claude: /, "")}`]?.main?.[0] || []).some((l) =>
      /^Log usage: /.test(l.node),
    );
    if (!usage) fail(file, `"${n.name}" has no usage-ledger leaf`);
    if (!feeders.length) fail(file, `"${n.name}" has no input`);
  }
  const usageInserts = wf.nodes.filter((n) => /^Log usage: /.test(n.name));
  if (usageInserts.length !== claude.length) {
    fail(file, `${claude.length} Claude calls but ${usageInserts.length} usage inserts`);
  }
  for (const u of usageInserts) {
    if (!/office_ai_usage/.test(u.parameters.url)) fail(file, `"${u.name}" does not write office_ai_usage`);
  }

  // Model ids, cache_control and the embedded charters.
  const code = wf.nodes.filter((n) => n.type === "n8n-nodes-base.code").map((n) => n.parameters.jsCode).join("\n");
  const models = [...code.matchAll(/model: "(claude-[a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const m of models) {
    if (!["claude-haiku-5-5", "claude-sonnet-5-5"].includes(m)) fail(file, `unexpected model id ${m}`);
  }
  if (!models.length) fail(file, "no model id found in Code nodes");
  if (!/cache_control: \{ type: 'ephemeral' \}/.test(code)) fail(file, "no cache_control on the system block");
  const embedded = [...code.matchAll(/(?:const SYSTEM = |"[a-z_]+":)("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
  const expect = {
    "receptionist.json": ["receptionist"],
    "academic-incharge.json": ["academic-incharge"],
    "morning-huddle.json": ["chair", "receptionist", "academic-incharge"],
  }[file] || [];
  for (const role of expect) {
    if (!embedded.includes(charters[role])) fail(file, `embedded charter for ${role} is stale — run scripts/build-workflows.mjs`);
  }

  console.log(`✓ ${file}: ${wf.nodes.length} nodes, ${claude.length} Claude call(s), models ${[...new Set(models)].join("+")}`);
}

if (failures) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
console.log("all workflows pass static checks");

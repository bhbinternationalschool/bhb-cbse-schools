/*
 * BHB Office Robot — the panel on the UDISE+ School Profile module
 * (profile.udiseplus.gov.in), studied read-only on 7 Oct 2026.
 *
 * The module's data API is /udiseplus/school/<id>/…, but every request
 * carries an Authorization header built from an ENCRYPTED localStorage token
 * (CryptoJS "U2FsdGVk…"), so the robot never calls it. It reads the DOM of
 * the section a person has open — formcontrolname, the question text, the
 * value — exactly as a person would read the screen.
 *
 * Every move starts with a person's click:
 *  - "Send this section to ERP" reads the open section's boxes and sends a
 *    snapshot to the ERP (Students → UDISE+ → School profile);
 *  - "Send all sections to ERP" clicks through the eight numbered section
 *    TABS (navigation only), waits for each form to draw, reads and sends it;
 *  - "Fill empty boxes from ERP" fills only EMPTY boxes in the open section
 *    with what the ERP knows or last year's answer (labelled "check"),
 *    outlined in yellow, and lists what is left.
 *
 * Never presses Save / Next / Submit / Final, never logs in, no timers or
 * background work. 1A (1.1 to 1.30) is maintained by the Block; its locked
 * boxes are read, never filled.
 */
(() => {
  if (window.__bhbProfileRobot) return;
  window.__bhbProfileRobot = true;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (n) => ((n && (n.innerText || n.textContent)) || "").replace(/\s+/g, " ").trim();

  // ─── Panel ───────────────────────────────────────────────────────────

  const panel = el("div", { id: "bhb-office-robot" });
  const head = el("header", {}, "🤖 BHB Office Robot · UDISE+ School Profile", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const sendBtn = el("button", { class: "act", type: "button" }, "Send this section to ERP");
  const allBtn = el("button", { class: "act sec", type: "button" }, "Send all sections to ERP");
  const fillBtn = el("button", { class: "act", type: "button" }, "Fill empty boxes from ERP");
  const msg = el("div", { class: "msg" });
  const note = el("div", { class: "muted" }, "The robot never presses Save / Next. You check and save.");
  body.append(sendBtn, allBtn, fillBtn, msg, note);
  panel.append(head, body);
  head.addEventListener("click", () => {
    panel.classList.toggle("min");
    head.lastChild.textContent = panel.classList.contains("min") ? "+" : "–";
  });

  const say = (text, tone = "") => {
    msg.className = `msg ${tone}`;
    msg.textContent = text;
  };
  const ask = (payload) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage(payload, (r) => resolve(r || { ok: false, error: "The robot did not answer. Reload the page." })),
    );

  // ─── Sections (tabs) ─────────────────────────────────────────────────

  const SERIAL = String.raw`\d+(?:\.\d+)*`;
  const RANGE = new RegExp(`(${SERIAL})\\s*(?:to|-|–)\\s*(${SERIAL})`, "i");
  /** "2.1 to 2.6" → "2.1-2.6" (same rule as sectionKeyFromLabel in the ERP). */
  const keyOf = (label) => {
    const m = String(label || "").match(RANGE);
    return m ? `${m[1]}-${m[2]}` : "";
  };

  /** Words on a control the robot must never press. A tab is navigation. */
  const FORBIDDEN = /\b(save|next|submit|final|finali[sz]e|update|complete|delete|reset|clear|lock)\b/i;

  function sectionTabs() {
    return [...document.querySelectorAll('[role="tab"]')].filter((t) => keyOf(textOf(t)) && t.getClientRects().length);
  }
  const isActive = (t) =>
    t.getAttribute("aria-selected") === "true" ||
    /(^|\s)(active|mat-tab-label-active|mdc-tab--active|p-highlight)(\s|$)/.test(t.className || "") ||
    !!(t.parentElement && /(^|\s)active(\s|$)/.test(t.parentElement.className || ""));
  function openTab() {
    return sectionTabs().find(isActive) || null;
  }

  /** The open section's container: the visible tab panel with the most boxes, else the page. */
  function sectionRoot() {
    const panels = [...document.querySelectorAll('[role="tabpanel"]')].filter((p) => p.getClientRects().length);
    if (!panels.length) return document.body;
    return panels.sort((a, b) => b.querySelectorAll("input,select,textarea").length - a.querySelectorAll("input,select,textarea").length)[0];
  }

  // ─── Reading the form ────────────────────────────────────────────────

  const SKIP_TYPES = /^(hidden|button|submit|reset|image|file|password|search)$/i;
  const NATIVE = /^(INPUT|SELECT|TEXTAREA)$/;
  const visible = (n) => !!n && n.getClientRects().length > 0;

  /** The custom widget (ng-select, mat-select …) a native box belongs to, if any. */
  function customHost(n) {
    const h = n.parentElement && n.parentElement.closest("[formcontrolname]");
    return h && !NATIVE.test(h.tagName) ? h : null;
  }

  /** Question text for a control: <label for>, the wrapping label, its table row/column, or the text before it. */
  function labelFor(node, isGroup) {
    if (!isGroup && node.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
        if (l && textOf(l)) return textOf(l);
      } catch {
        /* an id CSS cannot escape: fall through */
      }
    }
    if (isGroup) {
      // A radio group's question sits beside its options, inside the group's box.
      const q = [...node.children].find((c) => !c.querySelector("input,select,textarea") && c.tagName !== "LABEL" && textOf(c));
      if (q) return textOf(q).slice(0, 300);
    } else {
      const aria = node.getAttribute && node.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();
      const lab = node.closest && node.closest("label");
      if (lab && textOf(lab)) return textOf(lab);
    }
    const td = node.closest && node.closest("td");
    if (td && td.parentElement) {
      const cells = [...td.parentElement.children];
      const idx = cells.indexOf(td);
      const rowHead = cells
        .slice(0, idx)
        .filter((c) => !c.querySelector("input,select,textarea"))
        .map(textOf)
        .filter(Boolean)
        .join(" ");
      const table = td.closest("table");
      const hr = table && (table.querySelector("thead tr") || table.querySelector("tr"));
      const colHead = hr && hr !== td.parentElement && hr.children[idx] ? textOf(hr.children[idx]) : "";
      const t = [rowHead, colHead].filter(Boolean).join(" › ");
      if (t) return t.slice(0, 300);
    }
    let cur = node;
    for (let d = 0; d < 6 && cur && cur !== document.body; d++) {
      // Never read past the open section: the tab strip is not a question.
      if (cur.getAttribute && cur.getAttribute("role") === "tabpanel") break;
      let sib = cur.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
        if (sib.querySelector && sib.querySelector("input,select,textarea")) break;
        const t = textOf(sib);
        if (t && t.length <= 300) return t;
      }
      cur = cur.parentElement;
    }
    return (node.getAttribute && node.getAttribute("placeholder")) || "";
  }

  /** The nearest DCF serial heading ("1.21 Respondent Details") above a control. */
  function serialNear(node, label) {
    const own = label.match(/^\s*(\d+\.\d+(?:\.\d+)*)/);
    if (own) return { serial: own[1], heading: "" };
    const re = new RegExp(`^\\s*\\(?(\\d+\\.\\d+(?:\\.\\d+)*)\\)?\\s*(.{0,80})`);
    let cur = node;
    for (let d = 0; d < 10 && cur && cur !== document.body; d++) {
      // Never read past the open section: the tab strip is not a question.
      if (cur.getAttribute && cur.getAttribute("role") === "tabpanel") break;
      let sib = cur.previousElementSibling;
      for (let i = 0; i < 8 && sib; i++, sib = sib.previousElementSibling) {
        // A block with its own boxes is another question, not a heading.
        if (sib.querySelector && sib.querySelector("input,select,textarea")) continue;
        if (RANGE.test(textOf(sib))) continue; // a section tab, not a question
        const m = textOf(sib).match(re);
        if (m) return { serial: m[1], heading: m[2].split(/\s{2,}|\n/)[0].trim() };
      }
      cur = cur.parentElement;
    }
    return { serial: "", heading: "" };
  }

  function optionText(radio) {
    return textOf(radio.closest("label")) || (radio.nextSibling && String(radio.nextSibling.textContent || "").trim()) || textOf(radio.parentElement);
  }

  function readEntry(e) {
    if (e.type === "radio") {
      const on = e.nodes.find((r) => r.checked);
      return { value: on ? String(on.value) : "", text: on ? optionText(on) : "" };
    }
    if (e.type === "checkbox") return { value: e.nodes[0].checked ? "true" : "false", text: "" };
    const n = e.nodes[0];
    if (e.type === "select") {
      const o = n.selectedOptions && n.selectedOptions[0];
      return { value: String(n.value || ""), text: o ? textOf(o) || o.text : "" };
    }
    if (e.type === "custom") {
      const v = n.querySelector(".ng-value, .mat-select-value-text, .mat-mdc-select-value-text, .p-dropdown-label, .selected-value");
      const inner = n.querySelector("input:not([type=hidden])");
      return { value: "", text: v ? textOf(v) : inner ? String(inner.value || "") : "" };
    }
    return { value: String(n.value || "").trim(), text: "" };
  }

  /**
   * Every visible box of the open section, in page order, each with a stable
   * key: formcontrolname, else name, else id; a repeated key gets "~2", "~3"
   * (FormArray rows), and a box with none gets "box@<n>". The same walk
   * finds the box again when filling.
   */
  function enumerate(root) {
    const entries = [];
    const seen = new Map();
    const groups = new Map();
    const claim = (base) => {
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base}~${n}`;
    };
    let anon = 0;
    for (const n of root.querySelectorAll("input, select, textarea, [formcontrolname]")) {
      if (panel.contains(n)) continue;
      const native = NATIVE.test(n.tagName);
      if (native && n.tagName === "INPUT" && SKIP_TYPES.test(n.type || "")) continue;
      if (native && customHost(n)) {
        // A radio/checkbox inside a mat-radio-group-like host is still a radio.
        if (!/^(radio|checkbox)$/i.test(n.type || "")) continue;
      }
      if (!native) {
        // A host wrapping real radios / checkboxes is read through them.
        if (n.querySelector("input[type=radio], input[type=checkbox]")) continue;
        if (!visible(n)) continue;
        const key = claim(n.getAttribute("formcontrolname"));
        entries.push({ key, type: "custom", nodes: [n], locked: /disabled/.test(n.className || "") || n.getAttribute("aria-disabled") === "true" });
        continue;
      }
      const type = n.tagName === "SELECT" ? "select" : n.tagName === "TEXTAREA" ? "textarea" : String(n.type || "text").toLowerCase();
      const host = customHost(n);
      const base = n.getAttribute("formcontrolname") || (host && host.getAttribute("formcontrolname")) || n.getAttribute("name") || n.id || "";
      if (type === "radio") {
        // Radios are grouped by their key; invisible styled radios still count when their label shows.
        if (!visible(n) && !visible(n.closest("label") || n.parentElement)) continue;
        const gk = base || `radio@${anon}`;
        if (groups.has(gk)) {
          groups.get(gk).nodes.push(n);
          continue;
        }
        const e = { key: claim(gk), type: "radio", nodes: [n], locked: false };
        groups.set(gk, e);
        entries.push(e);
        continue;
      }
      if (!visible(n) && !(type === "checkbox" && visible(n.closest("label") || n.parentElement))) continue;
      const key = claim(base || `box@${++anon}`);
      const t = type === "checkbox" ? "checkbox" : type === "select" ? "select" : type === "textarea" ? "textarea" : type === "number" ? "number" : type === "date" ? "date" : "text";
      entries.push({ key, type: t, nodes: [n], locked: !!(n.disabled || n.readOnly) });
    }
    for (const e of entries) if (e.type === "radio") e.locked = e.nodes.every((r) => r.disabled);
    return entries;
  }

  function groupAnchor(nodes) {
    let anc = nodes[0].parentElement;
    while (anc && anc !== document.body && !nodes.every((r) => anc.contains(r))) anc = anc.parentElement;
    return anc || nodes[0];
  }

  function readSection() {
    const root = sectionRoot();
    const fields = {};
    for (const e of enumerate(root)) {
      const anchor = e.type === "radio" ? groupAnchor(e.nodes) : e.nodes[0];
      const isGroup = e.type === "radio" && e.nodes.length > 1;
      let label = labelFor(anchor, isGroup);
      if (e.type === "checkbox" && !label) label = textOf(e.nodes[0].parentElement);
      const { serial, heading } = serialNear(anchor, label);
      if (heading && !label.toLowerCase().includes(heading.toLowerCase().slice(0, 20))) label = `${serial} ${heading} › ${label}`;
      else if (serial && !label.startsWith(serial)) label = `${serial} ${label}`;
      const { value, text } = readEntry(e);
      fields[e.key] = { label: label.slice(0, 400), serial, type: e.type, value, text, locked: e.locked };
    }
    let text = root.innerText || "";
    if (root.contains(panel)) text = text.replace(panel.innerText || "", "");
    const status = (text.match(/Form\s*Status\s*:?\s*([A-Za-z][A-Za-z ]{2,30}?)(?:\s{2,}|\n|$)/i) || [])[1] || "";
    return { fields, text: text.slice(0, 30000), formStatus: status.trim() };
  }

  // ─── Year ────────────────────────────────────────────────────────────

  let chosenYear = "";
  const normYear = (s) => {
    const m = String(s || "").match(/(20\d\d)\s*[-–/]\s*(\d{2}|20\d\d)/);
    if (!m) return "";
    const a = Number(m[1]);
    const b = m[2].length === 2 ? Math.floor(a / 100) * 100 + Number(m[2]) : Number(m[2]);
    return b === a + 1 ? `${a}-${String(b).slice(2)}` : "";
  };
  /** The year the portal shows; if it shows none, the person says which — never a guess. */
  function portalYear() {
    const t = document.body.innerText || "";
    const m = t.match(/Academic\s*Year\s*[:\-]?\s*(20\d\d\s*[-–]\s*(?:20)?\d\d)/i);
    if (m && normYear(m[1])) return normYear(m[1]);
    for (const s of document.querySelectorAll("select")) {
      const o = s.selectedOptions && s.selectedOptions[0];
      if (o && /^\s*20\d\d\s*-\s*(20)?\d\d\s*$/.test(o.text) && normYear(o.text)) return normYear(o.text);
    }
    if (chosenYear) return chosenYear;
    const d = new Date();
    const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const answer = window.prompt("Which academic year is open on the UDISE+ portal? (e.g. 2026-27)", `${start}-${String(start + 1).slice(2)}`);
    chosenYear = normYear(answer || "");
    if (!chosenYear) throw new Error("No academic year given — nothing sent.");
    return chosenYear;
  }

  // ─── Send ────────────────────────────────────────────────────────────

  async function waitSettled(ms = 15000) {
    const until = Date.now() + ms;
    let last = -1;
    let stable = 0;
    while (Date.now() < until) {
      await sleep(500);
      const n = enumerate(sectionRoot()).length;
      if (n === last) stable++;
      else stable = 0;
      last = n;
      if ((n > 0 && stable >= 2) || (n === 0 && stable >= 8)) return n;
    }
    return last;
  }

  async function sendOpen(ay) {
    const tab = openTab();
    if (!tab) throw new Error("Open a numbered section tab (e.g. “2.1 to 2.6”) of the School Profile first.");
    // The tab also prints the form status ("Needs Updation"); keep the name only.
    const tabText = textOf(tab).replace(/\s*(completed|needs\s*updation|in\s*progress|pending)\s*$/i, "");
    const key = keyOf(tabText);
    await waitSettled(6000);
    const snap = readSection();
    if (!Object.keys(snap.fields).length && !snap.text.trim()) throw new Error(`${tabText}: the form has not drawn yet. Wait a moment and try again.`);
    const res = await ask({
      type: "profile-send",
      academicYear: ay,
      section: { key, tab: tabText, title: tabText.replace(RANGE, "").trim() },
      fields: snap.fields,
      formStatus: snap.formStatus,
      text: snap.text,
    });
    if (!res.ok) throw new Error(`${tabText}: ${res.error}`);
    return { key, tabText, body: res.body };
  }

  function findings(b) {
    const lines = [];
    for (const w of (b && b.respondent) || []) lines.push(`⚠ ${w}`);
    for (const d of (b && b.differences) || []) lines.push(`1A vs ERP — ${d.item}: portal “${d.portal}”, ERP “${d.erp}”`);
    return lines;
  }

  async function sendThis() {
    const ay = portalYear();
    say("Reading this section…");
    const r = await sendOpen(ay);
    const lines = [`✓ ${r.tabText} (${ay}) — ${r.body.fieldCount} box(es) sent to the ERP.`, ...findings(r.body)];
    lines.push("See Students → UDISE+ → School profile in the ERP.");
    return lines.join("\n");
  }

  async function sendAll() {
    if (document.querySelector(".bhb-robot-filled")) {
      throw new Error("This section has boxes the robot filled. Press the portal's own Save first (or reload) — moving between tabs could lose them.");
    }
    if (!window.confirm("The robot will click through the 8 section tabs (no saving) and send each to the ERP. Unsaved typing on the open section may be lost. Continue?")) {
      return "Not started.";
    }
    const ay = portalYear();
    const start = openTab();
    const keys = sectionTabs().map((t) => keyOf(textOf(t)));
    if (!keys.length) throw new Error("No section tabs on this page. Open the School Profile dashboard first.");
    const lines = [];
    const extra = [];
    for (const key of keys) {
      // Tabs may redraw after each click: find this one afresh.
      const tab = sectionTabs().find((t) => keyOf(textOf(t)) === key);
      if (!tab) {
        lines.push(`✗ ${key}: tab not found`);
        continue;
      }
      if (FORBIDDEN.test(textOf(tab).replace(/needs\s+updation|completed/gi, "")) || (/^(BUTTON|INPUT)$/.test(tab.tagName) && /submit/i.test(tab.type || ""))) {
        lines.push(`✗ ${key}: skipped — not a plain tab`);
        continue;
      }
      say(`Opening ${textOf(tab)}…\n${lines.join("\n")}`);
      if (!isActive(tab)) tab.click();
      const until = Date.now() + 10000;
      while (!isActive(tab) && Date.now() < until) await sleep(300);
      if (!isActive(tab)) {
        lines.push(`✗ ${key}: the tab did not open (a portal message?) — stopped here.`);
        break;
      }
      try {
        const r = await sendOpen(ay);
        lines.push(`✓ ${r.tabText}: ${r.body.fieldCount} box(es)`);
        extra.push(...findings(r.body));
      } catch (e) {
        lines.push(`✗ ${e.message || e}`);
      }
    }
    if (start && !isActive(start)) {
      const back = sectionTabs().find((t) => keyOf(textOf(t)) === keyOf(textOf(start)));
      if (back) back.click();
    }
    return [`Sent to the ERP (${ay}):`, ...lines, ...extra, "Nothing was saved on the portal."].join("\n");
  }

  // ─── Fill ────────────────────────────────────────────────────────────

  const setNative = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  function stillEmpty(e) {
    const { value, text } = readEntry(e);
    if (e.type === "checkbox") return false;
    if (e.type === "select") return !value || value === "null" || ((value === "0" || value === "-1") && /select|--|choose/i.test(text));
    if (e.type === "custom") return !value && !text;
    return !String(value).trim();
  }

  /** "filled" | "kept" | "missing" | "failed" — the same verdicts as the student panel. */
  function fillOne(e, f) {
    if (!e) return "missing";
    if (e.locked) return "kept";
    if (!stillEmpty(e)) return "kept";
    if (e.type === "custom" || e.type === "checkbox") return "failed";
    if (e.type === "radio") {
      const want = (f.text || "").trim().toLowerCase();
      const r = e.nodes.find((x) => String(x.value) === f.value) || (want && e.nodes.find((x) => optionText(x).trim().toLowerCase() === want));
      if (!r || r.disabled) return "failed";
      r.click();
      (r.closest("label") || r).classList.add("bhb-robot-filled");
      return r.checked ? "filled" : "failed";
    }
    const n = e.nodes[0];
    if (e.type === "select") {
      const want = (f.text || "").trim().toLowerCase();
      const opt = [...n.options].find((o) => o.value === f.value) || (want && [...n.options].find((o) => o.text.trim().toLowerCase() === want));
      if (!opt) return "failed";
      n.value = opt.value;
      n.dispatchEvent(new Event("change", { bubbles: true }));
      n.classList.add("bhb-robot-filled");
      return n.value === opt.value ? "filled" : "failed";
    }
    setNative(n, f.value);
    // Date / masked boxes may reformat or reject typed text: anything that
    // did not stay as typed is reported, not trusted.
    if (String(n.value || "") !== f.value) {
      setNative(n, "");
      return "failed";
    }
    n.classList.add("bhb-robot-filled");
    return "filled";
  }

  async function fillSection() {
    const ay = portalYear();
    // Send first, so the plan is built against exactly what is on screen now.
    say("Reading this section…");
    const sent = await sendOpen(ay);
    const res = await ask({ type: "profile-plan", section: sent.key, academicYear: ay });
    if (!res.ok) throw new Error(res.error);
    const plan = res.body.plan;
    const byKey = new Map(enumerate(sectionRoot()).map((e) => [e.key, e]));
    const filled = [];
    const kept = [];
    const failed = [];
    for (const f of plan.fields || []) {
      const r = fillOne(byKey.get(f.control), f);
      const tag = f.source === "last-year" ? `${f.label} (last year's answer — check)` : `${f.label} (ERP)`;
      if (r === "filled") filled.push(tag);
      else if (r === "kept") kept.push(f.label);
      else failed.push(f.label);
    }
    const lines = [`${sent.tabText} (${ay})`, `✓ Filled ${filled.length} empty box(es), outlined in yellow.`];
    if (filled.length) lines.push(...filled.map((x) => `  • ${x}`));
    if (kept.length) lines.push(`Already answered, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill — please type: ${failed.join(", ")}`);
    if ((plan.leftForYou || []).length) lines.push(`Empty, and neither the ERP nor last year knows — please answer: ${plan.leftForYou.join("; ")}`);
    if (!plan.earlierYear) lines.push("No earlier year captured yet, so no last-year answers to offer.");
    lines.push(...findings(sent.body));
    lines.push("Check every yellow box, then press the portal's own Save.");
    return lines.join("\n");
  }

  // ─── Wiring ──────────────────────────────────────────────────────────

  const run = (btn, fn) =>
    btn.addEventListener("click", () => {
      for (const b of [sendBtn, allBtn, fillBtn]) b.disabled = true;
      void fn()
        .then((t) => say(t, "ok"))
        .catch((e) => say(e.message || String(e), "err"))
        .finally(() => {
          for (const b of [sendBtn, allBtn, fillBtn]) b.disabled = false;
        });
    });
  run(sendBtn, sendThis);
  run(allBtn, sendAll);
  run(fillBtn, fillSection);

  document.body.append(panel);
  say("Open a School Profile section, then press a button.");
})();

/*
 * BHB Office Robot — the panel on the UDISE+ Teacher module
 * (teacher.udiseplus.gov.in), director's request of 6 Oct 2026.
 *
 * Every move starts with a person's click, exactly as on the student pages:
 *
 *  - on the staff list, "Check teachers against the ERP" reads the portal's
 *    own teacher list (the same call the page makes) and shows who matches
 *    an ERP staff member, whose National Code the ERP lacks, where the two
 *    disagree, and which ERP teachers the portal does not list;
 *  - on a teacher's GP / AT / TD step, "Fill this step from ERP" fills the
 *    EMPTY fields from ERP Staff, outlined in yellow, and lists what the ERP
 *    does not know. The person checks the page and presses the portal's own
 *    Save / Next.
 *
 *  - on the staff list, "Fetch all teachers from portal" (7 Oct 2026, two-way
 *    sync) reads BOTH portal lists (teaching, non-teaching) and every
 *    teacher's GP / AT / TD forms, at most three requests at a time, and
 *    sends a whitelisted copy to the ERP. The office reviews it there
 *    (Students → UDISE+ → Teachers: portal vs ERP) and applies what it ticks;
 *  - after a check, "Add missing staff" walks the ERP teachers the portal
 *    does not list, one at a time, through the portal's Add New Staff:
 *    the robot fills the EMPTY General Profile boxes, the person saves, then
 *    "Saved — next teacher".
 *
 * Never logs in, never presses Save / Next / Submit, no timers. Aadhaar never
 * leaves the portal tab: the lists and forms are whitelisted (no referenceKey
 * / aadhaar / name-as-per-Aadhaar). Staff mobile and email do go to the ERP.
 */
(() => {
  if (window.__bhbTeacherRobot) return;
  window.__bhbTeacherRobot = true;

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

  const panel = el("div", { id: "bhb-office-robot" });
  const head = el("header", {}, "🤖 BHB Office Robot · UDISE+ Teachers", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const checkBtn = el("button", { class: "act", type: "button" }, "Check teachers against the ERP");
  const fillBtn = el("button", { class: "act", type: "button" }, "Fill this step from ERP");
  const fetchBtn = el("button", { class: "act sec", type: "button" }, "Fetch all teachers from portal");
  const queueStartBtn = el("button", { class: "act sec", type: "button" }, "Add missing staff");
  const queueBox = el("div", { class: "queue" });
  const goBtn = el("button", { class: "act", type: "button" }, "Choose staff type and press Go");
  const addFillBtn = el("button", { class: "act", type: "button" }, "Fill new teacher from ERP");
  const savedNextBtn = el("button", { class: "act sec", type: "button" }, "Saved — next teacher");
  const skipBtn = el("button", { class: "act sec", type: "button" }, "Skip this teacher");
  const stopBtn = el("button", { class: "act sec", type: "button" }, "Stop adding");
  const msg = el("div", { class: "msg" });
  body.append(queueBox, checkBtn, fillBtn, fetchBtn, queueStartBtn, goBtn, addFillBtn, savedNextBtn, skipBtn, stopBtn, msg);
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

  // ─── Portal facts ────────────────────────────────────────────────────

  const FORMS = {
    "#/editteachercommonfirst": "gp",
    "#/getTeacherSecondForm": "at",
    "#/getTeacherThirdForm": "td",
  };
  const formOnPage = () => FORMS[location.hash.split("?")[0]] || "";
  const onList = () => /getempteacherdetaillist|dashboardschoolmoe/.test(location.hash);

  function token() {
    return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
  }
  function schoolId() {
    return localStorage.getItem("schoolIdForStaff") || sessionStorage.getItem("schoolIdForStaff") || "";
  }

  /** The portal's staff list: type 1 = teaching, 2 = non-teaching. */
  async function portalList(type) {
    const id = schoolId();
    if (!id || !token()) throw new Error("The portal session is not ready. Open the Teacher module dashboard first.");
    const r = await fetch(`/teacher_module_backend/teacher/emp-staff/teacher-details/${encodeURIComponent(id)}/${type}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    let j = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    const rows = j && j.data && Array.isArray(j.data.teacherDetails) ? j.data.teacherDetails : null;
    if (!r.ok || !rows) throw new Error("The portal did not return the teacher list. Are you still logged in?");
    return rows;
  }

  async function portalTeachers() {
    const rows = await portalList(1);
    if (!rows.length) throw new Error("The portal lists no teaching staff — nothing sent.");
    return rows;
  }

  // The form answers that may leave the portal tab — kept in step with
  // PORTAL_FORM_FIELDS in apps/web/src/lib/udiseTeacherSync.ts (the server
  // re-applies its own copy). No referenceKey / aadhaar / empNamePerUid.
  const FORM_FIELDS = {
    gp: ["empName", "gender", "dob", "empCodeState", "socialCat", "qualAcad", "trade", "mathUpto", "scienceUpto",
      "englishUpto", "socStudyUpto", "langStudyUpto", "qualProf", "mobile", "email", "disabilityType"],
    at: ["natureOfAppt", "dojService", "dojPs", "tchType", "docPh", "classTaught", "appointedLevel", "apptSub",
      "subTaught1", "subTaught2"],
    td: ["trainedCwsn", "trainedComp", "trgNishtha", "isCtetStet", "nontchDays", "trngRcvd", "trngNeeded"],
  };

  /**
   * Whitelisted answers out of a form1/2/3 reply. The reply's exact nesting
   * was not seen on 7 Oct (read-only study of the pages, not the JSON), so
   * the record and its direct child objects are searched; null = not read.
   */
  function pickForm(form, j) {
    if (!j || typeof j !== "object") return null;
    let d = j.data !== undefined ? j.data : j;
    if (Array.isArray(d)) d = d[0];
    if (!d || typeof d !== "object") return null;
    const places = [d, ...Object.values(d).filter((v) => v && typeof v === "object" && !Array.isArray(v))];
    const out = {};
    for (const k of FORM_FIELDS[form]) {
      for (const p of places) {
        const v = p[k];
        if (v === null || v === undefined || v === "") continue;
        out[k] = typeof v === "object" ? (v.id ?? v.code ?? v.value ?? null) : v;
        break;
      }
      if (out[k] === null) delete out[k];
    }
    return out;
  }

  async function portalForm(form, empStaffId) {
    const id = encodeURIComponent(schoolId());
    const emp = encodeURIComponent(empStaffId);
    const path = {
      gp: `form1/${id}/${emp}`,
      at: `form2/${emp}/${id}`,
      td: `form3/${emp}/${id}`,
    }[form];
    try {
      const r = await fetch(`/teacher_module_backend/teacher/emp-staff/${path}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return null;
      return pickForm(form, await r.json());
    } catch {
      return null;
    }
  }

  /** Run fn over items, at most n at a time (the portal is a shared server). */
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  async function fetchAll() {
    say("Reading the portal's teaching and non-teaching lists…");
    const lists = [];
    const listsRead = { teaching: false, non_teaching: false };
    for (const [type, staffType] of [[1, "teaching"], [2, "non_teaching"]]) {
      try {
        const rows = await portalList(type);
        listsRead[staffType] = true;
        for (const row of rows) lists.push({ staffType, row });
      } catch {
        // Left unread, and the ERP is told so: a list not read is not "nobody".
      }
    }
    if (!lists.length) throw new Error("The portal returned neither staff list. Are you still logged in?");
    let done = 0;
    const jobs = [];
    for (const t of lists) for (const f of ["gp", "at", "td"]) jobs.push({ t, f });
    const answers = await pool(jobs, 3, async (j) => {
      const got = j.t.row.empStaffId ? await portalForm(j.f, j.t.row.empStaffId) : null;
      done++;
      say(`Reading each teacher's forms… ${done}/${jobs.length}`);
      return got;
    });
    const teachers = lists.map((t, i) => ({
      staffType: t.staffType,
      list: t.row,
      gp: answers[i * 3],
      at: answers[i * 3 + 1],
      td: answers[i * 3 + 2],
    }));
    say("Sending to the ERP…");
    const res = await ask({ type: "teacher-details", listsRead, teachers });
    if (!res.ok) throw new Error(res.error);
    const b = res.body;
    const lines = [`Sent ${b.stored} staff to the ERP${b.matched !== null ? ` · ${b.matched} matched` : ""}.`];
    if (!listsRead.teaching || !listsRead.non_teaching) {
      lines.push(`Could not read the ${listsRead.teaching ? "non-teaching" : "teaching"} list — the ERP will not call anyone missing from it.`);
    }
    if (b.formsUnread) lines.push(`${b.formsUnread} teacher(s) had a form the portal did not return — shown as "not read".`);
    if (b.toReview !== null) lines.push(`${b.toReview} difference(s) to review.`);
    lines.push("Review and apply them in the ERP: Students → UDISE+ → Teachers: portal vs ERP. Nothing in the ERP changes until you tick and apply.");
    return lines.join("\n");
  }

  /** "National Code: TP73446390" and the name, as the open step prints them. */
  function whoIsOpen() {
    const t = document.body.innerText || "";
    const code = (t.match(/National Code:\s*([A-Z]{2}\d{6,})/) || [])[1] || "";
    const nameBox = document.querySelector('[formcontrolname="empName"]');
    const name =
      (nameBox && nameBox.value) || (t.match(/Teaching Staff Name:\s*([A-Z][A-Z .]+?)(?:\n|\s{2,}|3\.2)/) || [])[1] || "";
    const dobBox = document.querySelector('[formcontrolname="dob"]');
    return { code, name: name.trim(), dob: (dobBox && dobBox.value) || "" };
  }

  // ─── Fill ────────────────────────────────────────────────────────────

  const setNative = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  /** Close any open dropdown list without choosing (a click elsewhere). */
  async function closePanel() {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(150);
  }

  /** ng-select: open it, click the option whose label starts with the code. */
  async function fillNgSelect(ns, code) {
    if (ns.classList.contains("ng-select-disabled")) return "kept";
    if (ns.querySelector(".ng-value")) return "kept";
    const box = ns.querySelector(".ng-select-container");
    if (!box) return "missing";
    box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    let opts = [];
    for (let i = 0; i < 10 && !opts.length; i++) {
      await sleep(150);
      opts = [...document.querySelectorAll("ng-dropdown-panel .ng-option")];
    }
    const want = new RegExp(`^\\s*${code}\\s*-`);
    const opt = opts.find((o) => want.test(o.innerText || ""));
    if (!opt) {
      await closePanel();
      return "failed";
    }
    opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    opt.click();
    await sleep(200);
    const v = ns.querySelector(".ng-value");
    if (!v || !want.test(v.innerText || "")) return "failed";
    ns.classList.add("bhb-robot-filled");
    return "filled";
  }

  async function fillOne(f) {
    const node = document.querySelector(`[formcontrolname="${f.control}"]`);
    if (!node) return "missing";
    if (f.kind === "ngselect") return fillNgSelect(node, f.value);
    if (node.disabled || node.readOnly) return "kept";
    if ((node.value || "").trim()) return "kept";
    setNative(node, f.value);
    // Date boxes are calendar widgets that may reformat or reject typed
    // text; anything that did not stay as typed is reported, not trusted.
    if ((node.value || "") !== f.value) {
      setNative(node, "");
      return "failed";
    }
    node.classList.add("bhb-robot-filled");
    return "filled";
  }

  async function waitForForm(ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (document.querySelector("[formcontrolname]")) return true;
      await sleep(400);
    }
    return false;
  }

  async function fillStep() {
    const form = formOnPage();
    if (!form) throw new Error("Open a teacher's GP, AT or TD step first (from the staff list).");
    if (!(await waitForForm())) throw new Error("The form did not open. Reload the page and try again.");
    const who = whoIsOpen();
    if (!who.code && !who.name) throw new Error("Cannot tell whose form this is. Fill by hand.");
    const res = await ask({ type: "teacher-fill", code: who.code, form, name: who.name, dob: who.dob });
    if (!res.ok) throw new Error(res.error);
    const plan = res.body;
    // Never fill one teacher's form with another's details.
    const first = (n) => String(n || "").trim().toUpperCase().split(/\s+/)[0] || "";
    if (who.name && first(who.name) !== first(plan.teacher && plan.teacher.name)) {
      throw new Error(`Names disagree — portal “${who.name}”, ERP “${plan.teacher && plan.teacher.name}”. Nothing filled.`);
    }
    const filled = [];
    const kept = [];
    const failed = [];
    for (const f of plan.fields || []) {
      const r = await fillOne(f);
      if (r === "filled") filled.push(f.label);
      else if (r === "kept") kept.push(f.label);
      else failed.push(f.label);
    }
    const lines = [`${plan.teacher.name}${who.code ? ` (${who.code})` : ""} — step ${form.toUpperCase()}`, `✓ Filled ${filled.length} empty field(s), outlined in yellow.`];
    if (kept.length) lines.push(`Already on the portal, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
    if ((plan.leftForYou || []).length) lines.push(`Not in the ERP — please check/type: ${plan.leftForYou.join("; ")}`);
    lines.push("Check the yellow fields and press the portal's own Save / Next.");
    return lines.join("\n");
  }

  /** The last check's "in the ERP, not on the portal" — the add queue's source. */
  let lastMissing = [];

  async function check() {
    say("Reading the portal's teaching and non-teaching staff lists…");
    const teaching = (await portalTeachers()).map((r) => ({ ...r, staffType: "teaching" }));
    // The non-teaching list is a bonus: if it cannot be read, nobody
    // non-teaching is called "missing" (unread is not absent).
    let nonTeaching = null;
    try {
      nonTeaching = (await portalList(2)).map((r) => ({ ...r, staffType: "non_teaching" }));
    } catch {
      nonTeaching = null;
    }
    const res = await ask({ type: "teachers-board", teachers: [...teaching, ...(nonTeaching || [])], nonTeachingRead: !!nonTeaching });
    if (!res.ok) throw new Error(res.error);
    const b = res.body;
    const matched = b.rows.filter((r) => r.match === "matched");
    const lines = [`Portal lists ${teaching.length} teaching${nonTeaching ? ` + ${nonTeaching.length} non-teaching` : ""} staff · ${matched.length} matched in the ERP.`];
    if (!nonTeaching) lines.push("The non-teaching list could not be read — only teaching staff are checked for adding.");
    const noCode = matched.filter((r) => r.codeMissingInErp);
    if (noCode.length) lines.push(`Put the National Code on the ERP record (Staff → OASIS / UDISE id): ${noCode.map((r) => `${r.erpName} ${r.nationalCode}`).join(", ")}`);
    const unsure = b.rows.filter((r) => r.match !== "matched");
    if (unsure.length) lines.push(`Not matched: ${unsure.map((r) => `${r.portalName}${r.erpName ? ` (maybe ${r.erpName})` : ""}`).join(", ")}`);
    const diffs = matched.filter((r) => r.differences.length);
    for (const r of diffs) lines.push(`${r.erpName}: ${r.differences.join("; ")}`);
    lastMissing = b.notOnPortal || [];
    if (lastMissing.length) lines.push(`In the ERP but not on the portal: ${lastMissing.map((x) => x.name).join(", ")} — press “Add missing staff”.`);
    if ((b.maybeOnPortal || []).length) lines.push(`Not queued for adding — they may already be on the portal under a match the robot could not settle: ${b.maybeOnPortal.map((x) => x.name).join(", ")}`);
    lines.push("Then open each teacher's GP / AT / TD and press “Fill this step from ERP”.");
    onPage();
    return lines.join("\n");
  }

  // ─── Add missing staff (ERP → portal) ─────────────────────────────
  //
  // One teacher at a time through the portal's own Add New Staff. The queue
  // lives in this tab's sessionStorage so it survives the portal's page
  // changes; nothing moves on until a person presses a button.

  const QUEUE_KEY = "bhbTeacherAddQueue";
  const ADD_PAGE = "#/addNewStaff";
  const ADD_FORM = "#/teacherCommonDetails";
  const onAddPage = () => location.hash.split("?")[0] === ADD_PAGE;
  const onAddForm = () => location.hash.split("?")[0] === ADD_FORM;

  function readQueue() {
    try {
      const q = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || "null");
      return q && Array.isArray(q.items) && q.i < q.items.length ? q : null;
    } catch {
      return null;
    }
  }
  function writeQueue(q) {
    if (q && q.i < q.items.length) sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    else sessionStorage.removeItem(QUEUE_KEY);
  }
  const current = () => {
    const q = readQueue();
    return q ? q.items[q.i] : null;
  };

  function startQueue() {
    if (!lastMissing.length) throw new Error("Press “Check teachers against the ERP” first.");
    writeQueue({ items: lastMissing.map((x) => ({ staffId: x.staffId, name: x.name, staffType: x.staffType === "non_teaching" ? "non_teaching" : "teaching" })), i: 0 });
    location.hash = ADD_PAGE;
    onPage();
    return `Adding ${lastMissing.length} teacher(s), one at a time. First: ${lastMissing[0].name}.\nBefore each one, make sure the portal does not already list them under another spelling.`;
  }

  /**
   * Staff Type = Teaching, then the portal's own Go. Go only opens the blank
   * form (nothing is saved); it needs a real click() on the button element.
   * Any surprise in the page → the person does it by hand.
   */
  async function chooseTeachingAndGo() {
    // The queued person's own type: Teaching, or Non Teaching (director, 7 Oct 2026).
    const nonTeaching = (current() || {}).staffType === "non_teaching";
    const want = nonTeaching
      ? (t) => /non\s*-?\s*teaching/i.test(t || "")
      : (t) => /^\s*(\d+\s*-\s*)?teaching\b/i.test(t || "") && !/non/i.test(t || "");
    let chosen = false;
    for (const sel of document.querySelectorAll("select")) {
      const opt = [...sel.options].find((o) => want(o.text));
      if (!opt) continue;
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      chosen = true;
      break;
    }
    if (!chosen) {
      for (const ns of document.querySelectorAll("ng-select")) {
        const v = ns.querySelector(".ng-value");
        if (v && want(v.innerText)) {
          chosen = true;
          break;
        }
        const box = ns.querySelector(".ng-select-container");
        if (!box) continue;
        box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        let opts = [];
        for (let i = 0; i < 10 && !opts.length; i++) {
          await sleep(150);
          opts = [...document.querySelectorAll("ng-dropdown-panel .ng-option")];
        }
        const opt = opts.find((o) => want(o.innerText));
        if (!opt) {
          await closePanel();
          continue;
        }
        opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opt.click();
        await sleep(200);
        const now = ns.querySelector(".ng-value");
        chosen = !!(now && want(now.innerText));
        if (chosen) break;
      }
    }
    if (!chosen) throw new Error(`Could not find “${nonTeaching ? "Non Teaching" : "Teaching"}” in Staff Type. Choose it and press Go yourself.`);
    const go = [...document.querySelectorAll("button, input[type=button], input[type=submit]")].find((b) =>
      /^\s*go\s*$/i.test(b.innerText || b.value || ""),
    );
    if (!go) throw new Error("Chose the staff type, but found no Go button. Press Go yourself.");
    go.click();
    return "Opening the new-staff form…";
  }

  async function fillNew() {
    const who = current();
    if (!who) throw new Error("No teacher queued. Press “Check teachers against the ERP”, then “Add missing staff”.");
    if (!(await waitForForm())) throw new Error("The form did not open. Reload the page and try again.");
    const res = await ask({ type: "teacher-add", staffId: who.staffId });
    if (!res.ok) throw new Error(res.error);
    const plan = res.body;
    // A form already holding someone else's name is not this teacher's form.
    const box = document.querySelector('[formcontrolname="empName"]');
    const typed = ((box && box.value) || "").trim();
    const first = (n) => String(n || "").trim().toUpperCase().split(/\s+/)[0] || "";
    if (typed && first(typed) !== first(plan.teacher.name)) {
      throw new Error(`This form already says “${typed}”, not ${plan.teacher.name}. Nothing filled.`);
    }
    const filled = [];
    const kept = [];
    const failed = [];
    for (const f of plan.fields || []) {
      const r = await fillOne(f);
      if (r === "filled") filled.push(f.label);
      else if (r === "kept") kept.push(f.label);
      else failed.push(f.label);
    }
    const lines = [`${plan.teacher.name} — new staff, General Profile`, `✓ Filled ${filled.length} empty field(s), outlined in yellow.`];
    if (kept.length) lines.push(`Already filled, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
    if (!plan.aadhaarFilled) lines.push("Aadhaar left blank: the ERP has no valid 12-digit Aadhaar for this teacher.");
    if ((plan.leftForYou || []).length) lines.push(`Not in the ERP — please check/type: ${plan.leftForYou.join("; ")}`);
    lines.push("Check every yellow field, press the portal's own Save, then “Saved — next teacher”.");
    return lines.join("\n");
  }

  function advance(how) {
    const q = readQueue();
    if (!q) return "No teacher queued.";
    const was = q.items[q.i];
    q.i++;
    writeQueue(q);
    const next = current();
    if (!next) {
      onPage();
      return `${was.name}: ${how}. That was the last one. Press “Check teachers against the ERP” on the staff list to confirm.`;
    }
    location.hash = ADD_PAGE;
    onPage();
    return `${was.name}: ${how}. Next: ${next.name}.`;
  }

  const run = (fn) => () =>
    void Promise.resolve()
      .then(fn)
      .then((t) => say(t, "ok"))
      .catch((e) => say(e.message || String(e), "err"));

  checkBtn.addEventListener("click", run(check));
  fillBtn.addEventListener("click", run(fillStep));
  fetchBtn.addEventListener("click", run(fetchAll));
  queueStartBtn.addEventListener("click", run(startQueue));
  goBtn.addEventListener("click", run(chooseTeachingAndGo));
  addFillBtn.addEventListener("click", run(fillNew));
  savedNextBtn.addEventListener("click", run(() => advance("saved by you")));
  skipBtn.addEventListener("click", run(() => advance("skipped")));
  stopBtn.addEventListener(
    "click",
    run(() => {
      writeQueue(null);
      onPage();
      return "Stopped. Nothing more will be added.";
    }),
  );

  function onPage() {
    const form = formOnPage();
    const list = onList();
    const who = current();
    const addPage = onAddPage();
    const addForm = onAddForm();
    panel.style.display = form || list || addPage || addForm || who ? "" : "none";
    checkBtn.style.display = list ? "" : "none";
    fetchBtn.style.display = list ? "" : "none";
    queueStartBtn.style.display = list && lastMissing.length && !who ? "" : "none";
    queueStartBtn.textContent = `Add missing staff (${lastMissing.length})`;
    fillBtn.style.display = form ? "" : "none";
    queueBox.style.display = who ? "" : "none";
    if (who) {
      const q = readQueue();
      queueBox.textContent = `Adding ${q.i + 1} of ${q.items.length}: ${who.name}`;
    }
    goBtn.style.display = who && addPage ? "" : "none";
    addFillBtn.style.display = who && addForm ? "" : "none";
    savedNextBtn.style.display = who && addForm ? "" : "none";
    skipBtn.style.display = who ? "" : "none";
    stopBtn.style.display = who ? "" : "none";
    if (form) say("Press “Fill this step from ERP”, check the yellow fields, then Save.");
    else if (who && addPage) say("Press “Choose staff type and press Go” — or choose Staff Type yourself and press Go.");
    else if (who && addForm) say("Press “Fill new teacher from ERP”, check the yellow fields, then the portal's Save.");
    else if (who) say(`Open Add New Staff to add ${who.name}.`);
    else if (list) say("“Check teachers against the ERP” shows who matches; “Fetch all teachers from portal” sends the portal's details to the ERP for review.");
  }

  window.addEventListener("hashchange", onPage);
  document.body.append(panel);
  setTimeout(onPage, 1500);
})();

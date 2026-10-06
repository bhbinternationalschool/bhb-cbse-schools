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
 * Never logs in, never presses Save / Next / Submit, no timers. Aadhaar and
 * mobile numbers never leave the portal tab (the list call drops them).
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
  const msg = el("div", { class: "msg" });
  body.append(checkBtn, fillBtn, msg);
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

  async function portalTeachers() {
    const id = schoolId();
    if (!id || !token()) throw new Error("The portal session is not ready. Open the Teacher module dashboard first.");
    const r = await fetch(`/teacher_module_backend/teacher/emp-staff/teacher-details/${encodeURIComponent(id)}/1`, {
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
    if (!rows.length) throw new Error("The portal lists no teaching staff — nothing sent.");
    return rows;
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

  async function check() {
    say("Reading the portal's teacher list…");
    const rows = await portalTeachers();
    const res = await ask({ type: "teachers-board", teachers: rows });
    if (!res.ok) throw new Error(res.error);
    const b = res.body;
    const matched = b.rows.filter((r) => r.match === "matched");
    const lines = [`Portal lists ${b.rows.length} teaching staff · ${matched.length} matched in the ERP.`];
    const noCode = matched.filter((r) => r.codeMissingInErp);
    if (noCode.length) lines.push(`Put the National Code on the ERP record (Staff → OASIS / UDISE id): ${noCode.map((r) => `${r.erpName} ${r.nationalCode}`).join(", ")}`);
    const unsure = b.rows.filter((r) => r.match !== "matched");
    if (unsure.length) lines.push(`Not matched: ${unsure.map((r) => `${r.portalName}${r.erpName ? ` (maybe ${r.erpName})` : ""}`).join(", ")}`);
    const diffs = matched.filter((r) => r.differences.length);
    for (const r of diffs) lines.push(`${r.erpName}: ${r.differences.join("; ")}`);
    if (b.notOnPortal.length) lines.push(`In the ERP but not on the portal: ${b.notOnPortal.map((x) => x.name).join(", ")} — add them with the portal's "Add New Staff".`);
    lines.push("Then open each teacher's GP / AT / TD and press “Fill this step from ERP”.");
    return lines.join("\n");
  }

  checkBtn.addEventListener("click", () =>
    void check()
      .then((t) => say(t, "ok"))
      .catch((e) => say(e.message || String(e), "err")),
  );
  fillBtn.addEventListener("click", () =>
    void fillStep()
      .then((t) => say(t, "ok"))
      .catch((e) => say(e.message || String(e), "err")),
  );

  function onPage() {
    const form = formOnPage();
    const list = onList();
    panel.style.display = form || list ? "" : "none";
    checkBtn.style.display = list ? "" : "none";
    fillBtn.style.display = form ? "" : "none";
    if (form) say("Press “Fill this step from ERP”, check the yellow fields, then Save.");
    else if (list) say("Press “Check teachers against the ERP” to see who matches.");
  }

  window.addEventListener("hashchange", onPage);
  document.body.append(panel);
  setTimeout(onPage, 1500);
})();

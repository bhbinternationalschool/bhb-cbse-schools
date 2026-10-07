/*
 * BHB Office Robot — the panel on UDISE+ portal pages (the first portal it
 * works on; each further portal gets its own panel script).
 *
 * Every move starts with a person's click. A person logs in (user id,
 * password, captcha/OTP), and the panel shows how many children's portal
 * profiles are still incomplete. Then:
 *
 *  - "Start robot" sends the portal's current-year list to the ERP's UDISE+
 *    working sheet, opens the first incomplete child's form and fills its
 *    EMPTY fields from the ERP, outlined in yellow;
 *  - the person checks the page, types what the ERP does not know, and
 *    presses the portal's own Save;
 *  - "Saved — next child" opens and fills the next one.
 *
 * On the APAAR Module (director, 6 Oct 2026): "Start APAAR queue" asks the
 * ERP which children are ready (family consented on WhatsApp, the consenting
 * parent's own Aadhaar on file, portal Aadhaar verified, no APAAR yet), opens
 * each child's "Generate APAAR ID" page and fills the consent block; the
 * person checks it and presses the portal's own Submit.
 *
 * The robot never logs in, never presses Save / Next / Complete on the
 * portal, and has no timers or background work: it stops when the tab is
 * closed or the portal logs out.
 */
(() => {
  if (window.__bhbUdiseRobot) return;
  window.__bhbUdiseRobot = true;

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

  // ─── Panel ───────────────────────────────────────────────────────────

  const panel = el("div", { id: "bhb-office-robot" });
  const head = el("header", {}, "🤖 BHB Office Robot · UDISE+", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const queueBox = el("div", { class: "queue" });
  const startBtn = el("button", { class: "act", type: "button" }, "Start robot");
  const nextBtn = el("button", { class: "act", type: "button" }, "Saved — next child ▶");
  const skipBtn = el("button", { class: "act sec", type: "button" }, "Skip this child");
  const stopBtn = el("button", { class: "act sec", type: "button" }, "Stop robot");
  const pullBtn = el("button", { class: "act sec", type: "button" }, "Only send portal list to ERP");
  const fillBtn = el("button", { class: "act sec", type: "button" }, "Fill this form from ERP");
  const addBtn = el("button", { class: "act sec", type: "button" }, "Add missing children to UDISE+");
  const addAnywayBtn = el("button", { class: "act sec", type: "button" }, "Not the same child — add anyway");
  // APAAR (director, 6 Oct 2026): only on the portal's APAAR pages.
  const apaarBox = el("div", { class: "queue" });
  const apaarStartBtn = el("button", { class: "act", type: "button" }, "Start APAAR queue");
  const apaarNextBtn = el("button", { class: "act", type: "button" }, "Submitted — next child ▶");
  const apaarSkipBtn = el("button", { class: "act sec", type: "button" }, "Skip this child");
  const apaarStopBtn = el("button", { class: "act sec", type: "button" }, "Stop APAAR queue");
  const apaarFillBtn = el("button", { class: "act sec", type: "button" }, "Fill this APAAR page from ERP");
  const msg = el("div", { class: "msg" });
  const last = el("div", { class: "muted" });
  body.append(
    queueBox, startBtn, nextBtn, addAnywayBtn, skipBtn, stopBtn, addBtn, pullBtn, fillBtn,
    apaarBox, apaarStartBtn, apaarNextBtn, apaarSkipBtn, apaarStopBtn, apaarFillBtn,
    msg, last,
  );
  addAnywayBtn.style.display = "none";
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

  const store = {
    get: async (k) => (await chrome.storage.local.get(k))[k],
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
  };

  // ─── Portal facts ────────────────────────────────────────────────────

  function schoolId() {
    const m = location.hash.match(/\/school\/(\d+)\//);
    if (m) return m[1];
    try {
      return String(JSON.parse(localStorage.getItem("schoolInfo") || "null")?.schoolId || "");
    } catch {
      return "";
    }
  }

  /**
   * The current year, read off the portal's own current-year wording only.
   * The menu also says "Active Students (2025-26)", so a loose match would
   * send this year's list as last year's. Not found → not guessed.
   */
  function currentYear() {
    const t = document.body.innerText || "";
    const m =
      t.match(/(?:Grade Wise|List of All Students|Enrolment Details)\s*\((20\d{2}-\d{2})\)/i) ||
      t.match(/Current Academic Year\s*(20\d{2}-\d{2})/i);
    return m ? m[1] : "";
  }

  async function waitForYear() {
    let ay = currentYear();
    // The portal draws the page a moment after the address changes.
    for (let i = 0; !ay && i < 15; i++) {
      await sleep(400);
      ay = currentYear();
    }
    return ay;
  }

  async function portalList(id) {
    const r = await fetch(`/p1/api/cy/students/all/${encodeURIComponent(id)}`, { credentials: "include" });
    let j = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    if (!r.ok || !j || j.status !== true || !Array.isArray(j.data)) {
      throw new Error("The portal did not return the student list. Are you still logged in?");
    }
    if (!j.data.length) throw new Error("The portal returned no students — nothing sent.");
    return j.data;
  }

  async function showLast() {
    const lastPull = await store.get("lastPull");
    if (!lastPull) return void (last.textContent = "Portal list not sent to the ERP from this browser yet.");
    const when = new Date(lastPull.at).toLocaleString();
    last.textContent = lastPull.ok ? `Portal list last sent to the ERP ${when}.` : `Last send ${when} failed: ${lastPull.error}`;
  }

  // ─── Pull ────────────────────────────────────────────────────────────

  async function pull(ay, students) {
    say(`Sending ${students.length} children (${ay}) to the ERP…`);
    const res = await ask({ type: "pull", academicYearCode: ay, students });
    void showLast();
    if (!res.ok) throw new Error(res.error);
    const s = (res.body || {}).summary || {};
    const r = (res.body || {}).reconcile || {};
    const lines = [`✓ ERP has the portal list: ${s.received} children · PEN ${s.withPen} · APAAR ${s.withApaar} · Aadhaar failed ${s.aadhaarFailed}. (Apply it in ERP → Students → UDISE+.)`];
    const list = (arr, f) => (arr || []).slice(0, 12).map(f).join("\n  ");
    if ((r.differentName || []).length) lines.push(`Same child under a DIFFERENT NAME (portal ↔ ERP; twins look alike too — check) — make the names agree:\n  ${list(r.differentName, (x) => `${x.portalName} (PEN ${x.pen}) = ERP ${x.erpName} ${x.admissionNo} · ${x.why}`)}`);
    if ((r.portalDuplicates || []).length) lines.push(`Possibly ONE child entered TWICE on UDISE+ (unless twins) — check with the family:\n  ${list(r.portalDuplicates, (x) => `${x.a} (${x.aPen}) & ${x.b} (${x.bPen}) · ${x.why}`)}`);
    if ((r.leftSchool || []).length) lines.push(`Left school per the ERP but still active on UDISE+ (${r.leftSchool.length}) — send to Dropbox when allowed:\n  ${list(r.leftSchool, (x) => `${x.portalName} (PEN ${x.pen}) = ERP ${x.erpName}, last ${x.lastYear}`)}`);
    if ((r.notInErp || []).length) lines.push(`On UDISE+ but nowhere in the ERP (${r.notInErp.length}):\n  ${list(r.notInErp, (x) => `${x.portalName} (${x.classDesc}, PEN ${x.pen})`)}`);
    return lines.join("\n");
  }

  pullBtn.addEventListener("click", async () => {
    const id = schoolId();
    const ay = await waitForYear();
    if (!id || !ay) return say("Open the School Dashboard for the current year, then click again.", "err");
    pullBtn.disabled = true;
    try {
      say(await pull(ay, await portalList(id)), "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      pullBtn.disabled = false;
    }
  });

  // ─── Fill ────────────────────────────────────────────────────────────

  const setNative = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  function radioFor(control, code) {
    const all = [...document.querySelectorAll(`input[type=radio][formcontrolname="${control}"]`)];
    const byValue = all.find((r) => r.value === code);
    if (byValue) return byValue;
    const want = code === "1" ? /^yes$/i : code === "2" ? /^no$/i : null;
    if (!want) return null;
    return (
      all.find((r) => want.test((r.closest("label")?.innerText || r.nextSibling?.textContent || r.parentElement?.innerText || "").trim())) || null
    );
  }

  /** "filled" | "kept" (portal already has a value) | "missing" | "failed". */
  function fillOne(f) {
    if (f.kind === "radio") {
      const all = [...document.querySelectorAll(`input[type=radio][formcontrolname="${f.control}"]`)];
      if (!all.length) return "missing";
      if (all.some((r) => r.checked)) return "kept";
      const r = radioFor(f.control, f.value);
      if (!r || r.disabled) return "failed";
      r.click();
      r.classList.add("bhb-robot-filled");
      return r.checked ? "filled" : "failed";
    }
    const node = document.querySelector(`[formcontrolname="${f.control}"]`);
    if (!node) return "missing";
    if (node.disabled || node.readOnly) return "kept";
    if (f.kind === "select") {
      if (node.value && node.value !== "0") return "kept";
      if (![...node.options].some((o) => o.value === f.value)) return "failed";
      node.value = f.value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.classList.add("bhb-robot-filled");
      return node.value === f.value ? "filled" : "failed";
    }
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

  /** The form is an Angular page that renders after the route changes. */
  async function waitForForm(ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (document.querySelector('[formcontrolname="address"], [formcontrolname="pincode"], [formcontrolname="studentName"]')) return true;
      await sleep(400);
    }
    return false;
  }

  /** `who` is the child's portal record (studentName + studentCodeNat), or null to look it up. */
  async function fillOpenForm(who) {
    const m = location.hash.match(/\/school\/(\d+)\/new-ac\/[^/]+\/[^/]+\/(\d+)/);
    if (!m) throw new Error("Open a child's profile form (GP/EP/FP) first.");
    if (!(await waitForForm())) throw new Error("The form did not open. Reload the page and try again.");
    const me = who || (await portalList(m[1])).find((s) => String(s.studentId) === m[2]);
    const pen = me && String(me.studentCodeNat || "").replace(/\D/g, "");
    if (!pen) throw new Error("This child has no PEN on the portal, so the robot cannot be sure who it is. Fill by hand.");
    const res = await ask({ type: "fill-data", pen });
    if (!res.ok) throw new Error(res.error);
    const plan = res.body;
    // Never fill a form for someone else: the portal name must agree.
    const first = (n) => String(n || "").trim().toUpperCase().split(/\s+/)[0] || "";
    if (!first(me.studentName) || first(me.studentName) !== first(plan.student?.name)) {
      throw new Error(`Names disagree — portal “${me.studentName}”, ERP “${plan.student?.name}”. Nothing filled. Check the PEN in the ERP.`);
    }
    const filled = [];
    const kept = [];
    const failed = [];
    // Some boxes appear only after an earlier choice (previous-year class and
    // result show once the status is picked), so a box not on the page yet
    // is tried again after the form has redrawn — at most three times.
    let pending = plan.fields || [];
    for (let round = 0; round < 3 && pending.length; round++) {
      if (round) await sleep(700);
      const missing = [];
      for (const f of pending) {
        const r = fillOne(f);
        if (r === "filled") filled.push(f.label);
        else if (r === "kept") kept.push(f.label);
        else if (r === "missing") missing.push(f);
        else failed.push(f.label);
      }
      pending = missing;
    }
    for (const f of pending) failed.push(f.label);
    // A "please type" line the portal already answers is not the office's job.
    const answered = (control) => {
      const radios = [...document.querySelectorAll(`input[type=radio][formcontrolname="${control}"]`)];
      if (radios.length) return radios.some((r) => r.checked);
      const node = document.querySelector(`[formcontrolname="${control}"]`);
      if (!node || !("value" in node)) return false;
      const v = String(node.value || "").trim();
      return node.tagName === "SELECT" ? !!v && v !== "0" : !!v;
    };
    const controlsOf = plan.leftControls || {};
    const left = (plan.leftForYou || []).filter((label) => {
      const cs = controlsOf[label];
      return !(cs && cs.length && cs.every(answered));
    });
    const lines = [`${plan.student.name} (PEN ${pen})`, `✓ Filled ${filled.length} empty field(s), outlined in yellow.`];
    if (kept.length) lines.push(`Already on the portal, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
    if (left.length) lines.push(`Not in the ERP — please type: ${left.join(", ")}`);
    if (plan.schoolAnswersConfirmed === false) {
      lines.push("Tip: confirm the school answers in the ERP (Students → UDISE+ → Robot — school answers) and the robot fills BPL, out-of-school, NCC/NSS and the like for every child.");
    }
    lines.push("Check the yellow fields, type the rest, and press the portal's Save on each step.");
    return lines.join("\n");
  }

  // ─── Is this child already on UDISE+ anywhere in India? ──────────────

  const nameTokens = (n) => String(n || "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter(Boolean);
  /** Same first name, and the shorter name's words appear in order in the longer. */
  function namesCompatible(a, b) {
    const x = nameTokens(a);
    const y = nameTokens(b);
    if (!x.length || !y.length || x[0] !== y[0]) return false;
    const [sh, lo] = x.length <= y.length ? [x, y] : [y, x];
    let j = 0;
    for (const t of lo) if (j < sh.length && sh[j] === t) j += 1;
    return j === sh.length;
  }

  async function portalSearch(path, body) {
    const r = await fetch(`/p1/api/search/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    // A failed search is "could not check", never "not found".
    if (!r.ok || !j || j.status !== true || !Array.isArray(j.data)) {
      throw new Error((j && j.message) || `the portal's search answered ${r.status}`);
    }
    return j.data;
  }

  /**
   * Search the whole of UDISE+ for this ERP child, the way the portal's own
   * Global Student Search does: by name + Aadhaar last 4 when the ERP has
   * the Aadhaar, and by name + date of birth + father + mother (the portal
   * needs at least two of the three). Returns the hits that look like the
   * same child, or throws when it could not search at all.
   */
  async function findOnUdise(c) {
    const v = (control) => (c.fields || []).find((f) => f.control === control)?.value || "";
    const name = v("studentName") || c.name;
    const dob = v("dob");
    const father = v("fatherName");
    const mother = v("motherName");
    const aadhaar = v("uuid");
    const hits = new Map();
    let searched = false;
    if (/^\d{12}$/.test(aadhaar)) {
      for (const h of await portalSearch("student-aadhaar", { studentName: name, uuid: aadhaar.slice(-4) })) hits.set(h.studentPEN || JSON.stringify(h), h);
      searched = true;
    }
    if ([dob, father, mother].filter(Boolean).length >= 2) {
      const found = await portalSearch("global", { studentName: name, dob, fatherName: father, motherName: mother, schoolId: null, stateId: null });
      for (const h of found) hits.set(h.studentPEN || JSON.stringify(h), h);
      searched = true;
    }
    if (!searched) {
      throw new Error("the ERP has too few details to search UDISE+ (needs the Aadhaar, or two of date of birth, father's and mother's name)");
    }
    // The portal's matching is loose; keep hits that agree on the name AND
    // on at least one of birth date / father / mother.
    const same = [...hits.values()].filter(
      (h) =>
        namesCompatible(name, h.studentName) &&
        ((dob && h.studentDob === dob) || (father && namesCompatible(father, h.fatherName)) || (mother && namesCompatible(mother, h.motherName))),
    );
    return { same, loose: [...hits.values()].filter((h) => !same.includes(h)) };
  }

  const describeHit = (h, ourId) =>
    `${h.studentName} · PEN ${h.studentPEN} · born ${h.studentDob} · father ${h.fatherName || "—"} · ` +
    (String(h.schoolId) === String(ourId) ? "OUR SCHOOL" : `${h.schoolName} (UDISE ${h.udiseSchCode})`) +
    ` · ${h.classDesc || ""} ${h.yearDesc || ""} · ${h.statusDesc || ""}`;

  /**
   * Fill the open "Add New Student" form for one ERP child. The plan is
   * fetched fresh each time (it carries the Aadhaar, which is never kept in
   * the browser's storage).
   */
  async function fillAddForm(item) {
    if (!/\/new-ac\/addStudent\//.test(location.hash)) throw new Error("The Add Student form is not open.");
    if (item.portalClassName) {
      const head = (document.body.innerText.match(/Class - ([^\n]+?)\s*Section - /) || [])[1] || "";
      if (head.trim() !== item.portalClassName) throw new Error(`The form is for class “${head.trim() || "?"}”, not ${item.portalClassName}. Nothing typed.`);
    }
    if (!(await waitForForm())) throw new Error("The form did not open. Reload the page and try again.");
    const res = await ask({ type: "add-list", students: await portalList(schoolId()) });
    if (!res.ok) throw new Error(res.error);
    const c = (res.body.candidates || []).find((x) => x.studentId === item.studentId);
    if (!c) throw new Error("This child is no longer missing from the portal (or now has a PEN in the ERP). Press Skip.");
    const name = document.querySelector('[formcontrolname="studentName"]');
    if (name && (name.value || "").trim()) throw new Error("This form already has a name typed in. Clear it or press Skip.");
    const filled = [];
    const failed = [];
    for (const f of c.fields || []) {
      const r = fillOne(f);
      if (r === "filled") filled.push(f.label);
      else if (r !== "kept") failed.push(f.label);
    }
    const lines = [`${c.name} — ${c.classLabel}`, `✓ Filled ${filled.length} field(s), outlined in yellow.`];
    if (failed.length) lines.push(`Could not fill (please type): ${failed.join(", ")}`);
    if ((c.leftForYou || []).length) lines.push(`Not in the ERP — please type: ${c.leftForYou.join(", ")}`);
    for (const h of c.hints || []) lines.push(`Note: ${h}`);
    lines.push("If the portal says a similar student exists, check before agreeing. Then press the portal's Save yourself.");
    return lines.join("\n");
  }

  fillBtn.addEventListener("click", async () => {
    fillBtn.disabled = true;
    try {
      say(await fillOpenForm(null), "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      fillBtn.disabled = false;
    }
  });

  // ─── The queue: incomplete children, one click per child ─────────────

  /**
   * Children whose portal profile is not complete: formStatus 0 = Not
   * Started; 1 and 2 both show In-Progress. Any other value is not assumed
   * unfinished. Without a PEN the robot cannot be sure who a child is, so
   * those are left to a person.
   */
  function buildQueue(students) {
    return students
      .filter((s) => [0, 1, 2].includes(Number(s.formStatus)) && String(s.studentCodeNat || "").replace(/\D/g, ""))
      .filter((s) => s.studentId != null && s.classId != null && s.sectionId != null)
      .sort((a, b) => Number(a.classId) - Number(b.classId) || String(a.studentName).localeCompare(String(b.studentName)))
      .map((s) => ({
        studentId: String(s.studentId),
        classId: String(s.classId),
        sectionId: String(s.sectionId),
        studentName: String(s.studentName || ""),
        studentCodeNat: String(s.studentCodeNat || "").replace(/\D/g, ""),
        classDesc: String(s.classDesc || ""),
      }));
  }

  const formHash = (id, q) => `#/school/${id}/new-ac/${q.classId}/${q.sectionId}/${q.studentId}?formId=1&formEditFlag=1`;
  async function openAddFormFor(id, item) {
    location.hash = `#/school/${id}/schoolDashboard/cy`;
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      await sleep(300);
      row = [...document.querySelectorAll("tr")].find((tr) => (tr.cells?.[0]?.innerText || "").trim() === item.portalClassName);
    }
    if (!row) throw new Error(`could not find the ${item.portalClassName} row on the dashboard`);
    const btn = [...row.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.innerText || "").trim() === "Add Student");
    if (!btn) throw new Error(`the portal is not allowing Add Student for ${item.portalClassName} now`);
    btn.click();
    if (!(await waitForForm())) throw new Error("the Add Student form did not open");
    await sleep(800);
    const head = (document.body.innerText.match(/Class - ([^\n]+?)\s*Section - /) || [])[1] || "";
    if (head.trim() !== item.portalClassName) {
      throw new Error(`the form says class “${head.trim() || "?"}”, not ${item.portalClassName}. Nothing was typed`);
    }
  }

  function renderQueue(q, pendingCount) {
    const active = !!(q && q.items && q.index < q.items.length);
    if (active) {
      const it = q.items[q.index];
      queueBox.textContent = `${q.kind === "add" ? "Adding child" : "Child"} ${q.index + 1} of ${q.items.length}: ${it.studentName} (${it.classDesc})`;
    } else if (pendingCount) {
      queueBox.textContent = `${pendingCount} children still have an incomplete portal profile.`;
    } else {
      queueBox.textContent = "";
    }
    queueBox.style.display = queueBox.textContent ? "" : "none";
    for (const b of [nextBtn, skipBtn, stopBtn]) b.style.display = active ? "" : "none";
    startBtn.style.display = active ? "none" : "";
    addBtn.style.display = !active && /schoolDashboard/.test(location.hash) ? "" : "none";
    fillBtn.style.display = !active && /\/new-ac\//.test(location.hash) ? "" : "none";
  }

  let busy = false;
  /** Open the queue's current child and fill it. Called only from a click. */
  async function openCurrent() {
    const q = await store.get("queue");
    if (!q || !q.items || q.index >= q.items.length) {
      await store.set("queue", null);
      renderQueue(null, 0);
      say(
        q && q.kind === "add"
          ? "🎉 Done with the missing children. Press “Only send portal list to ERP” so the ERP picks up their new PENs."
          : "🎉 The robot has been through every incomplete child. Press “Only send portal list to ERP” to refresh the ERP.",
        "ok",
      );
      return;
    }
    const item = q.items[q.index];
    renderQueue(q, 0);
    addAnywayBtn.style.display = "none";
    if (q.kind === "add" && q.addAnywayFor !== item.studentId) {
      say(`Searching all of UDISE+ for ${item.studentName}…`);
      try {
        const res = await ask({ type: "add-list", students: await portalList(q.schoolId) });
        if (!res.ok) throw new Error(res.error);
        const c = (res.body.candidates || []).find((x) => x.studentId === item.studentId);
        if (!c) return say(`${item.studentName} is no longer missing from the portal (or now has a PEN in the ERP). Press Skip.`, "ok");
        const { same, loose } = await findOnUdise(c);
        const ours = same.filter((h) => String(h.schoolId) === String(q.schoolId));
        const elsewhere = same.filter((h) => String(h.schoolId) !== String(q.schoolId));
        if (ours.length) {
          return say(
            [`${item.studentName} is ALREADY on UDISE+ in our school — do not add.`, ...ours.map((h) => describeHit(h, q.schoolId)),
              "Press “Only send portal list to ERP”, then Apply in the ERP so the PEN comes in. Then Skip."].join("\n"),
            "err",
          );
        }
        if (elsewhere.length) {
          return say(
            [`${item.studentName} is on UDISE+ at ANOTHER school — do not add; bring the child in by transfer.`,
              ...elsewhere.map((h) => describeHit(h, q.schoolId)),
              "Ask that school to release the child (or import from the Dropbox), and put this PEN on the child in the ERP. Then Skip."].join("\n"),
            "err",
          );
        }
        if (loose.length) {
          addAnywayBtn.style.display = "";
          return say(
            [`UDISE+ has children with a similar name, but none agree on birth date or parents:`, ...loose.slice(0, 5).map((h) => describeHit(h, q.schoolId)),
              "If none of them is this child, press “Not the same child — add anyway”. Otherwise Skip."].join("\n"),
          );
        }
        say(`Not found anywhere on UDISE+. Opening Add Student for ${item.studentName}…`);
      } catch (e) {
        addAnywayBtn.style.display = "";
        return say(
          `Could not check UDISE+ for ${item.studentName}: ${e.message || e}.\nSearch by hand (Global Student Search). If the child is not there, press “Not the same child — add anyway”.`,
          "err",
        );
      }
    }
    if (q.addAnywayFor) await store.set("queue", { ...q, addAnywayFor: "" });
    say(`Opening ${item.studentName}…`);
    if (q.kind === "add") {
      // The Add Student form takes its class from the dashboard button that
      // opened it, NOT from the address: opening it by address showed
      // "Class - I" on a Nursery address (2026-10-06). So: back to the
      // dashboard, click that class's own button, and check the header.
      try {
        await openAddFormFor(q.schoolId, item);
      } catch (e) {
        return say(`${item.studentName}: ${e.message || e}\nOpen it by hand from the dashboard, or press Skip.`, "err");
      }
    } else {
      location.hash = formHash(q.schoolId, item);
    }
    try {
      say(q.kind === "add" ? await fillAddForm(item) : await fillOpenForm(item), "ok");
    } catch (e) {
      say(`${item.studentName}: ${e.message || e}\nFill by hand, or press Skip.`, "err");
    }
  }

  async function clickStep(fn) {
    if (busy) return;
    busy = true;
    for (const b of [startBtn, nextBtn, skipBtn, addAnywayBtn]) b.disabled = true;
    try {
      await fn();
    } finally {
      busy = false;
      for (const b of [startBtn, nextBtn, skipBtn, addAnywayBtn]) b.disabled = false;
    }
  }

  const advance = async () => {
    const q = await store.get("queue");
    if (!q) return;
    await store.set("queue", { ...q, index: q.index + 1 });
    await openCurrent();
  };
  nextBtn.addEventListener("click", () => void clickStep(advance));
  addAnywayBtn.addEventListener("click", () =>
    void clickStep(async () => {
      const q = await store.get("queue");
      if (!q || q.kind !== "add") return;
      await store.set("queue", { ...q, addAnywayFor: q.items[q.index]?.studentId || "" });
      await openCurrent();
    }),
  );
  skipBtn.addEventListener("click", () => void clickStep(advance));
  stopBtn.addEventListener("click", async () => {
    await store.set("queue", null);
    renderQueue(null, 0);
    say("Robot stopped. Press “Start robot” to begin again.");
  });

  startBtn.addEventListener("click", () =>
    void clickStep(async () => {
      const id = schoolId();
      const ay = await waitForYear();
      if (!id || !ay) return say("Open the current year's School Dashboard, then press Start.", "err");
      try {
        say("Reading the student list from the portal…");
        const students = await portalList(id);
        let pulled;
        try {
          pulled = await pull(ay, students);
        } catch (e) {
          // Filling still helps even if the ERP's copy could not be refreshed.
          pulled = `Could not send the list to the ERP: ${e.message || e}`;
        }
        const items = buildQueue(students);
        if (!items.length) {
          return say(`${pulled}\nEvery child with a PEN already has a complete profile. Nothing to fill.`, "ok");
        }
        await store.set("queue", { schoolId: id, ay, items, index: 0, startedAt: new Date().toISOString() });
        say(`${pulled}\n${items.length} children to fill.`, "ok");
        await sleep(1200);
        await openCurrent();
      } catch (e) {
        say(e.message || String(e), "err");
      }
    }),
  );

  /**
   * Classes the portal lets this school add to right now: those whose row on
   * the dashboard shows an "Add Student" button (2026-10-06: PP3 to Class I).
   * Portal class and section ids come from the portal's own section list.
   */
  async function addableSections(id) {
    const r = await fetch(`/p1/api/v2/section/stats/${encodeURIComponent(id)}`, { credentials: "include" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.status !== true || !Array.isArray(j.data)) throw new Error("Could not read the portal's classes.");
    const rows = [...document.querySelectorAll("button,a,span,div")].filter((e) => e.children.length === 0 && (e.innerText || "").trim() === "Add Student");
    // Each button sits in a table row whose first cell is exactly the class
    // name ("I", "II", "Nursery/KG/PP3") — matched whole, so "I" is never "II".
    const allowedNames = new Set();
    for (const b of rows) {
      const cell = (b.closest("tr")?.cells?.[0]?.innerText || "").trim();
      if (j.data.some((s) => s.className === cell)) allowedNames.add(cell);
    }
    return j.data.filter((s) => allowedNames.has(s.className));
  }

  addBtn.addEventListener("click", () =>
    void clickStep(async () => {
      const id = schoolId();
      if (!id || !/schoolDashboard/.test(location.hash)) return say("Open the current year's School Dashboard first.", "err");
      try {
        say("Checking which classes the portal lets you add to…");
        const sections = await addableSections(id);
        if (!sections.length) return say("The portal is not allowing Add Student for any class right now.", "err");
        const res = await ask({ type: "add-list", students: await portalList(id) });
        if (!res.ok) return say(res.error, "err");
        const b = res.body;
        const items = [];
        const otherClasses = [];
        const noSection = [];
        for (const c of b.candidates || []) {
          const inClass = sections.filter((s) => Number(s.classId) === Number(c.portalClassId));
          if (!inClass.length) {
            otherClasses.push(c.name);
            continue;
          }
          const sec = inClass.length === 1 ? inClass[0] : inClass.find((s) => String(s.sectionName).trim().toUpperCase() === String(c.sectionName || "").trim().toUpperCase());
          if (!sec) {
            noSection.push(`${c.name} (${c.classLabel})`);
            continue;
          }
          items.push({ studentId: c.studentId, studentName: c.name, classDesc: c.classLabel, classId: String(sec.classId), sectionId: String(sec.sectionId), portalClassName: String(sec.className) });
        }
        const notes = [];
        if ((b.aadhaarPlaceholder || []).length) notes.push(`No Aadhaar in the ERP — the robot enters 999999999999 (the portal's “AADHAAR not available”) for: ${b.aadhaarPlaceholder.join(", ")}. Collect the real numbers and update UDISE+ later (APAAR needs them).`);
        if ((b.alreadyOnPortal || []).length) notes.push(`Probably already on the portal (apply the portal list in the ERP instead): ${b.alreadyOnPortal.join(", ")}`);
        if (otherClasses.length) notes.push(`${otherClasses.length} more in classes the portal is not allowing Add Student for yet.`);
        if (noSection.length) notes.push(`No matching portal section: ${noSection.join(", ")}`);
        if (!items.length) return say(["Nobody to add in the classes the portal allows now.", ...notes].join("\n"), "ok");
        await store.set("queue", { kind: "add", schoolId: id, items, index: 0, startedAt: new Date().toISOString() });
        say([`${items.length} children to add.`, ...notes].join("\n"), "ok");
        await sleep(1200);
        await openCurrent();
      } catch (e) {
        say(e.message || String(e), "err");
      }
    }),
  );

  // ─── APAAR: open "Generate APAAR ID" for ready children, fill, never submit ─

  const onApaarPage = () => /\/apaarModule|\/apaarNewBasicDetails\//.test(location.hash);
  const apaarOpenId = () => (location.hash.match(/\/apaarNewBasicDetails\/(\d+)/) || [])[1] || "";

  async function waitForApaarForm(ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (document.querySelector('[formcontrolname="consenterName"]')) return true;
      await sleep(400);
    }
    return false;
  }

  /** `item` is { studentId, pen, name } from the queue or the portal list. */
  async function fillApaarPage(item) {
    if (apaarOpenId() !== String(item.studentId)) throw new Error("This child's Generate APAAR page is not open.");
    if (!(await waitForApaarForm())) throw new Error("The APAAR page did not open. Reload and try again.");
    const res = await ask({ type: "apaar-fill", pen: item.pen });
    if (!res.ok) throw new Error(res.error);
    const plan = res.body;
    const first = (n) => String(n || "").trim().toUpperCase().split(/\s+/)[0] || "";
    if (!first(item.name) || first(item.name) !== first(plan.student && plan.student.name)) {
      throw new Error(`Names disagree — portal “${item.name}”, ERP “${plan.student && plan.student.name}”. Nothing filled.`);
    }
    const filled = [];
    const kept = [];
    const failed = [];
    for (const f of plan.fields || []) {
      const node = document.querySelector(`[formcontrolname="${f.control}"]`);
      if (!node) {
        failed.push(f.label);
        continue;
      }
      if (node.disabled || (node.value && node.value !== "0" && String(node.value).trim())) {
        kept.push(f.label);
        continue;
      }
      if (f.kind === "select") {
        if (![...node.options].some((o) => o.value === f.value)) {
          failed.push(f.label);
          continue;
        }
        node.value = f.value;
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        setNative(node, f.value);
      }
      if (node.value === f.value) {
        node.classList.add("bhb-robot-filled");
        filled.push(f.label);
      } else {
        failed.push(f.label);
      }
    }
    const lines = [`${plan.student.name} (PEN ${item.pen}) — Generate APAAR ID`, `✓ Filled ${filled.length} field(s), outlined in yellow.`];
    if (kept.length) lines.push(`Already on the page, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
    if ((plan.leftForYou || []).length) lines.push(`Please check / do: ${plan.leftForYou.join("; ")}`);
    lines.push("Check the page, then press the portal's own Submit. After it is accepted, press “Submitted — next child”.");
    return lines.join("\n");
  }

  async function renderApaar() {
    const q = await store.get("apaarQueue");
    const active = !!(q && q.items && q.index < q.items.length);
    apaarBox.textContent = active
      ? `APAAR child ${q.index + 1} of ${q.items.length}: ${q.items[q.index].name}`
      : "";
    apaarBox.style.display = onApaarPage() && apaarBox.textContent ? "" : "none";
    const show = (b, on) => (b.style.display = onApaarPage() && on ? "" : "none");
    show(apaarStartBtn, !active);
    show(apaarNextBtn, active);
    show(apaarSkipBtn, active);
    show(apaarStopBtn, active);
    show(apaarFillBtn, !active && !!apaarOpenId());
    if (onApaarPage()) {
      // The student-profile queue's buttons do not belong on this page.
      for (const b of [queueBox, startBtn, nextBtn, skipBtn, stopBtn, addBtn, pullBtn, fillBtn, addAnywayBtn]) b.style.display = "none";
    }
  }

  async function openApaarCurrent() {
    const q = await store.get("apaarQueue");
    if (!q || !q.items || q.index >= q.items.length) {
      await store.set("apaarQueue", null);
      await renderApaar();
      return say("🎉 Done with every ready child. Press “Only send portal list to ERP” on the dashboard so the ERP picks up the new APAAR IDs.", "ok");
    }
    const item = q.items[q.index];
    await renderApaar();
    say(`Opening ${item.name}…`);
    location.hash = `#/school/${q.schoolId}/apaarNewBasicDetails/${item.studentId}`;
    try {
      say(await fillApaarPage(item), "ok");
    } catch (e) {
      say(`${item.name}: ${e.message || e}\nFill by hand, or press Skip.`, "err");
    }
  }

  const apaarAdvance = async () => {
    const q = await store.get("apaarQueue");
    if (!q) return;
    await store.set("apaarQueue", { ...q, index: q.index + 1 });
    await openApaarCurrent();
  };
  apaarNextBtn.addEventListener("click", () => void clickStep(apaarAdvance));
  apaarSkipBtn.addEventListener("click", () => void clickStep(apaarAdvance));
  apaarStopBtn.addEventListener("click", async () => {
    await store.set("apaarQueue", null);
    await renderApaar();
    say("APAAR queue stopped.");
  });
  apaarStartBtn.addEventListener("click", () =>
    void clickStep(async () => {
      const id = schoolId();
      if (!id) return say("Open the APAAR Module from the school menu first.", "err");
      try {
        say("Reading the student list from the portal…");
        const res = await ask({ type: "apaar-queue", students: await portalList(id) });
        if (!res.ok) throw new Error(res.error);
        const b = res.body;
        const notes = [];
        if ((b.aadhaarNotVerified || []).length) notes.push(`${b.aadhaarNotVerified.length} consented child(ren) wait for the portal to verify their Aadhaar: ${b.aadhaarNotVerified.map((x) => x.name).join(", ")}.`);
        if (b.waitingInErp) notes.push(`${b.waitingInErp} more are ready on the portal but wait on the family in the ERP (consent, or the consenting parent's Aadhaar).`);
        if (!(b.items || []).length) return say(["No child is ready for APAAR right now.", ...notes].join("\n"));
        await store.set("apaarQueue", { schoolId: id, items: b.items, index: 0 });
        if (notes.length) say(notes.join("\n"));
        await openApaarCurrent();
      } catch (e) {
        say(e.message || String(e), "err");
      }
    }),
  );
  apaarFillBtn.addEventListener("click", () =>
    void clickStep(async () => {
      const sid = apaarOpenId();
      try {
        const me = (await portalList(schoolId())).find((x) => String(x.studentId) === sid);
        const pen = me && String(me.studentCodeNat || "").replace(/\D/g, "");
        if (!pen) throw new Error("This child has no PEN on the portal.");
        say(await fillApaarPage({ studentId: sid, pen, name: me.studentName }), "ok");
      } catch (e) {
        say(e.message || String(e), "err");
      }
    }),
  );

  // ─── On each page: show the panel and the count; never act ───────────

  let counted = false;
  async function onPage() {
    const onSchool = /\/school\/\d+\/|academic-choice/.test(location.hash);
    panel.style.display = onSchool ? "" : "none";
    if (!onSchool) return;
    void showLast();
    if (onApaarPage()) return void renderApaar();
    for (const b of [apaarBox, apaarStartBtn, apaarNextBtn, apaarSkipBtn, apaarStopBtn, apaarFillBtn]) b.style.display = "none";
    const q = await store.get("queue");
    if (q && q.items && q.index < q.items.length) return renderQueue(q, 0);
    renderQueue(null, 0);
    // The count is a read of the same list the portal's own pages load.
    if (counted) return;
    const id = schoolId();
    if (!id) return;
    try {
      const n = buildQueue(await portalList(id)).length;
      counted = true;
      renderQueue(null, n);
      say(n ? "Press “Start robot” when you are ready." : "Every child with a PEN has a complete profile.");
    } catch {
      // Not logged in yet, or the portal is busy: the next page tries again.
    }
  }

  window.addEventListener("hashchange", () => void onPage());
  document.body.append(panel);
  setTimeout(() => void onPage(), 2500);
})();

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
  const msg = el("div", { class: "msg" });
  const last = el("div", { class: "muted" });
  body.append(queueBox, startBtn, nextBtn, skipBtn, stopBtn, pullBtn, fillBtn, msg, last);
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
    return `✓ ERP has the portal list: ${s.received} children · PEN ${s.withPen} · APAAR ${s.withApaar} · Aadhaar failed ${s.aadhaarFailed}. (Apply it in ERP → Students → UDISE+.)`;
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
    node.classList.add("bhb-robot-filled");
    return "filled";
  }

  /** The form is an Angular page that renders after the route changes. */
  async function waitForForm(ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (document.querySelector('[formcontrolname="address"], [formcontrolname="pincode"]')) return true;
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
    for (const f of plan.fields || []) {
      const r = fillOne(f);
      if (r === "filled") filled.push(f.label);
      else if (r === "kept") kept.push(f.label);
      else failed.push(f.label);
    }
    const lines = [`${plan.student.name} (PEN ${pen})`, `✓ Filled ${filled.length} empty field(s), outlined in yellow.`];
    if (kept.length) lines.push(`Already on the portal, left as is: ${kept.join(", ")}`);
    if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
    if ((plan.leftForYou || []).length) lines.push(`Not in the ERP — please type: ${plan.leftForYou.join(", ")}`);
    lines.push("Check the yellow fields, type the rest, and press the portal's Save on each step.");
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

  function renderQueue(q, pendingCount) {
    const active = !!(q && q.items && q.index < q.items.length);
    if (active) {
      const it = q.items[q.index];
      queueBox.textContent = `Child ${q.index + 1} of ${q.items.length}: ${it.studentName} (${it.classDesc})`;
    } else if (pendingCount) {
      queueBox.textContent = `${pendingCount} children still have an incomplete portal profile.`;
    } else {
      queueBox.textContent = "";
    }
    queueBox.style.display = queueBox.textContent ? "" : "none";
    for (const b of [nextBtn, skipBtn, stopBtn]) b.style.display = active ? "" : "none";
    startBtn.style.display = active ? "none" : "";
    fillBtn.style.display = !active && /\/new-ac\//.test(location.hash) ? "" : "none";
  }

  let busy = false;
  /** Open the queue's current child and fill it. Called only from a click. */
  async function openCurrent() {
    const q = await store.get("queue");
    if (!q || !q.items || q.index >= q.items.length) {
      await store.set("queue", null);
      renderQueue(null, 0);
      say("🎉 The robot has been through every incomplete child. Press “Only send portal list to ERP” to refresh the ERP.", "ok");
      return;
    }
    const item = q.items[q.index];
    renderQueue(q, 0);
    location.hash = formHash(q.schoolId, item);
    say(`Opening ${item.studentName}…`);
    try {
      say(await fillOpenForm(item), "ok");
    } catch (e) {
      say(`${item.studentName}: ${e.message || e}\nFill by hand, or press Skip.`, "err");
    }
  }

  async function clickStep(fn) {
    if (busy) return;
    busy = true;
    for (const b of [startBtn, nextBtn, skipBtn]) b.disabled = true;
    try {
      await fn();
    } finally {
      busy = false;
      for (const b of [startBtn, nextBtn, skipBtn]) b.disabled = false;
    }
  }

  const advance = async () => {
    const q = await store.get("queue");
    if (!q) return;
    await store.set("queue", { ...q, index: q.index + 1 });
    await openCurrent();
  };
  nextBtn.addEventListener("click", () => void clickStep(advance));
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

  // ─── On each page: show the panel and the count; never act ───────────

  let counted = false;
  async function onPage() {
    const onSchool = /\/school\/\d+\/|academic-choice/.test(location.hash);
    panel.style.display = onSchool ? "" : "none";
    if (!onSchool) return;
    void showLast();
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

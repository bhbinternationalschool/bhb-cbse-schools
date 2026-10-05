/*
 * BHB UDISE Robot — the panel on UDISE+ portal pages.
 *
 * Two buttons, both acting only when a person clicks:
 *  1. "Send portal list to ERP" — reads the portal's own current-year student
 *     list (the same request the portal's list page makes, in this logged-in
 *     tab) and hands it to the ERP's UDISE+ working sheet.
 *  2. "Fill this form from ERP" — on a child's profile form, types the ERP's
 *     values into EMPTY fields only, outlines each one in yellow, and lists
 *     what it left alone. It never presses Save / Next / Complete: a person
 *     checks the page and saves.
 */
(() => {
  if (window.__bhbUdiseRobot) return;
  window.__bhbUdiseRobot = true;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "onclick") n.addEventListener("click", v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  };

  const panel = el("div", { id: "bhb-udise-robot" });
  const head = el("header", {}, "🤖 BHB UDISE Robot", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const pullBtn = el("button", { class: "act", type: "button" }, "Send portal list to ERP");
  const fillBtn = el("button", { class: "act sec", type: "button" }, "Fill this form from ERP");
  const msg = el("div", { class: "msg" });
  const last = el("div", { class: "muted" });
  body.append(pullBtn, fillBtn, msg, last);
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
    new Promise((resolve) => chrome.runtime.sendMessage(payload, (r) => resolve(r || { ok: false, error: "The robot did not answer. Reload the page." })));

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
   * The current year, read off the current-year page headings only. The menu
   * also says "Active Students (2025-26)", so a loose match would send this
   * year's list as last year's. No heading, no guess.
   */
  function currentYear() {
    const t = document.body.innerText || "";
    const m = t.match(/(?:Grade Wise|List of All Students|Enrolment Details)\s*\((20\d{2}-\d{2})\)/i);
    return m ? m[1] : "";
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
    const { lastPull } = await chrome.storage.local.get("lastPull");
    if (!lastPull) return void (last.textContent = "Not sent to the ERP from this browser yet.");
    const when = new Date(lastPull.at).toLocaleString();
    last.textContent = lastPull.ok ? `Last sent ${when}.` : `Last try ${when} failed: ${lastPull.error}`;
  }

  pullBtn.addEventListener("click", async () => {
    const id = schoolId();
    const ay = currentYear();
    if (!id) return say("Open the School Dashboard first (the robot reads the school from the page).", "err");
    if (!ay) return say("Open the School Dashboard for the current year (it shows “Grade Wise (2026-27)”), then click again.", "err");
    pullBtn.disabled = true;
    say(`Reading the ${ay} student list from the portal…`);
    try {
      const students = await portalList(id);
      say(`Sending ${students.length} children to the ERP…`);
      const res = await ask({ type: "pull", academicYearCode: ay, students });
      if (!res.ok) return say(res.error, "err");
      const b = res.body || {};
      const s = b.summary || {};
      say(
        [
          `✓ Sent ${s.received} children (${ay}).`,
          `PEN ${s.withPen} · APAAR ${s.withApaar} · Aadhaar verified ${s.aadhaarVerified}, failed ${s.aadhaarFailed}`,
          `Profiles: not started ${s.entryNotStarted}, in progress ${s.entryInProgress}`,
          `ERP sheet: ${b.added} new, ${b.updated} updated, ${b.unchanged} unchanged.`,
          "Now open ERP → Students → UDISE+ and press Apply.",
        ].join("\n"),
        "ok",
      );
    } catch (e) {
      say(e && e.message ? e.message : String(e), "err");
    } finally {
      pullBtn.disabled = false;
      void showLast();
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
    // Value attributes absent: the portal lays out Yes then No.
    const want = code === "1" ? /^yes$/i : code === "2" ? /^no$/i : null;
    if (!want) return null;
    return all.find((r) => want.test((r.closest("label")?.innerText || r.nextSibling?.textContent || r.parentElement?.innerText || "").trim())) || null;
  }

  /** Returns "filled" | "kept" (portal already has a value) | "missing" (no such field) | "failed". */
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
      const opt = [...node.options].find((o) => o.value === f.value);
      if (!opt) return "failed";
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

  fillBtn.addEventListener("click", async () => {
    const m = location.hash.match(/\/school\/(\d+)\/new-ac\/[^/]+\/[^/]+\/(\d+)/);
    if (!m) return say("Open a child's profile form (Edit → GP/EP/FP) first.", "err");
    fillBtn.disabled = true;
    try {
      say("Finding this child's PEN…");
      const students = await portalList(m[1]);
      const me = students.find((s) => String(s.studentId) === m[2]);
      const pen = me && String(me.studentCodeNat || "").replace(/\D/g, "");
      if (!pen) return say("This child has no PEN on the portal, so the robot cannot be sure who it is. Fill by hand.", "err");
      say(`Asking the ERP about PEN ${pen}…`);
      const res = await ask({ type: "fill-data", pen });
      if (!res.ok) return say(res.error, "err");
      const plan = res.body;
      // Never fill a form for someone else: the portal name must agree.
      const portalName = String(me.studentName || "").trim().toUpperCase();
      const erpName = String(plan.student?.name || "").trim().toUpperCase();
      const first = (n) => n.split(/\s+/)[0] || "";
      if (!portalName || !erpName || first(portalName) !== first(erpName)) {
        return say(`Names disagree — portal “${me.studentName}”, ERP “${plan.student?.name}”. Nothing filled. Check the PEN in the ERP.`, "err");
      }
      const filled = [];
      const kept = [];
      const failed = [];
      for (const f of plan.fields || []) {
        const r = fillOne(f);
        if (r === "filled") filled.push(`${f.label}: ${f.shown}`);
        else if (r === "kept") kept.push(f.label);
        else failed.push(f.label);
      }
      const lines = [`${plan.student.name} (PEN ${pen})`, `✓ Filled ${filled.length} empty field(s) — outlined in yellow.`];
      if (kept.length) lines.push(`Already on the portal, left as is: ${kept.join(", ")}`);
      if (failed.length) lines.push(`Could not fill: ${failed.join(", ")}`);
      if ((plan.leftForYou || []).length) lines.push(`Not in the ERP — please type: ${plan.leftForYou.join(", ")}`);
      lines.push("Check every yellow field, then press Save yourself.");
      say(lines.join("\n"), filled.length ? "ok" : "");
    } catch (e) {
      say(e && e.message ? e.message : String(e), "err");
    } finally {
      fillBtn.disabled = false;
    }
  });

  const syncVisibility = () => {
    const onSchool = /\/school\/\d+\//.test(location.hash);
    panel.style.display = onSchool ? "" : "none";
    fillBtn.style.display = /\/new-ac\//.test(location.hash) ? "" : "none";
  };
  window.addEventListener("hashchange", syncVisibility);
  document.body.append(panel);
  syncVisibility();
  void showLast();
})();

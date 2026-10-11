/*
 * BHB Office Robot — the panel on Propel / LEAD Nucleus
 * (nucleus.leadgroup.co.in), director's request of 12 Oct 2026.
 *
 * Four jobs, each two clicks — "Check" (read Propel, ask the ERP what is
 * missing, show the list) and "Send" (a person confirms; only then does the
 * robot save on Propel):
 *
 *  - Calendar: published ERP holidays, and the exam date sheet as
 *    "Offline assessment" events (subjects Propel does not teach go as
 *    "Academic Event"). Already on Propel = skipped, never doubled.
 *  - Teachers: active ERP teaching staff whose mobile (the Propel login) no
 *    Propel account has. Propel accounts the ERP does not know are only
 *    listed — the robot never deactivates or deletes anyone.
 *  - Students: Propel's own blank upload sheet, filled by the ERP; the office
 *    uploads it with Propel's "Upload List".
 *  - Tests: Propel's question papers and their chapters into the ERP, with the
 *    chapters the ERP's books lack.
 *  - Teacher progress: Propel's Teacher Timeliness (day plans done against
 *    the schedule, per teacher, class and subject) into Staff → Appraisal.
 *
 * Uses the office's own Propel login on this page (the token the page itself
 * uses) — never a password, no timers.
 */
(() => {
  if (window.__bhbPropelRobot) return;
  window.__bhbPropelRobot = true;

  const API = "https://nucleus.leadschool.in/api/gtw";

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) n.append(k);
    return n;
  };

  const panel = el("div", { id: "bhb-office-robot" });
  const head = el("header", {}, "🤖 BHB Office Robot · Propel", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const calCheck = el("button", { class: "act", type: "button" }, "Check holidays & exams");
  const calSend = el("button", { class: "act sec", type: "button" }, "Send to Propel calendar");
  const tchCheck = el("button", { class: "act", type: "button" }, "Check teachers");
  const tchSend = el("button", { class: "act sec", type: "button" }, "Create teachers on Propel");
  const stuFile = el("button", { class: "act", type: "button" }, "Make student upload sheet");
  const testsBtn = el("button", { class: "act", type: "button" }, "Bring tests & chapters to ERP");
  const progressBtn = el("button", { class: "act", type: "button" }, "Bring teacher progress to ERP");
  const msg = el("div", { class: "msg" });
  body.append(calCheck, calSend, tchCheck, tchSend, stuFile, testsBtn, progressBtn, msg);
  panel.append(head, body);
  head.addEventListener("click", () => {
    panel.classList.toggle("min");
    head.lastChild.textContent = panel.classList.contains("min") ? "+" : "–";
  });
  calSend.style.display = "none";
  tchSend.style.display = "none";

  const say = (text, tone = "") => {
    msg.className = `msg ${tone}`;
    msg.textContent = text;
  };
  const ask = (payload) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage(payload, (r) => resolve(r || { ok: false, error: "The robot did not answer. Reload the page." })),
    );
  const busy = (on) => {
    for (const b of body.querySelectorAll("button")) b.disabled = on;
  };

  // ─── Propel's own API, as the page calls it ──────────────────────────

  const clean = (v) => String(v || "").replace(/^"|"$/g, "");
  function schoolId() {
    const m = location.pathname.match(/\/(?:schools|migrated)\/(\d+)/);
    return (m && m[1]) || clean(localStorage.getItem("selected_school_id"));
  }
  function headers(module) {
    const token = clean(localStorage.getItem("auth_token"));
    const year = clean(localStorage.getItem("academic_year_id"));
    if (!token || !year || !schoolId()) throw new Error("Propel is not ready — log in and open the school dashboard first.");
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Product-Type": "LEAD",
      "X-Product-Domain": location.host,
      Authorization: token,
      academicyearid: year,
      "X-AcademicYearId": year,
      "X-Client-App": "LEAD",
      source: "webapp",
      "X-Module-Name": module,
    };
  }
  async function propel(method, path, module, data) {
    const r = await fetch(`${API}/${path}`, {
      method,
      headers: headers(module),
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let j = null;
    try {
      j = await r.json();
    } catch {
      j = null;
    }
    if (!r.ok || (j && j.success === false)) {
      throw new Error((j && (j.msg || j.message || j.error)) || `Propel answered ${r.status}`);
    }
    return j;
  }

  // ─── Calendar ────────────────────────────────────────────────────────

  let calPlan = null;
  calCheck.addEventListener("click", async () => {
    busy(true);
    calSend.style.display = "none";
    calPlan = null;
    try {
      say("Reading Propel's calendar…");
      const id = schoolId();
      const hol = await propel("GET", `v1/${id}/leadhome/lms/calendar/holiday?getMasters=true&pageNo=1&pageSize=1000`, "academic_calendar");
      const ev = await propel("GET", `v1/${id}/leadhome/lms/calendar/event?getMasters=true&pageNo=1&pageSize=1000`, "academic_calendar");
      const res = await ask({
        type: "propel-calendar",
        holidays: (hol.data && hol.data.holidays) || [],
        events: (ev.data && ev.data.events) || [],
        subjects: (ev.masters && ev.masters.subjects) || [],
      });
      if (!res.ok) return say(res.error, "err");
      const { holidays, exams } = res.body;
      calPlan = res.body;
      const lines = [
        `Holidays: ${holidays.create.length} to add · ${holidays.already} already on Propel`,
        `Exams: ${exams.create.length} to add (${exams.asAcademicEvent} as Academic Event — subject not on Propel) · ${exams.already} already on Propel`,
      ];
      for (const h of holidays.create.slice(0, 12)) lines.push(`  + ${h.startDate} ${h.description}`);
      for (const e of exams.create.slice(0, 20)) lines.push(`  + ${e.startDate} ${e.description} · ${e.selectedClasses.length} class(es)`);
      const skipped = [...holidays.skipped, ...exams.skipped];
      if (skipped.length) {
        lines.push("", `Not sent (${skipped.length}):`);
        for (const s of skipped.slice(0, 15)) lines.push(`  · ${s.what} — ${s.why}`);
      }
      const total = holidays.create.length + exams.create.length;
      if (total) {
        calSend.textContent = `Send ${total} to Propel calendar`;
        calSend.style.display = "";
      }
      say(lines.join("\n"), total ? "" : "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      busy(false);
    }
  });

  calSend.addEventListener("click", async () => {
    if (!calPlan) return;
    const items = [
      ...calPlan.holidays.create.map((p) => ({ kind: "holiday", p })),
      ...calPlan.exams.create.map((p) => ({ kind: "event", p })),
    ];
    if (!window.confirm(`Add ${items.length} entries to Propel's calendar for 2026-27?`)) return;
    busy(true);
    let done = 0;
    try {
      const id = schoolId();
      for (const it of items) {
        say(`Saving ${done + 1} of ${items.length}: ${it.p.description}…`);
        await propel("PUT", `v1/${id}/leadhome/lms/calendar/${it.kind}`, "academic_calendar", it.p);
        done++;
      }
      calSend.style.display = "none";
      calPlan = null;
      say(`Done — ${done} added to Propel. Reload the calendar page to see them.`, "ok");
    } catch (e) {
      say(`Stopped after ${done} of ${items.length}: ${e.message || e}. Press "Check" again — what landed will show as already on Propel.`, "err");
    } finally {
      busy(false);
    }
  });

  // ─── Teachers ────────────────────────────────────────────────────────

  let tchPlan = null;
  tchCheck.addEventListener("click", async () => {
    busy(true);
    tchSend.style.display = "none";
    tchPlan = null;
    try {
      say("Reading Propel's teachers…");
      const j = await propel("GET", `v1/${schoolId()}/school/getteachers`, "teacher_setup");
      const list = (j.data && j.data.schoolUsers) || [];
      const res = await ask({ type: "propel-teachers", teachers: list });
      if (!res.ok) return say(res.error, "err");
      tchPlan = res.body;
      const lines = [`${tchPlan.create.length} to create · ${tchPlan.already} already on Propel (matched by mobile)`];
      for (const t of tchPlan.create) lines.push(`  + ${t.erpName} · ${t.mobile} · role ${t.role_code}`);
      if (tchPlan.skipped.length) {
        lines.push("", "Not sent:");
        for (const s of tchPlan.skipped) lines.push(`  · ${s.what} — ${s.why}`);
      }
      if (tchPlan.onlyOnPropel.length) {
        lines.push("", `On Propel but not active teaching staff in the ERP (left as they are): ${tchPlan.onlyOnPropel.join(", ")}`);
      }
      if (tchPlan.create.length) {
        tchSend.textContent = `Create ${tchPlan.create.length} teacher(s) on Propel`;
        tchSend.style.display = "";
      }
      say(lines.join("\n"), tchPlan.create.length ? "" : "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      busy(false);
    }
  });

  tchSend.addEventListener("click", async () => {
    if (!tchPlan) return;
    const items = tchPlan.create;
    if (!window.confirm(`Create ${items.length} teacher login(s) on Propel? Their mobile number is their Propel login.`)) return;
    busy(true);
    let done = 0;
    try {
      for (const t of items) {
        const { erpName, ...payload } = t;
        say(`Creating ${done + 1} of ${items.length}: ${erpName}…`);
        await propel("PUT", `v1/${schoolId()}/school/editteachers`, "teacher_setup", payload);
        done++;
      }
      tchSend.style.display = "none";
      tchPlan = null;
      say(`Done — ${done} teacher(s) created. Reload Teacher Details to see them.`, "ok");
    } catch (e) {
      say(`Stopped after ${done} of ${items.length}: ${e.message || e}. Press "Check teachers" again.`, "err");
    } finally {
      busy(false);
    }
  });

  // ─── Students ────────────────────────────────────────────────────────

  stuFile.addEventListener("click", async () => {
    busy(true);
    try {
      say("Downloading Propel's blank sheet…");
      const r = await fetch(`${API}/v1/${schoolId()}/school/student/download/sample`, { headers: headers("student_setup") });
      if (!r.ok) throw new Error(`Propel answered ${r.status} for its template`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      say("Filling it from the ERP…");
      const res = await ask({ type: "propel-students-file", template: btoa(bin) });
      if (!res.ok) return say(res.error, "err");
      const { file, fileName, count, skipped } = res.body;
      const raw = atob(file);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = el("a", { href: url, download: fileName });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const lines = [
        `Saved ${fileName} — ${count} student(s).`,
        "Upload it on Propel: Student Details → Upload List.",
      ];
      if (skipped.length) {
        lines.push("", `Left out (${skipped.length}) — fix in the ERP, then make the sheet again:`);
        for (const s of skipped.slice(0, 25)) lines.push(`  · ${s.what} — ${s.why}`);
      }
      say(lines.join("\n"), "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      busy(false);
    }
  });

  // ─── Tests ───────────────────────────────────────────────────────────

  testsBtn.addEventListener("click", async () => {
    busy(true);
    try {
      say("Reading Propel's tests…");
      const j = await propel("GET", `v2/${schoolId()}/assessments/recommended`, "lead_assessments");
      const list = (j.data && j.data.assessmentsList) || [];
      if (!list.length) return say("Propel lists no tests for this year.", "err");
      const res = await ask({ type: "propel-tests", assessments: list });
      if (!res.ok) return say(res.error, "err");
      const { kept, ready, gaps } = res.body;
      const lines = [`Kept ${kept} Propel test(s) in the ERP (${ready} with chapters).`];
      if (gaps.length) {
        lines.push("", "Chapters Propel's tests name that the ERP's books lack — check the book list:");
        for (const g of gaps.slice(0, 20)) lines.push(`  · ${g.className} ${g.subject}: ${g.missing.slice(0, 6).join("; ")}${g.missing.length > 6 ? " …" : ""}`);
      } else {
        lines.push("Every chapter Propel's tests name is in the ERP's books.");
      }
      say(lines.join("\n"), "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      busy(false);
    }
  });

  // ─── Teacher progress ────────────────────────────────────────────────

  progressBtn.addEventListener("click", async () => {
    busy(true);
    try {
      say("Reading Propel's Teacher Timeliness…");
      const id = schoolId();
      // The same call the Teacher Timeliness page makes (board 1 = the school's board on Propel).
      const j = await propel("GET", `v1/schools/${id}/teachers/teacherPerformance/completion?board_id=1`, "teacher_performance");
      const rows = Array.isArray(j.data) ? j.data : [];
      if (!rows.length) return say("Propel shows no teacher progress yet.", "err");
      const t = await propel("GET", `v1/${id}/school/getteachers`, "teacher_setup");
      const teachers = (t.data && t.data.schoolUsers) || [];
      const res = await ask({ type: "propel-progress", rows, teachers });
      if (!res.ok) return say(res.error, "err");
      const { kept, behind, matched } = res.body;
      say(
        `Kept ${kept} class-subject row(s) in the ERP — ${behind} behind Propel's schedule; ${matched} matched to ERP staff.\nSee ERP → Staff → Appraisal → Propel progress.`,
        "ok",
      );
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      busy(false);
    }
  });

  document.body.append(panel);
})();

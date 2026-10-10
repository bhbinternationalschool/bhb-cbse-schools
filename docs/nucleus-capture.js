/*
 * "Send to ERP" — the one click an office user makes on Nucleus.
 *
 * It reads whichever page it is on:
 *
 *   Assessments & Answer key  — walks the list, opens each ready paper the way
 *                               a person would, and reads the addresses of its
 *                               question paper and answer key. Also records
 *                               what the publisher has prepared and what it
 *                               has not.
 *   Teacher Timeliness        — reads the table cell by cell, so the day-plan
 *                               numbers arrive as numbers rather than being
 *                               pulled back out of "36% Course (50/140 day
 *                               plans)" at the other end.
 *
 * It downloads nothing and changes nothing. When it is done it hands the
 * reading straight to the ERP, which opens in its own tab the moment this is
 * clicked and starts work on its own; the clipboard is only the fallback for
 * when that tab cannot be opened or nobody is signed in there.
 *
 * The check that matters: after opening a paper it waits until the page is
 * really showing THAT paper before reading anything. Without it the page still
 * holds the previous paper for a moment, and a capture made that way filed one
 * class's answer key against another class's paper.
 *
 * See docs/NUCLEUS_CAPTURE_BOOKMARK.md for how this becomes a bookmark.
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:999999;background:#111;color:#fff;" +
    "font:13px/1.4 system-ui;padding:10px 14px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.4)";
  const say = (t) => { box.textContent = t; };
  say("Starting…");
  document.body.appendChild(box);

  /* ---------------------------------------------------------------------- */
  /* Handing the reading over                                               */
  /* ---------------------------------------------------------------------- */

  const ERP_ORIGIN = "https://bhbinternational.school";
  const onTimeliness = /timeliness/i.test(location.pathname);
  const PAGE = onTimeliness ? "timeliness" : "papers";
  const DESK = onTimeliness ? "/teaching?tab=nucleus" : "/exams?tab=papers";

  // Opened now, while this click is still a user gesture the browser will
  // honour. Opening it when the reading finishes — twelve minutes later on the
  // papers page — is refused as a pop-up, and the reading would have nowhere
  // to go but the clipboard again.
  let erp = null;
  try {
    erp = window.open(ERP_ORIGIN + DESK, "bhb-erp-capture");
  } catch (e) {
    erp = null;
  }

  // The ERP speaks first, when its screen is listening. A message posted to a
  // window that is still loading is dropped without a sound, so waiting for it
  // to say so is the difference between arriving and vanishing.
  let erpReady = false;
  window.addEventListener("message", (e) => {
    if (e.origin === ERP_ORIGIN && e.data && e.data.kind === "nucleus-capture-ready") erpReady = true;
  });

  async function deliver(payload, what) {
    if (erp && !erp.closed) {
      // Thirty seconds. The papers reading takes twelve minutes, by which
      // time the ERP has long since answered — but a timeliness reading is
      // finished before the ERP tab has even loaded, and that is the one that
      // would otherwise fall back to the clipboard for no reason.
      for (let n = 0; n < 120 && !erpReady; n++) await sleep(250);
      if (erpReady) {
        // Named origin, never "*": this reading is nobody else's business.
        erp.postMessage({ kind: "nucleus-capture", page: PAGE, payload }, ERP_ORIGIN);
        try { erp.focus(); } catch (e) {}
        say("Done — " + what + " sent to the ERP. Nothing to paste.");
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(payload);
      say("Done — " + what + " copied. Paste into the ERP.");
    } catch (e) {
      window.__nucleusCapture = payload;
      say("Done. Clipboard blocked — copy window.__nucleusCapture from the console.");
    }
  }

  /** The list the page is showing, read from its own data. */
  function readList() {
    const root = [...document.querySelectorAll("div, main, body > *")]
      .map((el) => el[Object.keys(el).find((k) => k.startsWith("__reactContainer") || k.startsWith("__reactFiber")) || ""])
      .find(Boolean);
    let found = null;
    const seen = new WeakSet();
    (function walk(node, depth) {
      if (!node || depth > 400 || found) return;
      for (const bag of [node.memoizedProps, node.memoizedState]) {
        const stack = [[bag, 0]];
        while (stack.length && !found) {
          const [v, d] = stack.pop();
          if (!v || typeof v !== "object" || d > 6 || seen.has(v)) continue;
          seen.add(v);
          if (Array.isArray(v) && v.length > 20 && v[0] && typeof v[0] === "object" && "asmName" in v[0]) { found = v; break; }
          for (const k of Object.keys(v)) { try { stack.push([v[k], d + 1]); } catch {} }
        }
      }
      walk(node.child, depth + 1); walk(node.sibling, depth + 1);
    })(root, 0);
    return found;
  }

  /** The file addresses the open paper's page holds, or null while it is stale. */
  function readResources(expect) {
    const root = [...document.querySelectorAll("div, main, body > *")]
      .map((el) => el[Object.keys(el).find((k) => k.startsWith("__reactContainer") || k.startsWith("__reactFiber")) || ""])
      .find(Boolean);
    let out = null;
    const seen = new WeakSet();
    (function walk(node, depth) {
      if (!node || depth > 400 || out) return;
      for (const bag of [node.memoizedProps, node.memoizedState]) {
        const stack = [[bag, 0]];
        while (stack.length && !out) {
          const [v, d] = stack.pop();
          if (!v || typeof v !== "object" || d > 6 || seen.has(v)) continue;
          seen.add(v);
          if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "link" in v[0] && "resourceType" in v[0]) { out = v; break; }
          for (const k of Object.keys(v)) { try { stack.push([v[k], d + 1]); } catch {} }
        }
      }
      walk(node.child, depth + 1); walk(node.sibling, depth + 1);
    })(root, 0);
    if (!out || !out[0]) return null;
    // Only believe a page that names the paper we just opened.
    if (out[0].asmId !== expect.asmId || out[0].asmName !== expect.asmName) return null;
    return out;
  }

  /** The Teacher Timeliness table, read cell by cell. */
  function readTimeliness() {
    const rows = [...document.querySelectorAll("table tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((c) => c.length >= 5 && /^\d+$/.test(c[0] || ""));
    const plans = (cell) => {
      // "36% Course (50/140 day plans)" — the two numbers, not the sentence.
      const m = /\((\d+)\s*\/\s*(\d+)/.exec(cell || "");
      return m ? { done: Number(m[1]), total: Number(m[2]) } : { done: 0, total: 0 };
    };
    return rows.map((c) => {
      const required = plans(c[3]);
      const current = plans(c[4]);
      // "Class1-Propel Hindi" is how they spell one class and one subject.
      const at = (c[2] || "").indexOf("-");
      return {
        position: Number(c[0]),
        teacherName: c[1] || "",
        classLabel: at > 0 ? c[2].slice(0, at).trim() : c[2] || "",
        subjectLabel: at > 0 ? c[2].slice(at + 1).trim() : "",
        totalPlans: current.total || required.total,
        requiredPlans: required.done,
        currentPlans: current.done,
        statusText: c[5] || "",
      };
    });
  }

  const capturedOn = new Date().toISOString().slice(0, 10);

  if (/timeliness/i.test(location.pathname)) {
    const timeliness = readTimeliness();
    if (!timeliness.length) { say("No timeliness table on screen."); return; }
    const payload = JSON.stringify({ capturedOn, timeliness }, null, 1);
    await deliver(payload, `${timeliness.length} teacher rows`);
    setTimeout(() => box.remove(), 30000);
    return;
  }

  const list = readList();
  if (!list) { say("Open Assessments & Answer key or Teacher Timeliness first."); return; }
  const ready = list.filter((r) => r.assessmentState === "PUBLISHED");
  say(`${ready.length} papers to read…`);

  const rows = [];
  for (const [i, r] of ready.entries()) {
    const link = document.querySelector(`a[href*="asmPlatformPaperId=${r.asmPlatformPaperId}"]`);
    if (!link) { rows.push({ paperId: String(r.asmPlatformPaperId), classLabel: r.className, subject: r.subjectName, title: r.asmName, error: "not on the list" }); continue; }
    link.click();
    let res = null;
    for (let n = 0; n < 40 && !res; n++) { await sleep(200); res = readResources(r); }
    const byCode = Object.fromEntries((res || []).map((x) => [x.paperCode, x.link]));
    rows.push({
      paperId: String(r.asmPlatformPaperId),
      classLabel: r.className,
      division: r.divisionName || "A",
      subject: r.subjectName,
      title: r.asmName,
      unit: r.unitName || "",
      questionPaperDocxUrl: byCode.paper_doc || "",
      answerKeyUrl: byCode.answer_key || "",
    });
    history.back();
    for (let n = 0; n < 25; n++) {
      await sleep(180);
      if (document.querySelectorAll('a[href*="view-assessment"]').length > ready.length / 2) break;
    }
    say(`Reading ${i + 1} of ${ready.length}…`);
  }

  // What the publisher has prepared and what it has not — the same list, in
  // the words Nucleus uses, for the screen that shows what is still missing.
  const assessments = list.map((r) => ({
    classLabel: r.className,
    division: r.divisionName || "A",
    subject: r.subjectName,
    title: r.asmName,
    chapters: "",
    statusText: r.assessmentState === "PUBLISHED" ? "Ready to Download" : "Not Created",
  }));

  const payload = JSON.stringify({ capturedOn, papers: rows, assessments }, null, 1);
  await deliver(payload, `${rows.length} papers`);
  setTimeout(() => box.remove(), 30000);
})();

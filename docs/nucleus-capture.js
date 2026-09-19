/*
 * "Send papers to ERP" — the one click an office user makes on Nucleus.
 *
 * It walks the Assessments & Answer key list, opens each ready paper the way a
 * person would, and reads the addresses of its question paper and answer key.
 * It downloads nothing and changes nothing; the only output is a list on the
 * clipboard, which is pasted into the ERP.
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

  const list = readList();
  if (!list) { say("Open Assessments & Answer key first."); return; }
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

  const payload = JSON.stringify({ capturedOn: new Date().toISOString().slice(0, 10), rows }, null, 1);
  try {
    await navigator.clipboard.writeText(payload);
    say(`Done — ${rows.length} papers copied. Paste into the ERP.`);
  } catch {
    window.__nucleusCapture = payload;
    say("Done. Clipboard blocked — copy window.__nucleusCapture from the console.");
  }
  setTimeout(() => box.remove(), 30000);
})();

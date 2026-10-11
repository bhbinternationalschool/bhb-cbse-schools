/*
 * BHB Office Robot — the panel on Pinnacle Smart Teach
 * (teacher.pinnaclelearning.in), director's request of 12 Oct 2026.
 *
 * One job: "Check books against ERP". On the Book Library page the robot
 * reads each book's table of contents — the publisher's complete chapter
 * list for Click Code Connect, Know and Grow, New Longman Vistas and
 * Tip-Tap-Toe — and the ERP compares it with its loaded book for that class
 * and subject: chapters missing from the ERP, chapters the publisher's book
 * no longer has, and what changed since the last check.
 *
 * Read only on both sides: nothing is saved on Smart Teach, and the ERP's
 * books are never edited from here. It reads only what the Book Library page
 * shows (each book's cover points at its e-book folder) and the e-books'
 * own contents files — never a password or the page's login.
 */
(() => {
  if (window.__bhbPinnacleRobot) return;
  window.__bhbPinnacleRobot = true;

  const CDN = /^https:\/\/books-cdn\.leadschool\.in\/prod\//;

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
  const head = el("header", {}, "🤖 BHB Office Robot · Pinnacle", el("span", { class: "muted" }, "–"));
  const body = el("div", { class: "body" });
  const checkBtn = el("button", { class: "act", type: "button" }, "Check books against ERP");
  const msg = el("div", { class: "msg" });
  body.append(checkBtn, msg);
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

  // ─── The Book Library, as the page shows it ──────────────────────────

  /** Each book card: its title and its e-book folder (from the cover image). */
  function libraryBooks() {
    const out = [];
    const seen = new Set();
    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src || "";
      if (!CDN.test(src)) continue;
      const root = src.replace(/\/(OPS|OEBPS)\/.*$/i, "").replace(/\/images\/.*$/i, "");
      if (seen.has(root)) continue;
      seen.add(root);
      let node = img;
      let title = "";
      for (let i = 0; i < 6 && node && !title; i++) {
        node = node.parentElement;
        const t = ((node && node.innerText) || "").trim();
        if (t) title = t.split("\n")[0].trim();
      }
      out.push({ title, root, path: root.replace(CDN, "") });
    }
    return out;
  }

  const xml = async (url, type) => {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) throw new Error(`${r.status} for ${url.replace(CDN, "")}`);
    return new DOMParser().parseFromString(await r.text(), type);
  };

  /** A book's chapter list from its EPUB contents (EPUB 3 nav, else EPUB 2 NCX). */
  async function contents(root) {
    const container = await xml(`${root}/META-INF/container.xml`, "application/xml");
    const rootfile = container.getElementsByTagName("rootfile")[0];
    const opfUrl = new URL(rootfile.getAttribute("full-path"), `${root}/`).href;
    const opf = await xml(opfUrl, "application/xml");
    const items = [...opf.getElementsByTagName("item")];
    const nav = items.find((x) => /\bnav\b/.test(x.getAttribute("properties") || ""));
    if (nav) {
      const doc = await xml(new URL(nav.getAttribute("href"), opfUrl).href, "text/html");
      const toc = doc.querySelector("nav[epub\\:type='toc'], nav#toc, nav") || doc.body;
      const list = toc.querySelector("ol");
      if (!list) return [];
      return [...list.children]
        .map((li) => {
          const label = li.querySelector(":scope > a, :scope > span") || li;
          return label.textContent.replace(/\s+/g, " ").trim();
        })
        .filter(Boolean);
    }
    const ncx = items.find((x) => /ncx/.test(x.getAttribute("media-type") || ""));
    if (!ncx) return [];
    const doc = await xml(new URL(ncx.getAttribute("href"), opfUrl).href, "application/xml");
    return [...doc.querySelectorAll("navMap > navPoint")]
      .map((p) => (p.querySelector("navLabel text") || p).textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  checkBtn.addEventListener("click", async () => {
    // The covers arrive a moment after the page; wait for them to settle.
    let found = libraryBooks();
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const now = libraryBooks();
      if (now.length && now.length === found.length) break;
      found = now;
    }
    if (!found.length) {
      say("Open the Book Library (left menu) so the books show, then press this again.", "err");
      return;
    }
    checkBtn.disabled = true;
    try {
      const books = [];
      const failed = [];
      for (const [i, b] of found.entries()) {
        say(`Reading contents ${i + 1} of ${found.length}: ${b.title || b.path}…`);
        try {
          books.push({ title: b.title, path: b.path, chapters: await contents(b.root) });
        } catch (e) {
          failed.push(`${b.title || b.path} (${e.message || e})`);
        }
      }
      say("Comparing with the ERP's books…");
      const res = await ask({ type: "pinnacle-books", books });
      if (!res.ok) throw new Error(res.error || `ERP answered ${res.status}`);
      const { checked, checks } = res.body;
      const lines = [`Checked ${checked} book(s) against the ERP.`];
      let same = 0;
      for (const c of checks) {
        const label = `${c.className.replace("Class", "Class ")} ${c.subject}`;
        const notes = [];
        if (!c.erpHasBook) notes.push(c.subject === "Rhymes and Stories" ? "no ERP subject for it" : "no ERP book loaded");
        else if (c.sameStructure) {
          if (!c.missingInErp.length && !c.notOnPropel.length) {
            same++;
            continue;
          }
          if (c.missingInErp.length) notes.push(`not in ERP: ${c.missingInErp.slice(0, 5).join("; ")}${c.missingInErp.length > 5 ? " …" : ""}`);
          if (c.notOnPropel.length) notes.push(`ERP only: ${c.notOnPropel.slice(0, 5).join("; ")}${c.notOnPropel.length > 5 ? " …" : ""}`);
        } else notes.push(`different edition — Pinnacle ${c.propelUnits} chapters, ERP ${c.erpChapters}, fewer than half the names match`);
        if (c.changedOnPropel && (c.changedOnPropel.added.length || c.changedOnPropel.removed.length)) {
          notes.push(`CHANGED since last check: +${c.changedOnPropel.added.join("; ") || "—"} / −${c.changedOnPropel.removed.join("; ") || "—"}`);
        }
        lines.push(`  · ${label}: ${notes.join(" · ")}`);
      }
      if (same) lines.push(`  ${same} book(s) match the ERP chapter for chapter.`);
      if (failed.length) lines.push("", `Could not read: ${failed.join("; ")}`);
      lines.push("", "Nothing was changed on Smart Teach or in the ERP — this is a report.");
      say(lines.join("\n"), "ok");
    } catch (e) {
      say(e.message || String(e), "err");
    } finally {
      checkBtn.disabled = false;
    }
  });

  document.body.append(panel);
})();

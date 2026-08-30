/**
 * The website module's rules — page addresses, liveness, and photo consent.
 *
 * Three things here can fail quietly and expensively:
 *
 *   1. A page address that collides with a route the app already answers on.
 *      The public site resolves unknown paths through a catch-all, and a
 *      catch-all loses to a real route — so a page saved at `fees` would
 *      report "published", be linked from the menu, and show the fee desk's
 *      login instead. Nothing about that looks like an error.
 *
 *   2. `isPageLive` reading status alone. A page scheduled for next Monday is
 *      not live today; one published without a timestamp is. Getting this
 *      wrong publishes early or hides something that should be up.
 *
 *   3. Consent defaulting to yes. A photograph of an identifiable child is
 *      that child's personal data. The default has to be no.
 *
 * Run: npx tsx src/lib/website.selftest.ts
 */
import assert from "node:assert/strict";
import {
  BLOCK_KINDS,
  CONSENT_STATUSES,
  LANGUAGES,
  PAGE_STATUSES,
  RESERVED_SLUGS,
  BLOCK_SHAPES,
  altProblem,
  blockProblem,
  emptyPayload,
  isBuildableKind,
  isPageLive,
  parseProse,
  youtubeId,
  mayPublishMedia,
  mediaReadyForPage,
  mediaToRow,
  newSiteId,
  normalizeSlug,
  pageToRow,
  publicPathFor,
  slugProblem,
  type ConsentStatus,
  type PageStatus,
} from "./website";

// ── A page can never be given an address the app already answers on ───────
{
  for (const taken of ["fees", "login", "parent", "api", "home", "contact"]) {
    const problem = slugProblem(taken);
    assert.ok(
      problem,
      `“${taken}” is a real route — a page there would never be reached`,
    );
    assert.ok(
      problem.includes(taken),
      "the message must name the address, or the office cannot act on it",
    );
  }

  // The FIRST segment is what decides it: /fees/anything is still the fee desk.
  assert.ok(
    slugProblem("fees/structure"),
    "a child of a real route is shadowed just as completely as the route",
  );

  // ...but a page whose name merely contains one is fine.
  assert.equal(slugProblem("school-fees-explained"), null);
  assert.equal(slugProblem("about-us"), null);
  assert.equal(slugProblem("academics/curriculum"), null);
}

// ── Two pages cannot share an address ─────────────────────────────────────
{
  assert.equal(
    slugProblem("Our Campus", { existingSlugs: ["our-campus"] }),
    "Another page already uses that address.",
    "the clash is on the normalised form, not the typed one",
  );
  assert.equal(slugProblem("our-campus", { existingSlugs: ["about"] }), null);
}

// ── Addresses are tidied, not rejected, for ordinary typing mistakes ──────
{
  assert.equal(normalizeSlug("  About Us  "), "about-us");
  assert.equal(normalizeSlug("/academics/curriculum/"), "academics/curriculum");
  assert.equal(normalizeSlug("Fees & Charges"), "fees-charges");
  assert.equal(normalizeSlug("a//b"), "a/b");
  assert.equal(
    normalizeSlug("Academics / Curriculum"),
    "academics/curriculum",
    "a slash with spaces round it is still a section separator",
  );
  assert.equal(normalizeSlug(""), "");
  assert.equal(
    slugProblem(""),
    "Give the page an address, for example about-us.",
    "an empty address is explained, not just refused",
  );
}

// ── The public path ───────────────────────────────────────────────────────
{
  assert.equal(publicPathFor("about"), "/about");
  assert.equal(publicPathFor("/about/"), "/about");
  assert.equal(publicPathFor(""), "/");
}

// ── Liveness needs the clock, not just the status ─────────────────────────
{
  const now = new Date("2026-09-01T10:00:00.000Z");
  const base = {
    status: "draft" as PageStatus,
    publishedAt: null as string | null,
    scheduledPublishAt: null as string | null,
    deletedAt: null as string | null,
  };

  assert.equal(isPageLive({ ...base }, now), false, "a draft is not live");
  assert.equal(
    isPageLive({ ...base, status: "archived" }, now),
    false,
    "an archived page has been taken down",
  );

  assert.equal(
    isPageLive({ ...base, status: "published" }, now),
    true,
    "published with no timestamp is live — do not invent a date it went up",
  );
  assert.equal(
    isPageLive(
      { ...base, status: "published", publishedAt: "2026-08-01T00:00:00.000Z" },
      now,
    ),
    true,
  );
  assert.equal(
    isPageLive(
      { ...base, status: "published", publishedAt: "2026-10-01T00:00:00.000Z" },
      now,
    ),
    false,
    "a future publish date has not arrived, whatever the status says",
  );

  assert.equal(
    isPageLive(
      {
        ...base,
        status: "scheduled",
        scheduledPublishAt: "2026-09-08T00:00:00.000Z",
      },
      now,
    ),
    false,
    "next Monday is not today",
  );
  assert.equal(
    isPageLive(
      {
        ...base,
        status: "scheduled",
        scheduledPublishAt: "2026-08-25T00:00:00.000Z",
      },
      now,
    ),
    true,
    "a scheduled time that has passed makes the page live",
  );
  assert.equal(
    isPageLive({ ...base, status: "scheduled" }, now),
    false,
    "scheduled with no time is not a promise to publish",
  );

  assert.equal(
    isPageLive(
      { ...base, status: "published", deletedAt: "2026-08-30T00:00:00.000Z" },
      now,
    ),
    false,
    "a removed page is never live, whatever its status still reads",
  );
}

// ── Consent defaults to no for anything showing a person ──────────────────
{
  assert.equal(
    mayPublishMedia({ consentStatus: "not_required" }),
    true,
    "a building or a crest has no one to consent",
  );
  assert.equal(mayPublishMedia({ consentStatus: "granted" }), true);
  assert.equal(
    mayPublishMedia({ consentStatus: "pending" }),
    false,
    "asked-for is not given",
  );
  assert.equal(
    mayPublishMedia({ consentStatus: "withdrawn" }),
    false,
    "a withdrawn consent takes the photo down everywhere it appears",
  );
}

// ── A write never carries its own revision ────────────────────────────────
{
  const row = pageToRow({ title: "About", slug: "About Us" });
  assert.equal(row.slug, "about-us", "the address is normalised on the way in");
  assert.ok(
    !("updated_at" in row),
    "the server stamps the revision — a client that set its own could " +
      "overwrite someone else's edit without a conflict",
  );
  assert.ok(!("id" in row), "the id identifies the op, it is not a column to set");

  // A partial write must stay partial: the guard patches, so an absent key
  // keeps its stored value and a key present as "" genuinely clears it.
  const partial = pageToRow({ title: "Only the title" });
  assert.deepEqual(Object.keys(partial), ["title"]);
  assert.equal(pageToRow({ seoTitle: "" }).seo_title, "");
}

// ── Ids are unique enough to create pages in a loop ───────────────────────
{
  const ids = new Set(Array.from({ length: 500 }, () => newSiteId("pg")));
  assert.equal(ids.size, 500, "two pages created in the same millisecond clash");
  assert.ok([...ids][0].startsWith("pg_"));
}

// ── The palette and the status list stay in step with the database ────────
{
  // These arrays are mirrored by CHECK constraints in migration
  // 20260830200000. A value added here and not there fails on write with a
  // constraint violation the office cannot interpret.
  assert.deepEqual(
    PAGE_STATUSES.map((s) => s.id),
    ["draft", "scheduled", "published", "archived"],
  );
  assert.deepEqual(
    BLOCK_KINDS.map((b) => b.id),
    [
      "prose", "image", "gallery", "video", "cards", "stats",
      "people", "downloads", "feed", "calendar", "faq", "enquiry",
    ],
  );
  assert.equal(
    new Set(BLOCK_KINDS.map((b) => b.id)).size,
    BLOCK_KINDS.length,
    "a duplicated block kind would render twice in the picker",
  );
}

// ── The reserved list is a list of real routes ────────────────────────────
{
  assert.ok(RESERVED_SLUGS.includes("website"), "the desk's own path");
  assert.ok(RESERVED_SLUGS.includes("api"), "every API route lives under this");
  assert.equal(
    new Set(RESERVED_SLUGS).size,
    RESERVED_SLUGS.length,
    "duplicates mean the list was edited by hand without checking",
  );
  for (const slug of RESERVED_SLUGS) {
    if (slug.includes(".")) continue; // sitemap.xml, robots.txt
    assert.equal(
      normalizeSlug(slug),
      slug,
      `${slug} is not in the form a typed address normalises to, so it ` +
        "would never match and would not protect the route",
    );
  }
}

// ── Hindi is a different address, not a different page ───────────────────
{
  // The whole point of the language column: the twins may share a slug.
  assert.equal(publicPathFor("about", "en"), "/about");
  assert.equal(publicPathFor("about", "hi"), "/hi/about");
  assert.equal(publicPathFor("", "en"), "/");
  assert.equal(publicPathFor("", "hi"), "/hi");

  // English defaults, so every existing call site keeps its meaning.
  assert.equal(publicPathFor("about"), publicPathFor("about", "en"));

  // A reserved route can only shadow a page that sits at the root. Behind
  // /hi nothing of ours answers, so `fees` is a legal Hindi address — and
  // refusing it there would be a bug the office could not explain.
  assert.ok(slugProblem("fees", { lang: "en" }), "fees must be refused at root");
  assert.equal(
    slugProblem("fees", { lang: "hi" }),
    null,
    "/hi/fees collides with nothing, so it must be allowed",
  );

  assert.equal(
    LANGUAGES.find((l) => l.id === "en")?.pathPrefix,
    "",
    "English must stay at the root — printed links depend on it",
  );
}

// ── Alt text: the checks that stop a useless description passing ─────────
{
  assert.ok(altProblem(""), "empty alt must be refused");
  assert.ok(altProblem("  "), "whitespace is not a description");
  assert.ok(altProblem("x"), "too short to describe anything");

  // The case that matters. A filename passes a naive "is it non-empty"
  // check while telling a screen-reader user nothing at all.
  assert.ok(
    altProblem("IMG_2049", "IMG_2049.JPG"),
    "the file name is not a description",
  );
  assert.ok(altProblem("DSC 1123"), "a camera name is not a description");

  // The defect this guard actually had in production: it compared against
  // the generated STORAGE KEY (site/2026-08-30-a1b2c3.png), which can never
  // equal anything a person types, so it passed everything. The original
  // name is now kept on the row precisely so this comparison can work.
  assert.ok(
    altProblem("prize day 2026", "prize day 2026.jpg"),
    "the name the file arrived with is not a description",
  );

  // And loosely, because nobody retypes punctuation the same way.
  for (const typed of ["prize-day", "prize_day", "Prize Day", "prize  day"]) {
    assert.ok(
      altProblem(typed, "prize-day.png"),
      `"${typed}" is the file name in another costume`,
    );
  }

  // The guard must not become so eager it refuses a real description that
  // merely begins with the same words.
  assert.equal(
    altProblem("Prize day 2026 — the head girl receiving her award", "prize-day.png"),
    null,
    "a real sentence must survive, even sharing words with the file name",
  );

  assert.equal(
    altProblem("Class VI pupils planting saplings on the school field"),
    null,
    "a real description must pass",
  );
}

// ── Consent, under blanket admission terms ───────────────────────────────
{
  // The director chose blanket consent, so a pupil photograph is normally
  // 'granted'. What must survive that decision is the family override: a
  // withdrawal has to block the picture everywhere, or the school has no
  // way to honour an objection.
  assert.equal(mayPublishMedia({ consentStatus: "granted" }), true);
  assert.equal(mayPublishMedia({ consentStatus: "not_required" }), true);
  assert.equal(
    mayPublishMedia({ consentStatus: "withdrawn" }),
    false,
    "a family objection must block publication",
  );
  assert.equal(
    mayPublishMedia({ consentStatus: "pending" }),
    false,
    "undecided is not consent",
  );

  // Every status the database allows must be answerable by the desk, or a
  // row would render with no label.
  for (const c of CONSENT_STATUSES) {
    assert.ok(c.label && c.blurb, `${c.id} needs a label the office reads`);
  }
  const dbStatuses: ConsentStatus[] = [
    "not_required",
    "pending",
    "granted",
    "withdrawn",
  ];
  assert.equal(
    CONSENT_STATUSES.length,
    dbStatuses.length,
    "the desk's list and the CHECK constraint have drifted apart",
  );
}

// ── An image needs BOTH consent and a description to reach a page ────────
{
  const ok = mediaReadyForPage({
    consentStatus: "granted",
    alt: "The school building seen from the gate",
    mime: "image/jpeg",
  });
  assert.equal(ok.ready, true);

  const noAlt = mediaReadyForPage({
    consentStatus: "granted",
    alt: "",
    mime: "image/jpeg",
  });
  assert.equal(noAlt.ready, false, "consent alone is not enough");
  assert.ok(noAlt.reason, "the office must be told which of the two is missing");

  const objected = mediaReadyForPage({
    consentStatus: "withdrawn",
    alt: "A perfectly good description",
    mime: "image/jpeg",
  });
  assert.equal(objected.ready, false, "a description cannot override consent");

  // A PDF prospectus has nothing to describe visually; requiring alt text
  // there would block a legitimate download for no accessibility gain.
  const pdf = mediaReadyForPage({
    consentStatus: "not_required",
    alt: "",
    mime: "application/pdf",
  });
  assert.equal(pdf.ready, true, "alt text is an image rule, not a file rule");
}

// ── A client can never mint its own media revision ───────────────────────
{
  const row = mediaToRow({ alt: "x", consentStatus: "granted" });
  assert.ok(!("updated_at" in row), "the server stamps the revision, not us");
  assert.ok(!("id" in row), "the id is the op's business, not the row's");

  // The guard is only as good as the column that feeds it: if the original
  // name stops being written, the alt-text check quietly dies again.
  const named = mediaToRow({ originalFilename: "prize-day.png" });
  assert.equal(named.original_filename, "prize-day.png");
}

// ── Only blocks that store their own content are buildable yet ──────────
{
  // The split is not arbitrary: a block marked `live` reads from another
  // desk, and wiring those is Phase 4. If the two lists ever disagree, the
  // editor offers a block the renderer cannot draw.
  for (const k of BLOCK_KINDS) {
    assert.equal(
      isBuildableKind(k.id),
      !k.live,
      `${k.id}: BLOCK_SHAPES and the live flag disagree`,
    );
  }
}

// ── YouTube addresses, in the forms people actually paste ───────────────
{
  const id = "dQw4w9WgXcQ";
  for (const form of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `youtube.com/watch?v=${id}`,
  ]) {
    assert.equal(youtubeId(form), id, `did not recognise: ${form}`);
  }

  // Refusing is the point. A wrong id renders a grey box with no error —
  // a failure nobody reports because nothing looks broken.
  for (const bad of [
    "",
    "   ",
    "https://vimeo.com/123456",
    "https://www.youtube.com/watch?v=tooshort",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "not a url at all",
  ]) {
    assert.equal(youtubeId(bad), null, `should have refused: ${bad}`);
  }
}

// ── Plain text to paragraphs and bullets, never HTML ────────────────────
{
  const nodes = parseProse(
    "The school was founded in 1998.\n\nWe teach:\n- Nursery to Class VIII\n- State recognised\n\nVisit us.",
  );
  assert.deepEqual(nodes, [
    { type: "p", text: "The school was founded in 1998." },
    { type: "p", text: "We teach:" },
    { type: "ul", items: ["Nursery to Class VIII", "State recognised"] },
    { type: "p", text: "Visit us." },
  ]);

  // A trailing bullet run must still be emitted — the flush at the end is
  // easy to forget and silently drops the last list on the page.
  const trailing = parseProse("Facilities:\n- Library\n- Science lab");
  assert.equal(trailing.length, 2);
  assert.deepEqual((trailing[1] as { items: string[] }).items, [
    "Library",
    "Science lab",
  ]);

  assert.deepEqual(parseProse(""), [], "empty text makes no nodes");

  // Markup is content, not markup. It must survive as literal text rather
  // than becoming an element.
  const html = parseProse("<script>alert(1)</script>");
  assert.deepEqual(html, [{ type: "p", text: "<script>alert(1)</script>" }]);
}

// ── A block cannot reach the public half-filled ─────────────────────────
{
  assert.ok(blockProblem({ kind: "prose", payload: {} }), "empty prose");
  assert.equal(
    blockProblem({ kind: "prose", payload: { body: "Some words here" } }),
    null,
    "heading is optional, body is not",
  );

  assert.ok(
    blockProblem({ kind: "video", payload: { youtube: "https://vimeo.com/1" } }),
    "a non-YouTube link must be refused, not embedded",
  );

  // The list rules: at least one item, and no item half-filled.
  assert.ok(blockProblem({ kind: "stats", payload: { items: [] } }));
  assert.ok(
    blockProblem({ kind: "stats", payload: { items: [{ value: "480", label: "" }] } }),
    "a figure with no label says nothing",
  );
  assert.equal(
    blockProblem({ kind: "stats", payload: { items: [{ value: "480", label: "Pupils" }] } }),
    null,
  );

  // A live block has no shape yet and must say so rather than render blank.
  assert.ok(blockProblem({ kind: "feed", payload: {} }));
}

// ── A new block starts with every field present ─────────────────────────
{
  // An undefined reaching a controlled input turns it uncontrolled, and
  // React then warns and loses the first keystroke.
  for (const kind of Object.keys(BLOCK_SHAPES) as (keyof typeof BLOCK_SHAPES)[]) {
    const shape = BLOCK_SHAPES[kind];
    if (!shape) continue;
    const payload = emptyPayload(kind);
    for (const f of shape.fields) {
      assert.equal(typeof payload[f.key], "string", `${kind}.${f.key}`);
    }
    if (shape.list) {
      const items = payload[shape.list.key] as Record<string, unknown>[];
      assert.equal(items.length, 1, `${kind} should start with one row`);
      for (const f of shape.list.fields) {
        assert.equal(typeof items[0][f.key], "string", `${kind}.${f.key}`);
      }
    }
  }
}

console.log("website.selftest: all assertions passed");

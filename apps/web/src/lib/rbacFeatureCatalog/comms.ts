import { CRUD, type RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";

/**
 * Communications, website, events, WhatsApp and compliance — wired 6 Oct
 * 2026.
 *
 * Where each one is enforced:
 * - Notices / News / Gallery: school-comms-desk, news-desk and gallery-desk
 *   (slice merges). One Comms save goes to all three desks; each lifts only
 *   its own module's slices. The school-comms-desk carries news, albums and
 *   photos too, but those belong to the News and Gallery functions on their
 *   own desks, so no Notices function owns them there.
 * - Website: the generic data API (/api/data/<collection>), by route.
 * - Events: /api/school-data/events checks these functions per call (it is
 *   one event per request, not a desk).
 * - WA templates / WA automation: desk-slice/<desk>, slices "<desk>/<key>".
 * - WA chatbot / Compliance: module-state books, slices "module-state/<book>".
 * - Notifications, WA automation delivery, UDISE robot: by route.
 *
 * Deliberately NOT a function anywhere:
 * - automation/approvals and automation/runs are owned by the approve
 *   function, which holds no create/edit/delete — so a desk push never lifts
 *   a card. Approving goes through /api/wa/automation/approve, which is where
 *   the claim, quiet-hours, staleness and weekly-cap rules live; a card set
 *   to "approved" through the desk would be sent by the next tick with none
 *   of them.
 * - notifications-desk: one feed every module appends to, trimmed to 300 by
 *   whoever saves, with no owner on a row — a row merge cannot say "mark my
 *   own as read" without letting the holder rewrite everyone's.
 * - wa-threads-desk: written only by the server's bot store; no browser
 *   saves it.
 * - /api/wa/templates/refresh: besides reading Meta it runs the template
 *   autopilot, which submits and rewrites templates and sends messages held
 *   for one — the whole WA templates grant, not a slice of it.
 */
export const COMMS_FEATURES: RbacFeatureDef[] = [
  /* ── Notices (Comms → Notices) ── */
  {
    id: "notices.circulars",
    module: "notices",
    label: "Notices & circulars",
    blurb: "Write, publish, pin and remove the school's notices and circulars.",
    actions: CRUD,
    slices: ["notices"],
    tabs: ["notices"],
  },
  {
    id: "notices.social",
    module: "notices",
    label: "Social media cross-posting",
    // View only: connecting the accounts stays with the principal
    // (/api/integrations/social/credentials checks that itself).
    blurb: "See the Facebook / Instagram setup and what was cross-posted.",
    actions: ["view"],
    tabs: ["social"],
    routes: ["/api/integrations/social/config"],
  },

  /* ── News (Comms → News) ── */
  {
    id: "news.stories",
    module: "news",
    label: "News stories",
    blurb: "Write, publish and remove school news.",
    actions: CRUD,
    slices: ["news"],
    tabs: ["news"],
  },

  /* ── Gallery (Comms → Gallery) ── */
  {
    // One function, not albums and photos apart: the first photo of an album
    // becomes its cover, so uploading a photo also changes the album.
    id: "gallery.albums",
    module: "gallery",
    label: "Albums & photos",
    blurb: "Make albums, upload photos, publish or remove them.",
    actions: CRUD,
    slices: ["albums", "photos"],
    tabs: ["gallery"],
  },

  /* ── Website (/website) ── */
  {
    id: "website.pages",
    module: "website",
    label: "Pages",
    blurb: "Make and edit pages, their blocks and the menu — as drafts.",
    actions: CRUD,
    tabs: ["pages"],
    routes: ["/api/data/site.pages", "/api/data/site.blocks", "/api/data/site.menu"],
  },
  {
    id: "website.media",
    module: "website",
    label: "Pictures & files",
    blurb: "Upload, caption and remove the website's pictures and files.",
    actions: CRUD,
    tabs: ["media"],
    routes: ["/api/data/site.media"],
  },
  {
    // Publishing a page is the decision (data/registry.ts: site.pages
    // approval). The approver must also open the page to judge it, so this
    // reaches the pages, their blocks and pictures as well.
    id: "website.publish",
    module: "website",
    label: "Publish to the website",
    blurb: "Approve pages for the public site, and choose which notices, news and albums it shows.",
    actions: ["view", "edit", "approve"],
    tabs: ["pages", "publish"],
    routes: [
      "/api/data/site.pages",
      "/api/data/site.blocks",
      "/api/data/site.media",
      "/api/data/site.publications",
    ],
  },

  /* ── Events (/events) ── */
  {
    id: "events.calendar",
    module: "events",
    label: "Events & calendar",
    blurb: "Add, change and remove school events on the calendar.",
    actions: CRUD,
    tabs: ["calendar", "events"],
  },
  {
    id: "events.rsvp",
    module: "events",
    label: "RSVP invitations",
    blurb: "Send an event's RSVP question to families on WhatsApp and read the replies.",
    actions: ["view", "edit"],
    tabs: ["rsvps"],
  },
  {
    id: "events.interschool",
    module: "events",
    label: "Inter-school events",
    blurb: "Inter-school competitions: entries, fees, results and certificates.",
    actions: CRUD,
    tabs: ["interschool"],
    routes: ["/api/events/interschool"],
  },

  /* ── Notifications (Comms → WhatsApp → Send / Office relay) ── */
  {
    id: "notifications.wa_send",
    module: "notifications",
    label: "Send WhatsApp messages",
    blurb: "Send an approved template to staff, a class, a fee stage or picked families.",
    actions: ["view", "edit"],
    tabs: ["whatsapp", "send"],
    routes: ["/api/wa/send"],
  },
  {
    id: "notifications.office_relay",
    module: "notifications",
    label: "Office relay",
    blurb: "Which office phone gets each kind of question the bot cannot answer, and the relay log.",
    actions: ["view", "edit"],
    tabs: ["whatsapp", "relay"],
    routes: ["/api/wa/relay"],
  },

  /* ── WA templates (Masters → WhatsApp templates) ── */
  {
    // The audit trail travels with the templates, so an edit made through
    // this function is recorded like any other.
    id: "wa_templates.author",
    module: "wa_templates",
    label: "Write & edit templates",
    blurb: "The WhatsApp template registry: wording, variables, languages.",
    actions: CRUD,
    slices: ["wa_templates/templates", "wa_templates/audit"],
    tabs: ["wa-templates"],
  },

  /* ── WA automation (Masters → Automation; Comms → WhatsApp) ── */
  {
    // Includes "Run now": a run raises cards and sends what is already
    // approved — and a rule set to send without approval sends at once.
    id: "wa_automation.rules",
    module: "wa_automation",
    label: "Automation rules",
    blurb: "Build, schedule, switch on and run the automatic WhatsApp rules.",
    actions: CRUD,
    slices: ["automation/rules"],
    tabs: ["automation"],
    routes: ["/api/wa/automation/run"],
  },
  {
    id: "wa_automation.approve",
    module: "wa_automation",
    label: "Approve & send cards",
    blurb: "Approve, reject or snooze the cards automation raises — approving sends them.",
    actions: ["view", "approve"],
    slices: ["automation/approvals", "automation/runs"],
    tabs: ["automation"],
    routes: ["/api/wa/automation/approve"],
  },
  {
    id: "wa_automation.delivery",
    module: "wa_automation",
    label: "Delivery & numbers to fix",
    blurb: "What was delivered, read or failed, and the numbers that cannot get WhatsApp.",
    actions: ["view", "edit"],
    tabs: ["whatsapp", "delivered", "numbers"],
    routes: ["/api/wa/sent-messages", "/api/wa/number-health", "/api/wa/roster-check"],
  },
  {
    id: "wa_automation.cost",
    module: "wa_automation",
    label: "Usage & cost",
    blurb: "What WhatsApp costs, and the rates it is worked out at.",
    actions: ["view", "edit"],
    tabs: ["whatsapp", "cost"],
    routes: ["/api/wa/usage"],
  },

  /* ── WA chatbot (Masters → WhatsApp chatbot) ── */
  {
    id: "wa_chatbot.flows",
    module: "wa_chatbot",
    label: "Chatbot flows",
    blurb: "The WhatsApp chatbot's menus and flows.",
    actions: ["view", "edit"],
    slices: ["module-state/wa_chatbot_flows"],
    tabs: ["wa-chatbot"],
  },

  /* ── Compliance (Students → UDISE+) ── */
  {
    id: "compliance.udise_tracking",
    module: "compliance",
    label: "UDISE+ readiness",
    blurb: "UDISE+ tracking settings and follow-ups.",
    actions: ["view", "edit"],
    slices: ["module-state/udise_compliance"],
    tabs: ["udise"],
  },
  {
    id: "compliance.facts",
    module: "compliance",
    label: "Compliance facts",
    blurb: "The school's recognition, affiliation and registration facts.",
    actions: ["view", "edit"],
    slices: ["module-state/compliance_facts"],
    tabs: ["udise"],
  },
  {
    id: "compliance.udise_robot",
    module: "compliance",
    label: "UDISE robot",
    blurb: "Let the Office Robot extension sync, fill and add children on the UDISE+ portal.",
    actions: ["view", "edit"],
    tabs: ["udise"],
    routes: ["/api/v1/udise/robot"],
  },
];

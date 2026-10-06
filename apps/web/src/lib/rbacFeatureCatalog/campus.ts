import { CRUD, type RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";

/**
 * Campus — discipline, health, visitors, complaints (6 Oct 2026).
 *
 * Each of these modules keeps its register in one module-state book
 * (lib/moduleStateRegistry), and that book is read and saved whole by
 * /api/school-data/module-state/[module]. So a book has exactly one owning
 * function: splitting "log a visit" from "medication register" would let
 * two people each save the whole book, and the second save would carry the
 * first person's copy of the other half. The route's own rules still apply
 * to a function holder — a teacher gets their classes only and may not
 * push discipline / health / complaints whole.
 *
 * Hostel and Sports have no screen (ComingSoonPage) and no store yet, so
 * they define nothing.
 *
 * "/api/wa/dispatch" is listed where the screen's "Notify parent" sends
 * through it under this module: holding the function's edit is what
 * holding the module's edit allowed there before, and the route still
 * limits a class teacher to their own classes' families.
 */
export const CAMPUS_FEATURES: RbacFeatureDef[] = [
  {
    id: "discipline.register",
    module: "discipline",
    label: "Incident register",
    blurb: "Record incidents and points, set escalation, tell parents. Approve lets you escalate past a warning.",
    actions: [...CRUD, "approve"],
    slices: ["module-state/discipline"],
    tabs: ["log", "all", "student"],
    routes: ["/api/wa/dispatch"],
  },
  {
    id: "health.infirmary",
    module: "health",
    label: "Sick room & health records",
    blurb: "Sick-room visits, the medication register and vaccinations, and telling parents.",
    actions: CRUD,
    slices: ["module-state/health"],
    tabs: ["log", "visits", "medications", "vaccinations", "student"],
    routes: ["/api/wa/dispatch"],
  },
  {
    id: "visitors.register",
    module: "visitors",
    label: "Gate register & gate passes",
    blurb: "Check visitors in and out, log early-pickup gate passes, approve them and hand children over.",
    actions: CRUD,
    slices: ["module-state/visitors"],
    // Not "gateduty": it reads the staff duty roster, which this function
    // does not open — the tab would say "nobody on duty" when it simply
    // could not read the roster.
    tabs: ["register", "gatepasses", "gateqr"],
    routes: ["/api/wa/dispatch"],
  },
  {
    id: "visitors.gate_qr",
    module: "visitors",
    label: "Gate QR display",
    blurb: "Show the visitor self-check-in QR on a reception screen. Nothing else.",
    actions: ["view"],
    // The QR comes from the public visitor route; no register is read.
    tabs: ["gateqr"],
  },
  {
    id: "complaints.desk",
    module: "complaints",
    label: "Complaints desk",
    blurb: "Every complaint ticket, including WhatsApp ones: assign, change status, resolve, delete.",
    actions: CRUD,
    slices: ["module-state/complaints"],
    tabs: ["all", "mine"],
    routes: ["/api/wa/complaints"],
  },
  {
    id: "complaints.ai_reports",
    module: "complaints",
    label: "AI content reports",
    blurb: "Tutor replies a parent flagged: read them and mark reviewed or dismissed.",
    actions: ["view", "edit"],
    tabs: ["ai"],
  },
];

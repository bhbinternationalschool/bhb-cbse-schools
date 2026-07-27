# Minimal real-data checklist (BHB)

Use this when moving from demo smoke to **limited live masters + students**.  
This app is dual-mode (browser localStorage + Supabase when configured). Treat production as go-live only after fee publish and a backup habit.

**Live app:** https://bhbinternational.school  
**Infra notes:** [GO_LIVE_INFRA.md](./GO_LIVE_INFRA.md)

---

## Before you type real names

- [ ] Confirm you are on the correct school / academic year (Masters → Academic year).
- [ ] **Students → Live start · Import** — clear any leftover demo roster, download CSV template.
- [ ] Keep a browser export or screenshot of Masters after each major change (or export SIS if available).
- [ ] Prefer **Inactivate** over Delete for masters you may need later.

---

## Order of entry (do not skip)

### 0. Wipe demo (first visit after live build)

- [ ] Open **Students** — if demo names (Rahul, Ananya…) appear, click **Clear all students**.
- [ ] Store / Transport start empty (add catalog and routes when needed).

### 1. Masters skeleton

- [ ] Academic year active and labeled correctly.
- [ ] Classes I–XII (or your offered set) with sections.
- [ ] Subjects / subject groups as needed for exams.
- [ ] Houses / categories only if you use them on forms.
- [ ] Fee heads + fee groups defined.
- [ ] Installment calendar (Apr–Mar or your pattern) applied for the AY.
- [ ] UDISE / school identity fields filled if you report them (smoke gap: often empty).

### 2. Publish fees

- [ ] Fee structure lines for each class / group with amounts in paise/₹ as the UI expects.
- [ ] Late-fee / concession rules only after structure lines exist.
- [ ] **Publish / activate** fee structure for the current AY (smoke gap: structure not published → Take fees may show empty dues for new students).
- [ ] Spot-check Fee Take for one class: household dues appear for a test student.

### 3. Students (CSV import or limited cohort)

- [ ] **Download CSV template** from Students → Import (same columns as full register export).
- [ ] For each old session file: set **Only rows from CSV session** if multi-year, then **Force into 2025-26** with type **Promoted / continuing**.
- [ ] Class / Section names in CSV must match Masters (Nursery, I, VI…).
- [ ] Spot-check Fee Take for one imported student after fee publish.
- [ ] Or start with **one class + one section** via + Add student if not importing yet.

### 4. Curriculum carts (NCF tags)

- [ ] Enroll subjects via shopping-cart flow for the pilot class (tags A/B/C/D as applicable).
- [ ] Verify IX–X / XI–XII rules if those classes are in the pilot.
- [ ] Open Exams → select class → section → term; marks grid should list enrolled subjects.

### 5. Exams smoke (after cart)

- [ ] Class dropdown lists active classes (not only “Select class”).
- [ ] Enter a few marks, save, open report preview for one student.
- [ ] Fee hold behavior matches policy if report cards are gated on dues.

---

## What “limited live” means

| Ready now | Wait |
|-----------|------|
| Real masters + pilot students | Sole system of record for all fees |
| Curriculum carts for pilot class | Full WhatsApp fee campaigns |
| Marks entry for pilot | Deleting demo data without a backup |
| Office templates / certificates draft | Hardened auth (rotate leaked secrets; turn off demo auth) |

---

## Stop and fix if

- Exams class dropdown stays empty after Masters has classes → hard refresh; confirm Masters classes are Active.
- Fee Take shows no dues for a new student → fee structure not published or wrong fee group.
- Students vanish after another device/browser → Supabase sync / hydrate; check `sis_*` tables and env keys on Cloud Run.

---

## After the pilot looks good

1. Expand class by class (not all at once).
2. Turn off `NEXT_PUBLIC_DEMO_AUTH` only when real Supabase Auth + redirect URLs are verified.
3. Rotate any secrets that lived in old ERP build configs before calling the stack hardened production.

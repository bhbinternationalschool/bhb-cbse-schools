# BHB Office Robot (Chrome extension)

Works beside the UDISE+ Student module (sdms.udiseplus.gov.in). **Every move starts with a person's click.**
A person always signs in to the portal (captcha/OTP) and always presses the portal's own **Save**.
There are no timers and no background work.

## What staff see

After signing in to UDISE+, a panel at the bottom right says how many children still have an incomplete profile.

| Button | What it does |
|---|---|
| **Start robot** | Sends the portal's current-year list to ERP → Students → UDISE+ (review and **Apply** there). Then it opens the first incomplete child's form (GP/EP/FP) and fills the **empty** fields from the ERP, outlined in yellow. |
| **Saved — next child ▶** | After you have checked the form and pressed the portal's Save, this opens and fills the next child. |
| **Skip this child** / **Stop robot** | Moves past a child / clears the queue. |
| **Add missing children to UDISE+** | On the School Dashboard: the ERP children with no PEN **and a valid Aadhaar** (UDISE+ makes Aadhaar mandatory to add a student, rule 4.1.7), only in classes whose **Add Student** button the portal is showing (on 6 Oct 2026: Nursery–Class I). It skips anyone already on the portal by name + birth date or name + father. Before each child it **searches all of UDISE+** (the portal's Global Student Search): by name + Aadhaar last 4 if the ERP has the Aadhaar, and by name + date of birth + father + mother. It only counts hits that agree on the name and on birth date or a parent. If the child is already in our school, it says apply the portal list in the ERP. If the child is at another school, it shows that school, its UDISE code and the PEN, and says to bring the child in by transfer. If there are only near-matches, it lists them and offers "Not the same child — add anyway". If the search fails, it never assumes "not found". Only a child found nowhere gets a fresh Add Student form. It is opened with that class's own dashboard button, because the form takes its class from the button, not the address. The robot checks the form's class header before typing. You check, handle any "similar student" warning, and press Save. **Saved — next child** moves on. |
| **Only send portal list to ERP** | Just the send, no forms. |
| **Fill this form from ERP** | Fills whichever child's form is open, outside the queue. |

Safety rules built in:
- A child is found by **PEN**, and the robot refuses if the portal and ERP first names differ.
- It fills **empty** fields only and never overwrites what is on the portal. Date boxes that do not keep the typed date are cleared and listed for you.
- On 6 Oct 2026 the portal allowed **only the General Profile (GP) to be saved**; EP/FP values the robot types may not save until the portal opens them.
- It types only values the ERP really holds, and lists the rest for you to type.
- Aadhaar stays masked.

## Install

- **From the Chrome Web Store (unlisted link):** click the link the office was given, then **Add to Chrome**.
- **Developer install:** `chrome://extensions` → Developer mode → **Load unpacked** → this folder.

Then sign in to the ERP (https://bhbinternational.school) in the same Chrome profile. Your role needs **Compliance / UDISE · edit**.
Click the robot icon in the toolbar: it should say "✓ ERP login: …".

Works in desktop Chrome, Edge or Brave. Not on phones. The ERP and the portal must be open in the same browser profile.

## Publishing

See `STORE_LISTING.md`. Privacy policy: https://bhbinternational.school/privacy/office-robot (`apps/web/src/app/privacy/office-robot/page.tsx`).

### On the APAAR Module (Students module → APAAR Module)

| Button | What it does |
|---|---|
| **Start APAAR queue** | Asks the ERP which children are ready: the family said yes on WhatsApp, the consenting parent's own Aadhaar is on file, the portal has verified the child's Aadhaar, and there is no APAAR ID yet. Opens each child's **Generate APAAR ID** page and fills who gave consent, the relation (father/mother only), the parent's Aadhaar as identity proof, and the place. It also says how many children wait for Aadhaar verification or for the family. |
| **Submitted — next child ▶** / **Skip** / **Stop** | After you have checked the page and pressed the portal's Submit. |
| **Fill this APAAR page from ERP** | Fills whichever child's Generate page is open. |

The portal requires the school to keep a **printed copy of the consent**. Print the ERP's consent record for each child before you submit.

### On the Teacher module (teacher.udiseplus.gov.in)

| Button | What it does |
|---|---|
| **Check teachers against the ERP** | On the staff list: who matches an ERP staff member (by National Code, else name + date of birth), whose National Code is missing in the ERP (Staff → OASIS / UDISE id), where dates or qualifications disagree, and which ERP teachers the portal does not list. |
| **Fill this step from ERP** | On a teacher's GP or AT step: fills the empty fields from ERP Staff (gender, social category, qualifications, mobile, email, appointment, joining date, post, classes and subjects taught this year). The Training (TD) step is not in the ERP. |
| **Fetch all teachers from portal** | On the staff list: reads the teaching AND non-teaching lists and every teacher's GP / AT / TD forms (three requests at a time) and sends a whitelisted copy to the ERP. Review and apply in the ERP: Students → UDISE+ → **Teachers: portal vs ERP** (missing-in-ERP ticked, disagreements unticked; nothing changes until Apply). |
| **Add missing teachers** | After a check: walks the ERP teaching staff the portal does not list, one at a time — opens Add New Staff, can choose Teaching and press Go, then **Fill new teacher from ERP** fills the empty General Profile boxes. You press the portal's Save, then **Saved — next teacher**. Aadhaar is filled only when the ERP holds a valid 12-digit number. |

Aadhaar never leaves the portal tab (staff mobile and email do go to the ERP on a fetch). The robot never presses Save, Next or Submit.

## ERP side

- `POST /api/v1/udise/robot/sync` → `apps/web/src/lib/udiseRobotSync.server.ts`; mapping in `lib/udisePortalApi.ts`
- `GET /api/v1/udise/robot/fill?pen=` → `lib/udisePortalFill.ts`
- `POST /api/v1/udise/robot/teachers`, `GET /api/v1/udise/robot/teacher-fill`, `GET /api/v1/udise/robot/teacher-add?staffId=` → `lib/udiseTeacherFill.ts`
- `POST|GET /api/v1/udise/robot/teacher-details`, `POST /api/v1/udise/robot/teacher-details/apply` → `lib/udiseTeacherSync.ts` (+ `.server.ts`); `TEACHER_FORM_FIELDS` in `background.js` must match `PORTAL_FORM_FIELDS` there.
- `POST /api/v1/udise/robot/apaar-queue`, `GET /api/v1/udise/robot/apaar-fill` → `lib/udiseApaarFill.ts`
- The field whitelist in `background.js` must match `UDISE_PORTAL_FIELDS` in `lib/udisePortalApi.ts`.

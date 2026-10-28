import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/public/LegalPage";
import { CONTACT, TRADING_NAME } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "BHB Office Robot — privacy",
  description:
    "What the BHB Office Robot Chrome extension reads on government portals, where it sends it, and what it never does.",
};

/**
 * Privacy policy for the staff-only Chrome extension (extensions/office-robot),
 * linked from its Chrome Web Store listing. Static, public, no auth.
 */
export default function OfficeRobotPrivacyPage() {
  return (
    <LegalPage
      title="BHB Office Robot — privacy"
      updated="7 October 2026"
      current="/privacy/office-robot"
      summary={
        <p>
          The BHB Office Robot is a tool for {TRADING_NAME} staff. It moves the
          school&rsquo;s own records between government portals (today, the
          UDISE+ Student, Teacher and School Profile modules) and the school&rsquo;s ERP, in the staff member&rsquo;s own
          browser, only when they click. It sends nothing anywhere else, has no
          analytics, and does nothing in the background.
        </p>
      }
    >
      <LegalSection n={1} title="Who uses it">
        <p>
          Only school staff who are signed in to UDISE+ (the Student module at
          sdms.udiseplus.gov.in, the Teacher module at teacher.udiseplus.gov.in
          and the School Profile module at profile.udiseplus.gov.in) or to the
          school&rsquo;s Propel / LEAD Nucleus portal (nucleus.leadgroup.co.in)
          or to Pinnacle Smart Teach (teacher.pinnaclelearning.in),
          and to the school ERP (bhbinternational.school) in the same browser,
          with UDISE permission in the ERP. It is of no use to anyone else.
        </p>
      </LegalSection>

      <LegalSection n={2} title="What it reads on UDISE+">
        <LegalList>
          <li>
            On UDISE+ pages, the school&rsquo;s current-year student list that
            the portal itself shows the signed-in staff member: names, class,
            date of birth, parents&rsquo; names, contact details, PEN and APAAR
            ID, and the portal&rsquo;s Aadhaar status. The portal shows Aadhaar
            masked to the last four digits, and the robot keeps it that way.
          </li>
          <li>
            When a staff member presses &ldquo;Fetch all children&rsquo;s details
            to ERP&rdquo;: each of the school&rsquo;s children&rsquo;s own UDISE+
            profile (the same details, plus category, religion group, mother
            tongue, blood group, disability, height, weight and facilities) and,
            from a form the staff member has just saved, its admission and
            previous-year details. Never an Aadhaar number.
          </li>
          <li>
            On a UDISE+ list page (student release requests, the Dropbox), when
            a staff member presses &ldquo;Check the children on this page&rdquo;:
            the PEN, name and date of birth shown in that list.
          </li>
          <li>
            On the UDISE+ School Profile module, when a staff member presses
            &ldquo;Send this section to ERP&rdquo;: the school&rsquo;s own answers in
            that section (buildings, facilities, contact, receipts and
            expenditure). School-level details only, no child&rsquo;s data.
          </li>
          <li>
            On the UDISE+ Teacher module (teacher.udiseplus.gov.in), when a
            staff member presses &ldquo;Fetch all teachers from portal&rdquo;:
            the school&rsquo;s teaching and non-teaching staff list and each
            one&rsquo;s profile, appointment and training answers &mdash; name,
            gender, date of birth, category, qualifications, staff mobile and
            email, National Code, appointment and joining dates, post, classes
            and subjects taught. Never the Aadhaar number or the name as per
            Aadhaar.
          </li>
          <li>
            From the school ERP, for the one teacher whose Teacher-module form
            is open (or who is being added): the details needed to fill that
            form. A teacher&rsquo;s Aadhaar is typed only into the Add New Staff
            form, only when the ERP holds a valid number.
          </li>
          <li>
            From the school ERP, for the one child whose UDISE+ form is open:
            the details needed to fill that form (address, contact, category,
            blood group, admission and roll number, height, weight, parents&rsquo;
            education).
          </li>
          <li>
            From the school ERP, for a child the ERP has no PEN for, when a
            staff member presses &ldquo;Find PENs&rdquo;: the child&rsquo;s name, date
            of birth, parents&rsquo; names and the last four digits of the
            Aadhaar, which the robot types into UDISE+&rsquo;s own Global Student
            Search to find the child&rsquo;s PEN.
          </li>
          <li>
            On Propel / LEAD Nucleus, when a staff member presses a Check button:
            the school&rsquo;s academic calendar (holidays and events), Propel&rsquo;s
            subject list, the school&rsquo;s Propel staff accounts (name, mobile
            &mdash; the Propel login &mdash; role and status), Propel&rsquo;s blank
            student upload sheet, and Propel&rsquo;s list of question papers with
            the chapters each covers, and Propel&rsquo;s Teacher Timeliness (each
            teacher&rsquo;s day plans done against the course schedule, per class and
            subject). Propel holds no children&rsquo;s marks for the robot to read.
          </li>
          <li>
            On Pinnacle Smart Teach, when a staff member presses its button: the
            titles of the books in the Book Library, each book&rsquo;s table of
            contents (its chapter names) and the titles and types of each
            chapter&rsquo;s teaching assets (e.g. &ldquo;Animation: Early Calculating
            Devices&rdquo;). No personal data, and no files are downloaded.
          </li>
          <li>
            From the school ERP, for Propel: the school&rsquo;s published student
            holidays, the exam date sheet, active teaching staff (name, mobile,
            email, designation) and, for the student upload sheet, each current
            child&rsquo;s admission number, admission date, name, gender, class,
            section, address and parents&rsquo; names and mobiles.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={3} title="Where it sends it">
        <LegalList>
          <li>The UDISE+ student list goes only to the school&rsquo;s ERP, to be checked and applied by staff.</li>
          <li>The UDISE+ teacher details go only to the school&rsquo;s ERP, where staff review them and apply only what they tick.</li>
          <li>Each child&rsquo;s UDISE+ profile, the PEN search results and the School Profile answers go only to the school&rsquo;s ERP, where staff review them; nothing changes in the ERP until they apply it.</li>
          <li>A child&rsquo;s search details go only to UDISE+&rsquo;s own student search, in the staff member&rsquo;s signed-in portal session.</li>
          <li>ERP details go only into the UDISE+ form open on the staff member&rsquo;s screen.</li>
          <li>
            Propel&rsquo;s calendar, staff list, question papers and teachers&rsquo; course progress go only to the
            school&rsquo;s ERP. The ERP&rsquo;s holidays, exams and new teachers go only to the school&rsquo;s own
            Propel account, in the staff member&rsquo;s signed-in session, and only after they confirm the list
            on screen.
          </li>
          <li>
            Pinnacle&rsquo;s book titles, chapter names and asset titles go only to the school&rsquo;s ERP, which
            compares the chapters with its own book list and shows teachers the asset titles with a link back to
            Smart Teach. Nothing is sent to Smart Teach.
          </li>
          <li>
            The filled student upload sheet is saved to the staff member&rsquo;s own computer; they upload it to
            Propel themselves.
          </li>
          <li>Nothing is sent to the extension&rsquo;s developer, to Google, or to any third party.</li>
        </LegalList>
      </LegalSection>

      <LegalSection n={4} title="What it never does">
        <LegalList>
          <li>It never signs in to UDISE+, Propel or the ERP, and never stores a password. Staff sign in themselves.</li>
          <li>
            It never presses Save or Submit on the portal. A person checks every form and saves it. With
            &ldquo;One-click&rdquo; on, after the person&rsquo;s own Save the robot only closes the portal&rsquo;s
            message, presses Next to move to the form&rsquo;s next step, and opens the next child&rsquo;s form.
          </li>
          <li>It never approves, rejects, releases, imports or deletes anything on the UDISE+ portal.</li>
          <li>
            On Propel it adds only calendar entries and teacher logins the ERP shows are missing, after a person
            confirms them. It never edits, deactivates or deletes anything already on Propel, and never uploads
            the student sheet itself.
          </li>
          <li>It runs no timers and no background work. It acts only when a person clicks.</li>
          <li>It has no tracking, analytics or advertising.</li>
        </LegalList>
      </LegalSection>

      <LegalSection n={5} title="What it keeps in the browser">
        <p>
          The time of the last send to the ERP, and while a staff member is
          working through forms, the list of children still to do (name, class,
          PEN and the portal&rsquo;s internal ids). Pressing &ldquo;Stop
          robot&rdquo; clears the list. Whether &ldquo;One-click&rdquo; is on. On the
          school ERP only, it marks the page with the robot&rsquo;s version so the
          ERP can show that it is installed; it reads nothing there. While teachers are being added, the
          names and ERP ids of those still to add, in that tab only, until
          &ldquo;Stop adding&rdquo; or the tab closes. Removing the extension
          removes everything.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Other portals">
        <p>
          The robot works only on the portals named on this page. When another
          portal is added, this page will name it and say what is read there
          before the new version is released.
        </p>
      </LegalSection>

      <LegalSection n={7} title="The rest of our data practices">
        <p>
          Student records in the ERP are covered by the school&rsquo;s main{" "}
          <Link href="/privacy" className="text-blue-700 underline">
            privacy policy
          </Link>
          . Questions go to{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

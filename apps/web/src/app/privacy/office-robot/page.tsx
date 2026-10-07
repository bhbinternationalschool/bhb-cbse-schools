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
          UDISE+ Student module) and the school&rsquo;s ERP, in the staff member&rsquo;s own
          browser, only when they click. It sends nothing anywhere else, has no
          analytics, and does nothing in the background.
        </p>
      }
    >
      <LegalSection n={1} title="Who uses it">
        <p>
          Only school staff who are signed in to both the UDISE+ Student module
          (sdms.udiseplus.gov.in) and the school ERP (bhbinternational.school)
          in the same browser, with UDISE permission in the ERP. It is of no use
          to anyone else.
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
        </LegalList>
      </LegalSection>

      <LegalSection n={3} title="Where it sends it">
        <LegalList>
          <li>The UDISE+ student list goes only to the school&rsquo;s ERP, to be checked and applied by staff.</li>
          <li>The UDISE+ teacher details go only to the school&rsquo;s ERP, where staff review them and apply only what they tick.</li>
          <li>ERP details go only into the UDISE+ form open on the staff member&rsquo;s screen.</li>
          <li>Nothing is sent to the extension&rsquo;s developer, to Google, or to any third party.</li>
        </LegalList>
      </LegalSection>

      <LegalSection n={4} title="What it never does">
        <LegalList>
          <li>It never signs in to UDISE+ or the ERP, and never stores a password. Staff sign in themselves.</li>
          <li>It never presses Save or submits anything on the portal. A person checks every form and saves it.</li>
          <li>It runs no timers and no background work. It acts only when a person clicks.</li>
          <li>It has no tracking, analytics or advertising.</li>
        </LegalList>
      </LegalSection>

      <LegalSection n={5} title="What it keeps in the browser">
        <p>
          The time of the last send to the ERP, and while a staff member is
          working through forms, the list of children still to do (name, class,
          PEN and the portal&rsquo;s internal ids). Pressing &ldquo;Stop
          robot&rdquo; clears the list. While teachers are being added, the
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

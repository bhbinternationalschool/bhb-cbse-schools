import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/public/LegalPage";
import { CONTACT, TRADING_NAME } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Account & data deletion",
  description:
    "How a parent or staff member asks BHB International School to delete their app account and the data held against it, what is deleted, and what the school must keep by law.",
};

/**
 * Google Play requires every app that has sign-in to publish a URL where a
 * user can request deletion of the account and its data — reachable without
 * signing in, and without installing the app. This is that URL. It is quoted
 * verbatim in the Play Console listing under "Data deletion", so do not
 * change the path without updating the listing.
 *
 * The honest position for a school ERP is that deletion is partial: a fee
 * receipt and its ledger entry are statutory records the school cannot erase
 * on request, and a child's academic record belongs to the child's file. This
 * page says exactly which parts go and which parts stay, because a reviewer
 * who finds a blanket "we delete everything" promise next to a retention
 * clause in the privacy policy will reject the submission for contradicting
 * itself. Static content, no auth, no client JS.
 */
export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Account & data deletion"
      updated="6 September 2026"
      current="/data-deletion"
      summary={
        <p>
          Write to{" "}
          <a
            className="font-medium text-slate-900 underline underline-offset-4"
            href={`mailto:${CONTACT.email}?subject=Delete%20my%20app%20account`}
          >
            {CONTACT.email}
          </a>{" "}
          from the email or with the mobile number registered with the school,
          and we will delete your app account and everything that exists only to
          run the app. Accounting records and the student&rsquo;s academic file
          are kept for the periods Indian law sets, and are then destroyed. We
          act on requests within 30 days.
        </p>
      }
    >
      <LegalSection n={1} title="Who can ask">
        <p>
          The parent or guardian named on the child&rsquo;s admission record,
          and any staff member with a {TRADING_NAME} app account. We answer only
          to the mobile number or email already registered with the school
          office, because that is the only way we can tell that the request
          comes from the family and not from someone else.
        </p>
      </LegalSection>

      <LegalSection n={2} title="How to ask">
        <LegalList>
          <li>
            <strong>By email.</strong> Send &ldquo;Delete my app account&rdquo;
            to{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href={`mailto:${CONTACT.email}?subject=Delete%20my%20app%20account`}
            >
              {CONTACT.email}
            </a>{" "}
            with the child&rsquo;s name and admission number.
          </li>
          <li>
            <strong>By phone or in person.</strong> Call the school office on{" "}
            {CONTACT.phone} during office hours, or ask at the office. The
            address and hours are on the{" "}
            <Link
              className="font-medium text-slate-900 underline underline-offset-4"
              href="/contact"
            >
              contact page
            </Link>
            .
          </li>
        </LegalList>
        <p>
          You do not need the app installed, and you do not need to be signed in
          to make the request.
        </p>
      </LegalSection>

      <LegalSection n={3} title="What is deleted">
        <LegalList>
          <li>
            The app account itself: the sign-in identity, the session tokens on
            every device, and the push-notification token that lets us send
            alerts to your phone.
          </li>
          <li>
            Messages you sent to teachers through the app, leave applications,
            complaints, and any document or photograph you uploaded from the
            app.
          </li>
          <li>
            Your saved app preferences and the cached copy of school data the
            app keeps on your phone. Uninstalling the app removes that copy
            immediately, without waiting for us.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={4} title="What the school has to keep, and for how long">
        <p>
          A school cannot erase its books of account or a child&rsquo;s academic
          file on request. These are kept whether or not you use the app:
        </p>
        <LegalList>
          <li>
            <strong>Fee receipts, ledger entries and payment references</strong>{" "}
            — eight financial years, as required of the trust&rsquo;s books of
            account under Indian tax law.
          </li>
          <li>
            <strong>The student&rsquo;s academic record</strong> — admission
            particulars, attendance, marks and transfer certificate — for as long
            as the state education department requires them to be produced on
            demand.
          </li>
        </LegalList>
        <p>
          Nothing in that set is used to contact you once the account is gone,
          and none of it is shared for advertising. It is destroyed at the end
          of its retention period.
        </p>
      </LegalSection>

      <LegalSection n={5} title="What happens after we act">
        <LegalCallout>
          Deleting the account ends app access for that family. Fee dues are not
          cancelled by it, notices stop reaching you on the phone, and payments
          then have to be made at the school office. The account can be created
          again at any time by asking the office.
        </LegalCallout>
        <p>
          We confirm in writing to the same email or number once the deletion is
          done. If we cannot delete something you asked about, we say which item
          and under which rule we are holding it, rather than leaving the
          request half-answered.
        </p>
      </LegalSection>

      <LegalSection n={6} title="Related policies">
        <p>
          What we collect and why is set out in the{" "}
          <Link
            className="font-medium text-slate-900 underline underline-offset-4"
            href="/privacy"
          >
            privacy policy
          </Link>
          . Refunds of fees already paid are dealt with separately in the{" "}
          <Link
            className="font-medium text-slate-900 underline underline-offset-4"
            href="/refund-policy"
          >
            cancellation and refund policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

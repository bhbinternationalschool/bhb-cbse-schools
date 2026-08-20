import type { Metadata } from "next";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Privacy Policy — BHB International School",
  description:
    "How the BHB International School app and portal handle student, parent and staff data.",
};

/**
 * Public privacy policy — linked from the Play Store / App Store listings
 * and the app's sign-in screen. Static content, no auth.
 */
export default function PrivacyPolicyPage() {
  return (
    <PublicChrome>
    <main className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-7 text-slate-800">
      <h1 className="text-2xl font-bold text-slate-900">
        Privacy Policy — BHB International School App
      </h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: 13 August 2026</p>

      <p className="mt-6">
        The {TRADING_NAME} mobile app and web portal
        (bhbinternational.school) are operated by {displayLegalName()},{" "}
        {ADDRESS_ONE_LINE} (&ldquo;the School&rdquo;). This policy explains
        what data the app handles and why. It applies to parents, guardians,
        students and staff who use the app.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">
        What data the app uses
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-6">
        <li>
          <strong>School records.</strong> Student name, class, roll and
          admission number, attendance, homework, fee dues and receipts,
          notices and parent-teacher meeting bookings — records the School
          already maintains as part of providing education. The app displays
          them to the child&rsquo;s own verified guardian and to authorised
          staff only.
        </li>
        <li>
          <strong>Parent mobile number.</strong> Used once per sign-in to send
          a one-time password over WhatsApp and to link you to your
          family&rsquo;s records. We do not use it for marketing.
        </li>
        <li>
          <strong>Staff location (staff app only, optional).</strong> When a
          staff member chooses to punch attendance from the app, their
          location is read once, at the moment of punching, to confirm they
          are on campus. The punch stores the coordinates, GPS accuracy and
          distance from school as an audit record. Location is never read in
          the background or tracked continuously.
        </li>
        <li>
          <strong>Device data.</strong> The app stores a signed sign-in token
          on your device so you stay logged in. It contains no password. We do
          not use advertising identifiers, analytics trackers or third-party
          ads.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">
        Where data lives and who sees it
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-6">
        <li>
          Data is stored in the School&rsquo;s own management system, hosted
          on Google Cloud and Supabase, encrypted in transit (HTTPS) and at
          rest.
        </li>
        <li>
          WhatsApp messages (OTPs, absence alerts, fee reminders) are
          delivered through Meta&rsquo;s WhatsApp Business API to the number
          you registered with the School.
        </li>
        <li>
          We never sell data, and we never share it with third parties except
          the processors above, or where Indian law requires.
        </li>
        <li>
          Parents see only their own children. Staff access is role-based and
          audited.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">
        Children&rsquo;s data
      </h2>
      <p className="mt-3">
        The app is used by parents, guardians and staff — not by children
        directly. Student records shown in the app are school records under
        the School&rsquo;s custodianship, processed for legitimate educational
        purposes.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">
        Your choices and rights
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-6">
        <li>
          You can sign out at any time; this removes the sign-in token from
          your device.
        </li>
        <li>
          To correct your family&rsquo;s records, update your registered
          mobile number, or ask what data the School holds, contact the school
          office.
        </li>
        <li>
          Accounts are provisioned by the School against enrolment; when a
          student leaves, portal access for that family ends. Retention of the
          underlying school records follows the School&rsquo;s record-keeping
          obligations.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Contact</h2>
      <p className="mt-3">
        {displayLegalName()}, {ADDRESS_ONE_LINE}.
        <br />
        Email:{" "}
        <a
          className="text-blue-700 underline"
          href="mailto:director@bhbinternational.school"
        >
          director@bhbinternational.school
        </a>
      </p>

      <p className="mt-8 text-sm text-slate-500">
        We will update this page if our practices change; material changes
        will also be announced in the app&rsquo;s Notices section.
      </p>
    </main>
    </PublicChrome>
  );
}

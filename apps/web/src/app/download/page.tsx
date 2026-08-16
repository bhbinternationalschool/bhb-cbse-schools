import type { Metadata } from "next";
import Image from "next/image";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Download the App — BHB International School",
  description:
    "Install the BHB International School app — for parents, teachers, principal/office staff and transport drivers.",
};

// Served from a dedicated public GCS bucket, not the app's own public/
// directory — Cloud Run's front end refuses to buffer a response over
// roughly 32MB ("Response size was too large"), and this APK is 54MB.
// A same-origin /downloads/... route 500'd in production even though it
// worked in local dev, where that ceiling doesn't exist. GCS has no such
// limit. The bucket (school-erp-prod-493619-public-downloads) is
// dedicated to this — not the shared "assets" bucket — so granting public
// read here doesn't expose anything else.
const APK_URL =
  "https://storage.googleapis.com/school-erp-prod-493619-public-downloads/bhb-school-app.apk";

/**
 * Public test-distribution page — pre-store-launch. Linked directly (not
 * from the office nav) and shared by hand with parents/staff/drivers so
 * everyone can install the real, production-connected app before we decide
 * on Play Store / App Store submission. No auth required to view.
 */
export default function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center px-6 py-14 text-center">
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={72}
        height={76}
        priority
        className="object-contain"
        aria-hidden
      />
      <h1 className="mt-4 text-2xl font-bold text-slate-900">
        BHB International School
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Install the school app — fees, attendance, homework, notices and
        more, for parents, staff and transport drivers.
      </p>

      <div className="mt-8 w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-center gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            Android
          </span>
          <span className="text-xs text-slate-400">Ready to install</span>
        </div>
        <a
          href={APK_URL}
          className="block w-full rounded-xl bg-[var(--brand-deep)] px-4 py-3.5 text-center text-sm font-semibold text-white hover:opacity-90"
        >
          Download for Android
        </a>
        <p className="mt-3 text-left text-xs leading-relaxed text-slate-500">
          After downloading, open the file. Android will warn about
          &ldquo;installing from unknown sources&rdquo; — this is normal for
          an app installed outside the Play Store; tap{" "}
          <strong>Settings</strong> → allow this source →{" "}
          <strong>Install</strong>. When you open the app, sign in with the
          mobile number registered with the school (parents) or your school
          email (staff) — a real one-time code or password is required, same
          as the office portal.
        </p>
      </div>

      <div className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-6 text-left">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
            iPhone
          </span>
          <span className="text-xs text-slate-400">Not available yet</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          Apple requires a paid Apple Developer account before any test build
          can be installed on a real iPhone — there is no way around this,
          even for internal testing. The iPhone version is fully built and
          waiting; it will appear here as soon as that account is set up.
        </p>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        BHB International School · Test build, not the public store release
      </p>
    </main>
  );
}

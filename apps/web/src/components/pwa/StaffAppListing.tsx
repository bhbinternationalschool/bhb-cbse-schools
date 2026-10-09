"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { pwaManifestHref } from "@/lib/pwaApps";
import { installPlatform, type InstallPlatform } from "@/lib/installPlatform";
import { TENANT } from "@/lib/types";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Parents install from Google Play, where the app is published (approved
// by 3 Oct 2026) and updates itself. The bucket's parent APK was a 9 Sep
// test build: no OTP fix, no in-app checkout, and — signed with the upload
// key, not Play's — it can never take a Play update (director, 9 Oct 2026).
// BHB Staff on Play is in INTERNAL TESTING (director, 9 Oct 2026): only the
// staff Gmail addresses on the tester list can join. The first tap opens
// "Become a tester", then Play installs and updates the app.
const STAFF_PLAY_TEST_URL = "https://play.google.com/apps/internaltest/4701007545375064542";
const PARENT_PLAY_URL = "https://play.google.com/store/apps/details?id=school.bhbinternational.parent";
// The driver app is not on Play: an APK in a public bucket (Cloud Run cannot
// serve a 60 MB response).
const BUCKET = "https://storage.googleapis.com/school-erp-prod-493619-public-downloads";
const DRIVER_APK_URL = `${BUCKET}/bhb-school-app.apk`;

const PLAY_GREEN = "#01875f";

// Store-listing colours, fixed in both themes (a light island, like the
// visitor kiosk): set once here and read as var(--pl-*) below.
const LISTING_PALETTE = {
  background: "#ffffff",
  color: "#202124",
  colorScheme: "light",
  "--pl-ink": "#202124",
  "--pl-muted": "#5f6368",
  "--pl-line": "#dadce0",
  "--pl-note": "#fef7e0",
  "--pl-step": "#e8f0fe",
  "--pl-step-ink": "#1a73e8",
} as CSSProperties;

const FEATURES: { icon: string; en: string; hi: string }[] = [
  { icon: "🕘", en: "Attendance punch (office QR)", hi: "हाज़िरी — QR पंच" },
  { icon: "📚", en: "Homework & class diary", hi: "होमवर्क व डायरी" },
  { icon: "🧑‍🎓", en: "Class lists & student attendance", hi: "कक्षा सूची व छात्र हाज़िरी" },
  { icon: "📝", en: "Marks, results & exams", hi: "अंक, परिणाम व परीक्षा" },
  { icon: "💰", en: "Fees counter (office)", hi: "फीस काउंटर (ऑफ़िस)" },
  { icon: "🔔", en: "Notices & notifications", hi: "सूचनाएँ" },
];

/** Share icon as iPhone Safari draws it — the thing staff must find. */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="inline-block align-[-3px]">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="#007aff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="#007aff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StaffAppListing() {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = installPlatform(navigator.userAgent, {
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    // Opened from the home-screen icon (iPhone keeps the page it was added
    // from): go straight into the app.
    if (p === "standalone") {
      window.location.replace("/home");
      return;
    }
    setPlatform(p);

    // The page's manifest must be the STAFF app's, so Chrome installs that.
    const href = pwaManifestHref("staff");
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js?app=staff", { scope: "/" }).catch(() => null);
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      if (choice.outcome === "accepted") setInstalled(true);
      return;
    }
    if (platform === "ios-safari") setIosSheet(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${TENANT.domain}/downloads`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const chromeIntent = `intent://${TENANT.domain}/downloads#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    // A fixed light page, like a store listing: the ERP's dark theme would
    // otherwise darken the background under these fixed text colours.
    <main className="min-h-screen" style={LISTING_PALETTE}>
      <div className="mx-auto max-w-xl px-4 pb-16 pt-6 sm:pt-10">
        {/* ── Listing header, Play Store style ─────────────────────── */}
        <header className="flex items-start gap-4">
          <Image
            src="/icon-512.png"
            alt=""
            width={80}
            height={80}
            priority
            className="h-20 w-20 shrink-0 rounded-[22%] shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-medium leading-tight">BHB Staff</h1>
            <p className="mt-0.5 text-sm font-medium" style={{ color: PLAY_GREEN }}>
              {TENANT.name}
            </p>
            <p className="mt-0.5 text-xs text-[var(--pl-muted)]">Teachers · Office · Principal</p>
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-3 divide-x divide-[var(--pl-line)] text-center">
          <div className="px-2">
            <dt className="text-sm font-medium">Free</dt>
            <dd className="text-[11px] text-[var(--pl-muted)]">no ads</dd>
          </div>
          <div className="px-2">
            <dt className="text-sm font-medium">हिंदी · English</dt>
            <dd className="text-[11px] text-[var(--pl-muted)]">language</dd>
          </div>
          <div className="px-2">
            <dt className="text-sm font-medium">&lt; 1 MB</dt>
            <dd className="text-[11px] text-[var(--pl-muted)]">updates itself</dd>
          </div>
        </dl>

        {/* ── Android: the Play app first (staff testers) ─────────────── */}
        {platform === "android" || platform === "android-inapp" ? (
          <div className="mt-6">
            <a
              href={STAFF_PLAY_TEST_URL}
              className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white"
              style={{ background: PLAY_GREEN }}
            >
              Get BHB Staff on Google Play
            </a>
            <p className="mt-2 text-xs leading-relaxed text-[var(--pl-muted)]">
              For staff whose Gmail is on the school&rsquo;s tester list: tap, choose <strong>Become a tester</strong>,
              then <strong>Install</strong>. Play keeps it updated. Use the same Gmail that is signed in to Play Store.
              <br />
              जिन स्टाफ़ की Gmail सूची में है: दबाएँ → <strong>Become a tester</strong> → <strong>Install</strong>।
            </p>
            <p className="mt-4 text-xs font-medium text-[var(--pl-muted)]">
              Not on the list, or no Gmail? Install the website app instead:
            </p>
          </div>
        ) : null}

        {/* ── The one button ───────────────────────────────────────── */}
        <div className={platform === "android" || platform === "android-inapp" ? "mt-2" : "mt-6"}>
          {installed ? (
            <div className="rounded-lg border border-[var(--pl-line)] p-4 text-sm">
              <p className="font-medium" style={{ color: PLAY_GREEN }}>
                ✓ Installed
              </p>
              <p className="mt-1 text-[var(--pl-muted)]">
                Open <strong>BHB Staff</strong> from your home screen and sign in with your registered mobile.
                <br />
                होम स्क्रीन पर <strong>BHB Staff</strong> खोलें और अपने मोबाइल नंबर से लॉग-इन करें।
              </p>
            </div>
          ) : platform === "android-inapp" ? (
            <>
              <a
                href={chromeIntent}
                className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white"
                style={{ background: PLAY_GREEN }}
              >
                Open in Chrome to install
              </a>
              <p className="mt-2 text-xs text-[var(--pl-muted)]">
                This link opened inside WhatsApp. Chrome installs the app. / यह लिंक WhatsApp के अंदर खुला है — इंस्टॉल
                करने के लिए Chrome में खोलें।
              </p>
            </>
          ) : platform === "ios-other" ? (
            <>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white"
                style={{ background: PLAY_GREEN }}
              >
                {copied ? "Link copied — paste it in Safari" : "Copy link, then open Safari"}
              </button>
              <p className="mt-2 text-xs text-[var(--pl-muted)]">
                On iPhone the app is added from <strong>Safari</strong>. Open Safari, paste the link, then tap Install.
                <br />
                iPhone पर ऐप Safari से जुड़ता है — लिंक Safari में खोलें।
              </p>
            </>
          ) : platform === "android" && !prompt ? (
            <>
              <button
                type="button"
                disabled
                className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white opacity-90"
                style={{ background: PLAY_GREEN }}
              >
                Install from Chrome’s menu
              </button>
              <p className="mt-2 text-xs text-[var(--pl-muted)]">
                Tap Chrome’s <strong>⋮</strong> menu → <strong>Install app</strong> (or <strong>Add to Home screen</strong>
                ). Already installed? Open <strong>BHB Staff</strong> from your home screen.
                <br />
                Chrome मेन्यू ⋮ → <strong>Install app</strong> दबाएँ।
              </p>
            </>
          ) : platform === "desktop" ? (
            <>
              <button
                type="button"
                onClick={() => void install()}
                disabled={!prompt}
                className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white disabled:opacity-60"
                style={{ background: PLAY_GREEN }}
              >
                {prompt ? "Install on this computer" : "Open this page on your phone"}
              </button>
              <p className="mt-2 text-xs text-[var(--pl-muted)]">
                On a phone, open <strong>{TENANT.domain}/downloads</strong>.
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void install()}
              disabled={platform === null}
              className="block w-full rounded-lg py-3 text-center text-sm font-medium text-white disabled:opacity-60"
              style={{ background: PLAY_GREEN }}
            >
              Install
            </button>
          )}
        </div>

        {/* ── What's in it ─────────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-base font-medium">About this app</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--pl-muted)]">
            The school ERP for teachers and office staff — punch your attendance at the office QR, post homework, take
            class attendance, enter marks and run the fees counter. Same login as the website.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {FEATURES.map((f) => (
              <li key={f.en} className="flex items-start gap-2 rounded-lg border border-[var(--pl-line)] p-2.5 text-xs">
                <span aria-hidden className="text-base leading-none">
                  {f.icon}
                </span>
                <span>
                  <span className="block font-medium text-[var(--pl-ink)]">{f.en}</span>
                  <span className="block text-[var(--pl-muted)]">{f.hi}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-medium">Always the newest version</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--pl-muted)]">
            Nothing to update, ever. Each time you open BHB Staff it loads the latest version, so every phone is on the
            same one. / ऐप हर बार खुलने पर अपने-आप नया हो जाता है — अपडेट करने की ज़रूरत नहीं।
          </p>
        </section>

        <section className="mt-8 rounded-lg bg-[var(--pl-note)] p-4">
          <h2 className="text-sm font-medium">Have the old “BHB School” staff app (APK)?</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--pl-muted)]">
            <strong>Uninstall it first</strong> — hold its icon → <strong>App info</strong> → <strong>Uninstall</strong>{" "}
            — then get BHB Staff from Google Play above. The Play app cannot install over the old file (same app,
            different signature), and attendance cannot be punched from the old app.
            <br />
            पहले पुराना स्टाफ़ ऐप हटाएँ, फिर ऊपर Google Play से BHB Staff लें। <em>Bus drivers and attendants keep their app.</em>
          </p>
        </section>

        {/* ── Other apps ───────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-base font-medium">More from {TENANT.shortName}</h2>
          <ul className="mt-3 divide-y divide-[var(--pl-line)] rounded-lg border border-[var(--pl-line)]">
            <li className="flex items-center gap-3 p-3">
              <Image src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-[22%]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">BHB International School — parents</p>
                <p className="text-xs text-[var(--pl-muted)]">Fees, homework, attendance, notices · on Google Play</p>
              </div>
              <a
                href={PARENT_PLAY_URL}
                className="rounded-full border border-[var(--pl-line)] px-3 py-1.5 text-xs font-medium"
                style={{ color: PLAY_GREEN }}
              >
                Get it on Play
              </a>
            </li>
            <li className="flex items-center gap-3 p-3">
              <Image src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-[22%]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">BHB Transport</p>
                <p className="text-xs text-[var(--pl-muted)]">Bus drivers & attendants · routes, boarding, live bus · Android</p>
              </div>
              <a
                href={DRIVER_APK_URL}
                className="rounded-full border border-[var(--pl-line)] px-3 py-1.5 text-xs font-medium"
                style={{ color: PLAY_GREEN }}
              >
                Download
              </a>
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--pl-muted)]">
            Parents: install from Google Play — it updates itself. If you installed the parent app from a file earlier,
            uninstall that one first. Transport app: Android may warn about “unknown sources” — tap Settings → allow →
            Install.
          </p>
        </section>
      </div>

      {/* ── iPhone: the three taps, shown when Install is pressed ──────── */}
      {iosSheet ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-modal aria-label="Add to Home Screen">
          <div className="w-full rounded-t-2xl p-5 pb-8 shadow-xl" style={{ background: "#ffffff", color: "#202124" }}>
            <p className="text-base font-medium">Add BHB Staff to your Home Screen</p>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pl-step)] text-xs font-medium text-[var(--pl-step-ink)]">1</span>
                <span>
                  Tap <ShareGlyph /> <strong>Share</strong> at the bottom of Safari.
                  <span className="block text-xs text-[var(--pl-muted)]">नीचे Share बटन दबाएँ।</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pl-step)] text-xs font-medium text-[var(--pl-step-ink)]">2</span>
                <span>
                  Scroll down, tap <strong>Add to Home Screen</strong> ⊕.
                  <span className="block text-xs text-[var(--pl-muted)]">नीचे स्क्रॉल करके “Add to Home Screen” दबाएँ।</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pl-step)] text-xs font-medium text-[var(--pl-step-ink)]">3</span>
                <span>
                  Tap <strong>Add</strong>. Open <strong>BHB Staff</strong> from your Home Screen and sign in.
                  <span className="block text-xs text-[var(--pl-muted)]">“Add” दबाएँ, फिर होम स्क्रीन से ऐप खोलें।</span>
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setIosSheet(false)}
              className="mt-6 w-full rounded-lg border border-[var(--pl-line)] py-2.5 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

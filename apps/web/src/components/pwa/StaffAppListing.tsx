"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { pwaManifestHref } from "@/lib/pwaApps";
import { installPlatform, type InstallPlatform } from "@/lib/installPlatform";
import { TENANT } from "@/lib/types";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// The parent and driver apps are Android APKs in a public bucket (Cloud Run
// cannot serve a 60 MB response). See the old /download page's note.
const BUCKET = "https://storage.googleapis.com/school-erp-prod-493619-public-downloads";
const PARENT_APK_URL = `${BUCKET}/bhb-parent-app.apk`;
const DRIVER_APK_URL = `${BUCKET}/bhb-school-app.apk`;

const PLAY_GREEN = "#01875f";

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
    <main className="min-h-screen" style={{ background: "#ffffff", color: "#202124", colorScheme: "light" }}>
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
            <p className="mt-0.5 text-xs text-[#5f6368]">Teachers · Office · Principal</p>
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-3 divide-x divide-[#dadce0] text-center">
          <div className="px-2">
            <dt className="text-sm font-medium">Free</dt>
            <dd className="text-[11px] text-[#5f6368]">no ads</dd>
          </div>
          <div className="px-2">
            <dt className="text-sm font-medium">हिंदी · English</dt>
            <dd className="text-[11px] text-[#5f6368]">language</dd>
          </div>
          <div className="px-2">
            <dt className="text-sm font-medium">&lt; 1 MB</dt>
            <dd className="text-[11px] text-[#5f6368]">updates itself</dd>
          </div>
        </dl>

        {/* ── The one button ───────────────────────────────────────── */}
        <div className="mt-6">
          {installed ? (
            <div className="rounded-lg border border-[#dadce0] p-4 text-sm">
              <p className="font-medium" style={{ color: PLAY_GREEN }}>
                ✓ Installed
              </p>
              <p className="mt-1 text-[#5f6368]">
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
              <p className="mt-2 text-xs text-[#5f6368]">
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
              <p className="mt-2 text-xs text-[#5f6368]">
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
              <p className="mt-2 text-xs text-[#5f6368]">
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
              <p className="mt-2 text-xs text-[#5f6368]">
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
          <p className="mt-2 text-sm leading-relaxed text-[#5f6368]">
            The school ERP for teachers and office staff — punch your attendance at the office QR, post homework, take
            class attendance, enter marks and run the fees counter. Same login as the website.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {FEATURES.map((f) => (
              <li key={f.en} className="flex items-start gap-2 rounded-lg border border-[#dadce0] p-2.5 text-xs">
                <span aria-hidden className="text-base leading-none">
                  {f.icon}
                </span>
                <span>
                  <span className="block font-medium text-[#202124]">{f.en}</span>
                  <span className="block text-[#5f6368]">{f.hi}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-medium">Always the newest version</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#5f6368]">
            Nothing to update, ever. Each time you open BHB Staff it loads the latest version, so every phone is on the
            same one. / ऐप हर बार खुलने पर अपने-आप नया हो जाता है — अपडेट करने की ज़रूरत नहीं।
          </p>
        </section>

        <section className="mt-8 rounded-lg bg-[#fef7e0] p-4">
          <h2 className="text-sm font-medium">Have the old “BHB School” staff app (APK)?</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#5f6368]">
            Install BHB Staff above, then remove the old one: hold its icon → <strong>App info</strong> →{" "}
            <strong>Uninstall</strong>. Attendance cannot be punched from the old app.
            <br />
            पुराना स्टाफ़ ऐप हटा दें — उससे हाज़िरी नहीं लगती। <em>Bus drivers and attendants keep their app.</em>
          </p>
        </section>

        {/* ── Other apps ───────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-base font-medium">More from {TENANT.shortName}</h2>
          <ul className="mt-3 divide-y divide-[#dadce0] rounded-lg border border-[#dadce0]">
            <li className="flex items-center gap-3 p-3">
              <Image src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-[22%]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">BHB Parent</p>
                <p className="text-xs text-[#5f6368]">Fees, homework, attendance, notices · Android</p>
              </div>
              <a
                href={PARENT_APK_URL}
                className="rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium"
                style={{ color: PLAY_GREEN }}
              >
                Download
              </a>
            </li>
            <li className="flex items-center gap-3 p-3">
              <Image src="/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-[22%]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">BHB Transport</p>
                <p className="text-xs text-[#5f6368]">Bus drivers & attendants · routes, boarding, live bus · Android</p>
              </div>
              <a
                href={DRIVER_APK_URL}
                className="rounded-full border border-[#dadce0] px-3 py-1.5 text-xs font-medium"
                style={{ color: PLAY_GREEN }}
              >
                Download
              </a>
            </li>
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-[#5f6368]">
            Android may warn about “unknown sources” for these two — tap Settings → allow → Install.
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
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-xs font-medium text-[#1a73e8]">1</span>
                <span>
                  Tap <ShareGlyph /> <strong>Share</strong> at the bottom of Safari.
                  <span className="block text-xs text-[#5f6368]">नीचे Share बटन दबाएँ।</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-xs font-medium text-[#1a73e8]">2</span>
                <span>
                  Scroll down, tap <strong>Add to Home Screen</strong> ⊕.
                  <span className="block text-xs text-[#5f6368]">नीचे स्क्रॉल करके “Add to Home Screen” दबाएँ।</span>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-xs font-medium text-[#1a73e8]">3</span>
                <span>
                  Tap <strong>Add</strong>. Open <strong>BHB Staff</strong> from your Home Screen and sign in.
                  <span className="block text-xs text-[#5f6368]">“Add” दबाएँ, फिर होम स्क्रीन से ऐप खोलें।</span>
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setIosSheet(false)}
              className="mt-6 w-full rounded-lg border border-[#dadce0] py-2.5 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

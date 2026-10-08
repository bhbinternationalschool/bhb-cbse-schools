"use client";

import { useEffect, useState } from "react";

/** The Chrome Web Store listing (Unlisted: only people with the link find it). */
export const OFFICE_ROBOT_STORE_URL = "https://chromewebstore.google.com/detail/kajdmnaicmdapckbapocgjkbjmejiioh";
export const OFFICE_ROBOT_ID = "kajdmnaicmdapckbapocgjkbjmejiioh";
/** The newest version this ERP's robot features expect (extensions/office-robot/manifest.json). */
export const OFFICE_ROBOT_LATEST = "1.4.0";

function older(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}

/**
 * Students → UDISE+: is the BHB Office Robot in THIS browser? The robot marks
 * the ERP page with its version (extensions/office-robot/content-erp.js).
 * Chrome lets no website install an extension by itself, so: one Install
 * button (the store's "Add to Chrome"), or — for every office computer at
 * once — the Google Workspace force-install policy.
 */
export function OfficeRobotInstallCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    // The robot's script runs at page start; give it a moment on slow loads.
    const read = () => setVersion(document.documentElement.dataset.bhbOfficeRobot || "");
    read();
    const t = window.setTimeout(read, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const installed = !!version;
  const outdated = installed && older(version!, OFFICE_ROBOT_LATEST);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="BHB Office Robot install">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">BHB Office Robot in this Chrome</h3>
        {version === null ? null : installed ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${outdated ? "bg-[var(--warning-soft,#fff4e0)] text-[var(--warning,#a15c00)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>
            {outdated ? `Installed ${version} — update to ${OFFICE_ROBOT_LATEST}` : `Installed ✓ ${version}`}
          </span>
        ) : (
          <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--danger)]">Not installed</span>
        )}
      </div>
      {installed && !outdated ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]">Open UDISE+ in this Chrome — the robot&apos;s panel appears at the bottom right.</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {outdated
              ? "Chrome updates extensions by itself within a few hours. To update now: open chrome://extensions, switch on Developer mode, press Update."
              : "Click Install, then “Add to Chrome” and “Add extension”. Then pin it from the puzzle-piece icon and sign in to the ERP in the same Chrome."}
          </p>
          {!installed ? (
            <a
              href={OFFICE_ROBOT_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-accent mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold"
            >
              Install BHB Office Robot
            </a>
          ) : null}
        </>
      )}
      <button type="button" className="mt-2 block text-[11px] font-semibold text-[var(--brand-deep)] underline" onClick={() => setAdmin((x) => !x)}>
        {admin ? "Hide" : "Install on every office computer automatically (Google Workspace admin)"}
      </button>
      {admin ? (
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[11px] text-[var(--muted)]">
          <li>Office staff use Chrome signed in with their @bhbinternational.school account.</li>
          <li>
            A Workspace admin opens admin.google.com → Devices → Chrome → Apps &amp; extensions → Users &amp; browsers, and picks the
            staff group.
          </li>
          <li>
            “+” → Add Chrome app or extension by ID → <code className="select-all">{OFFICE_ROBOT_ID}</code> → From the Chrome Web Store → Save.
          </li>
          <li>Set its installation policy to “Force install”. Chrome installs it — and keeps it updated — on every such computer.</li>
        </ol>
      ) : null}
    </section>
  );
}

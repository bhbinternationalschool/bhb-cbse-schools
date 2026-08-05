"use client";

import { useState } from "react";

export function TransportMapsApiHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[rgba(2,132,199,0.25)] bg-[rgba(2,132,199,0.06)] p-3 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left font-semibold text-[#0369a1]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>How to enable Google Maps road distance</span>
        <span className="text-xs">{open ? "Hide" : "Show steps"}</span>
      </button>
      {open ? (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-[var(--ink)]">
          <li>
            Open{" "}
            <a
              href="https://console.cloud.google.com/google/maps-apis/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#0369a1] underline"
            >
              Google Cloud Console → Maps APIs
            </a>{" "}
            (same Google account you use for billing).
          </li>
          <li>
            Create or select a project (e.g. <strong>bhb-school-erp</strong>).
          </li>
          <li>
            Enable billing on the project (Google gives ~$200/month free Maps
            credit — school distance checks use very little).
          </li>
          <li>
            Click <strong>Enable APIs</strong> and turn on{" "}
            <strong>Distance Matrix API</strong>,{" "}
            <strong>Geocoding API</strong>, and{" "}
            <strong>Places API</strong> (address search), and{" "}
            <strong>Maps JavaScript API</strong> (Transport → Live map).
          </li>
          <li>
            Go to <strong>APIs &amp; Services → Credentials → Create credentials
            → API key</strong>. Copy the key.
          </li>
          <li>
            Restrict the key (recommended): Application → HTTP referrers add{" "}
            <code className="rounded bg-white px-1">https://bhbinternational.school/*</code>{" "}
            and <code className="rounded bg-white px-1">http://localhost:3000/*</code>;
            API restriction → Distance Matrix, Geocoding, Places, Maps JavaScript.
          </li>
          <li>
            Give the API key to your school&apos;s IT team so they can add it to
            the server configuration for this ERP (development and production).
          </li>
          <li>
            After setup, use <strong>Pin homes on map</strong> in Transport
            Planner — road distances will show as &quot;(Google Maps)&quot;.
          </li>
        </ol>
      ) : null}
    </div>
  );
}

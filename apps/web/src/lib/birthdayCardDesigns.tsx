/**
 * Birthday card designs — JSX for next/og (satori). Satori supports a flex
 * subset of CSS: no grid, no CSS variables, explicit display:flex on every
 * parent with children, absolute positioning fine, <img> with https or data
 * URLs. Each design takes the same data and a size and lays itself out for
 * square / story / landscape / A5.
 */

import type { ReactElement } from "react";
import { BIRTHDAY_DESIGNS, BIRTHDAY_FORMATS, type BirthdayDesignId, type BirthdayFormatId } from "@/lib/birthdayCards";

export type BirthdayCardData = {
  studentName: string;
  className: string;
  dateLabel: string;
  schoolName: string;
  tagline: string;
  crestUrl: string;
  photoUrl: string;
  wish: string;
  /** Group card: names only, no photo */
  names?: string[];
};

const WISHES: Record<BirthdayDesignId, string> = {
  confetti: "Wishing you a day full of cake, laughter and surprises!",
  balloons: "May your year ahead rise as high as these balloons.",
  stars: "Shine bright — today and every day.",
  pastel: "A gentle, happy year ahead, full of new blooms.",
  classic: "With warm wishes from your teachers and friends.",
  minimal: "Have a great one.",
};

function palette(id: BirthdayDesignId) {
  return BIRTHDAY_DESIGNS.find((d) => d.id === id)!;
}

/** Deterministic pseudo-random points for confetti / stars (no Math.random → stable renders, cacheable). */
function points(n: number, seed: number): { x: number; y: number; r: number; k: number }[] {
  const out: { x: number; y: number; r: number; k: number }[] = [];
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < n; i++) out.push({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 0.8, k: Math.floor(rnd() * 4) });
  return out;
}

export function renderBirthdayCard(design: BirthdayDesignId, format: BirthdayFormatId, data: BirthdayCardData): ReactElement {
  const f = BIRTHDAY_FORMATS.find((x) => x.id === format)!;
  const p = palette(design);
  const W = f.width;
  const H = f.height;
  const tall = H > W * 1.2;
  const wide = W > H * 1.4;
  const base = Math.min(W, H);
  const photoSize = data.names?.length ? 0 : Math.round(base * (wide ? 0.42 : 0.36));
  const nameSize = Math.round(base * (data.studentName.length > 18 ? 0.07 : 0.09));
  const titleSize = Math.round(base * 0.055);
  const bodySize = Math.round(base * 0.032);
  const pad = Math.round(base * 0.06);
  const wish = data.wish || WISHES[design];
  const dark = design === "stars";
  const ink = p.ink;
  const sub = dark ? "#cbd5e1" : "#475569";

  const decorations: ReactElement[] = [];
  if (design === "confetti") {
    const colors = ["#ff6b6b", "#ffd166", "#06d6a0", "#4cc9f0", "#c77dff"];
    points(70, 7).forEach((pt, i) =>
      decorations.push(
        <div key={i} style={{ position: "absolute", left: pt.x * W, top: pt.y * H, width: 10 + pt.r * 18, height: 10 + pt.r * 10, background: colors[pt.k % colors.length], transform: `rotate(${pt.k * 37}deg)`, borderRadius: pt.k % 2 ? 999 : 2, opacity: 0.85 }} />,
      ),
    );
  }
  if (design === "stars") {
    points(90, 11).forEach((pt, i) =>
      decorations.push(<div key={i} style={{ position: "absolute", left: pt.x * W, top: pt.y * H, width: 3 + pt.r * 6, height: 3 + pt.r * 6, background: i % 7 === 0 ? "#fbbf24" : "#e2e8f0", borderRadius: 999, opacity: 0.5 + pt.r * 0.4 }} />),
    );
  }
  if (design === "balloons") {
    const cols = ["#60a5fa", "#f472b6", "#fbbf24", "#34d399", "#a78bfa"];
    points(9, 5).forEach((pt, i) => {
      const bw = Math.round(base * (0.08 + pt.r * 0.06));
      decorations.push(
        <div key={i} style={{ position: "absolute", left: pt.x * (W - bw), top: pt.y * (H * 0.55), width: bw, height: Math.round(bw * 1.2), background: cols[i % cols.length], borderRadius: "50% 50% 50% 50% / 45% 45% 55% 55%", opacity: 0.9, display: "flex" }} />,
      );
    });
  }
  if (design === "pastel") {
    const cols = ["#fbcfe8", "#bbf7d0", "#fde68a", "#ddd6fe"];
    points(14, 3).forEach((pt, i) =>
      decorations.push(<div key={i} style={{ position: "absolute", left: pt.x * W - 60, top: pt.y * H - 60, width: 90 + pt.r * 120, height: 90 + pt.r * 120, background: cols[i % cols.length], borderRadius: 999, opacity: 0.55 }} />),
    );
  }
  if (design === "classic") {
    decorations.push(<div key="top" style={{ position: "absolute", left: 0, top: 0, width: W, height: Math.round(base * 0.05), background: p.ink, display: "flex" }} />);
    decorations.push(<div key="bot" style={{ position: "absolute", left: 0, top: H - Math.round(base * 0.05), width: W, height: Math.round(base * 0.05), background: p.ink, display: "flex" }} />);
    decorations.push(<div key="gold" style={{ position: "absolute", left: pad, top: pad, width: W - pad * 2, height: H - pad * 2, border: `${Math.max(3, Math.round(base * 0.006))}px solid ${p.accent}`, borderRadius: 18, display: "flex" }} />);
  }
  if (design === "minimal") {
    decorations.push(<div key="bar" style={{ position: "absolute", left: 0, top: 0, width: Math.round(base * 0.04), height: H, background: p.accent, display: "flex" }} />);
  }

  const photo = data.names?.length ? null : data.photoUrl ? (
    <div style={{ display: "flex", width: photoSize, height: photoSize, borderRadius: 999, overflow: "hidden", border: `${Math.round(base * 0.012)}px solid ${p.accent}`, background: "#fff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data.photoUrl} alt="" width={photoSize} height={photoSize} style={{ width: photoSize, height: photoSize, objectFit: "cover" }} />
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: photoSize, height: photoSize, borderRadius: 999, border: `${Math.round(base * 0.012)}px solid ${p.accent}`, background: dark ? "#1e293b" : "#fff", color: p.accent, fontSize: Math.round(photoSize * 0.45), fontWeight: 700 }}>
      {(data.studentName || "?").trim().charAt(0).toUpperCase()}
    </div>
  );

  const crest = data.crestUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={data.crestUrl} alt="" width={Math.round(base * 0.11)} height={Math.round(base * 0.11)} style={{ width: Math.round(base * 0.11), height: Math.round(base * 0.11), objectFit: "contain" }} />
  ) : null;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(base * 0.02) }}>
      {crest}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: Math.round(base * 0.036), fontWeight: 700, color: ink, letterSpacing: 1 }}>{data.schoolName}</div>
        {data.tagline ? <div style={{ fontSize: Math.round(base * 0.024), color: sub }}>{data.tagline}</div> : null}
      </div>
    </div>
  );

  const title = <div style={{ fontSize: titleSize, fontWeight: 700, color: p.accent, letterSpacing: 2, textTransform: "uppercase" }}>Happy Birthday</div>;
  const name = data.names?.length ? (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {data.names.slice(0, 8).map((n, i) => (
        <div key={i} style={{ fontSize: Math.round(base * 0.05), fontWeight: 700, color: ink, textAlign: "center" }}>
          {n}
        </div>
      ))}
      {data.names.length > 8 ? <div style={{ fontSize: bodySize, color: sub }}>and {data.names.length - 8} more</div> : null}
    </div>
  ) : (
    <div style={{ fontSize: nameSize, fontWeight: 800, color: ink, textAlign: "center", lineHeight: 1.1 }}>{data.studentName}</div>
  );
  const meta = (
    <div style={{ fontSize: bodySize, color: sub, textAlign: "center" }}>
      {[data.className, data.dateLabel].filter(Boolean).join(" · ")}
    </div>
  );
  const wishEl = <div style={{ fontSize: bodySize, color: ink, textAlign: "center", maxWidth: Math.round(W * 0.8), lineHeight: 1.35 }}>{wish}</div>;

  const body = wide ? (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: pad, width: "100%", height: "100%", padding: pad }}>
      {photo}
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(base * 0.03), flex: 1 }}>
        {header}
        {title}
        {name}
        {meta}
        {wishEl}
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: tall ? "center" : "space-between", gap: Math.round(base * 0.035), width: "100%", height: "100%", padding: pad }}>
      {header}
      {title}
      {photo}
      {name}
      {meta}
      {wishEl}
    </div>
  );

  return (
    <div style={{ display: "flex", width: W, height: H, background: p.bg, position: "relative", fontFamily: "Noto Sans Devanagari, Noto Sans, sans-serif", overflow: "hidden" }}>
      {decorations}
      <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: W, height: H }}>{body}</div>
    </div>
  );
}

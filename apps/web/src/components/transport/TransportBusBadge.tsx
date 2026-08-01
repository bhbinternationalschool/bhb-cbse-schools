/** Colourful school-bus icon — always used instead of real vehicle photos. */

export function TransportBusBadge({
  busNo,
  routeCode,
  size = "md",
}: {
  busNo?: string;
  routeCode?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "lg"
      ? { w: 112, h: 80, text: "text-sm" }
      : size === "sm"
        ? { w: 72, h: 52, text: "text-[9px]" }
        : { w: 96, h: 68, text: "text-[10px]" };

  const label = busNo?.trim() || routeCode?.trim() || "BUS";

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl border-2 border-[#c5a028] shadow-[0_4px_14px_rgba(32,48,80,0.18)]"
      style={{ width: dim.w, height: dim.h }}
      aria-hidden
    >
      <svg
        viewBox="0 0 96 68"
        className="h-full w-full"
        role="img"
        aria-label="School bus"
      >
        <defs>
          <linearGradient id="busBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5d547" />
            <stop offset="55%" stopColor="#e8b923" />
            <stop offset="100%" stopColor="#c5a028" />
          </linearGradient>
          <linearGradient id="busRoof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#203050" />
            <stop offset="100%" stopColor="#2a4575" />
          </linearGradient>
        </defs>
        <rect width="96" height="68" fill="url(#busBody)" />
        <rect x="0" y="0" width="96" height="18" fill="url(#busRoof)" />
        <rect x="8" y="22" width="18" height="14" rx="2" fill="#e8f4fc" stroke="#203050" strokeWidth="1.2" />
        <rect x="30" y="22" width="18" height="14" rx="2" fill="#e8f4fc" stroke="#203050" strokeWidth="1.2" />
        <rect x="52" y="22" width="18" height="14" rx="2" fill="#e8f4fc" stroke="#203050" strokeWidth="1.2" />
        <rect x="74" y="22" width="14" height="20" rx="2" fill="#b8dff5" stroke="#203050" strokeWidth="1.2" />
        <rect x="4" y="44" width="88" height="6" rx="1" fill="#203050" opacity="0.85" />
        <circle cx="22" cy="56" r="7" fill="#203050" />
        <circle cx="22" cy="56" r="3.5" fill="#94a3b8" />
        <circle cx="74" cy="56" r="7" fill="#203050" />
        <circle cx="74" cy="56" r="3.5" fill="#94a3b8" />
        <rect x="6" y="8" width="28" height="5" rx="2" fill="#0f766e" />
        <text
          x="48"
          y="12"
          textAnchor="middle"
          fill="#f8f8f0"
          fontSize="7"
          fontWeight="800"
          fontFamily="system-ui, sans-serif"
        >
          SCHOOL
        </text>
      </svg>
      <div
        className={`absolute bottom-1 left-0 right-0 text-center font-extrabold uppercase tracking-wide text-[#203050] ${dim.text}`}
      >
        {label.length > 10 ? `${label.slice(0, 9)}…` : label}
      </div>
    </div>
  );
}

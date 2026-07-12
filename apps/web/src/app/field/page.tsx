import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = { title: "Field" };

export default async function FieldPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "field") redirect("/home");

  const icons = [
    { label: "Attendance", hi: "हाज़िरी" },
    { label: "Bus", hi: "बस" },
    { label: "Gate", hi: "गेट" },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-10">
      <Image
        src={TENANT.logoCrestUrl}
        alt=""
        width={72}
        height={75}
        className="logo-mark object-contain"
        priority
        aria-hidden
      />
      <p className="font-brand-name mt-3 text-sm text-[var(--brand-deep)]">
        {TENANT.nameDisplay}
      </p>
      <p className="font-tagline mt-1 text-sm">{TENANT.tagline}</p>
      <h1 className="mt-4 text-2xl font-semibold text-[var(--brand-deep)]">
        Simple mode
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {session.fullName} · big icons next
      </p>
      <div className="mt-8 grid grid-cols-2 gap-3">
        {icons.map((i) => (
          <div
            key={i.label}
            className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-[rgba(32,48,80,0.12)] bg-[var(--brand-cream)] text-center"
          >
            <span className="text-lg font-semibold text-[var(--brand-deep)]">
              {i.label}
            </span>
            <span className="mt-1 text-sm text-[var(--muted)]">{i.hi}</span>
          </div>
        ))}
      </div>
      <form
        className="mt-10"
        action={async () => {
          "use server";
          const { cookies } = await import("next/headers");
          const { demoSessionCookieName } = await import("@/lib/auth");
          const { redirect: r } = await import("next/navigation");
          (await cookies()).delete(demoSessionCookieName());
          r("/login");
        }}
      >
        <button
          type="submit"
          className="w-full rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-3 text-sm"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

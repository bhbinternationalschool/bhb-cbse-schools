"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ParentFeesPortal } from "@/components/parent/ParentFeesPortal";
import { ParentSubjectsPortal } from "@/components/parent/ParentSubjectsPortal";

type PortalTab = "fees" | "subjects";

export function ParentPortalClient({
  guardianName,
}: {
  guardianName: string;
}) {
  const router = useRouter();
  const [portalTab, setPortalTab] = useState<PortalTab>("fees");

  async function signOut() {
    await fetch("/api/auth/demo", { method: "DELETE" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  return (
    <div>
      <div className="sticky top-0 z-30 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(246,245,239,0.96)] px-4 pt-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg gap-1 rounded-lg bg-[rgba(32,48,80,0.06)] p-1">
          {(
            [
              ["fees", "Fees"],
              ["subjects", "Subjects"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPortalTab(id)}
              className={`flex-1 rounded-md py-2 text-xs font-bold ${
                portalTab === id
                  ? "bg-white text-[var(--brand-deep)] shadow-sm"
                  : "text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {portalTab === "fees" ? (
        <ParentFeesPortal
          guardianDisplayName={guardianName}
          onSignOut={() => {
            void signOut();
          }}
        />
      ) : (
        <div className="mx-auto min-h-screen max-w-lg pb-16">
          <div className="flex items-center justify-between px-4 pt-3">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              Subjects · {guardianName}
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
            >
              Sign out
            </button>
          </div>
          <ParentSubjectsPortal guardianDisplayName={guardianName} />
        </div>
      )}
    </div>
  );
}

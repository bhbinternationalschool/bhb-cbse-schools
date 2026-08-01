"use client";

import { PwaInstallBanner } from "./PwaInstallBanner";
import { fieldPwaInstallCopy } from "@/lib/pwaApps";

type Props = {
  persona?: string;
  roleCode?: string;
};

export function FieldPwaInstallBanner({ persona, roleCode }: Props) {
  const copy = fieldPwaInstallCopy(persona ?? "field", roleCode ?? "");
  return (
    <PwaInstallBanner
      appId="field"
      title={copy.title}
      subtitle={copy.subtitle}
      iosHint={copy.iosHint}
      className="pt-2"
    />
  );
}

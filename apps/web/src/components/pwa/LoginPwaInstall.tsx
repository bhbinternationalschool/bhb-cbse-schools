"use client";

import { PwaInstallBanner } from "./PwaInstallBanner";
import { loginPwaInstallCopy } from "@/lib/pwaApps";

export function LoginPwaInstall() {
  const copy = loginPwaInstallCopy();
  return (
    <PwaInstallBanner
      appId="login"
      title={copy.title}
      subtitle={copy.subtitle}
      iosHint={copy.iosHint}
      className="fixed bottom-4 left-0 right-0 z-30"
    />
  );
}

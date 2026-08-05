"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

export function LazyTabFallback() {
  return (
    <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
  );
}

/** Lazy-load a default export tab panel. */
export function lazyTabPanel<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
) {
  return dynamic(loader, { loading: () => <LazyTabFallback /> });
}

/** Lazy-load a named export as the default dynamic component. */
export function lazyNamedTabPanel<P extends object>(
  loader: () => Promise<Record<string, ComponentType<P>>>,
  exportName: string,
) {
  return dynamic(
    () =>
      loader().then((mod) => ({
        default: mod[exportName] as ComponentType<P>,
      })),
    { loading: () => <LazyTabFallback /> },
  );
}

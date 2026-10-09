/**
 * The shape of a module guide. Its own file so the guide lists
 * (erpAiPageGuidesA/B/C/D.ts) and the resolver (erpAiPageGuides.ts) can share
 * it without importing each other.
 */

import type { ErpAiLink } from "@/lib/erpAiChat";
import type { RbacModule } from "@/lib/rbac";

export type ErpAiPageGuide = {
  id: string;
  pageLabel: string;
  title: string;
  module: RbacModule;
  steps: string[];
  links?: ErpAiLink[];
  /** Shown on the proactive chip */
  chipLabel: string;
  /** "If you see X, do Y" — offered when the user seems stuck on this screen. */
  stuckTips?: string[];
};

/** A guide matched by path (and, optionally, one ?tab= of that path). */
export type ErpAiPageGuideDef = ErpAiPageGuide & {
  paths: string[];
  tab?: string;
};

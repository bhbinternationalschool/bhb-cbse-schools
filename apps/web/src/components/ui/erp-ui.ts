import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shadcn-styled text field — use on input, select, textarea */
export const erpField = cn(
  "flex h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs transition-colors outline-none",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const erpBtn = cn(
  buttonVariants({ variant: "default", size: "default" }),
  "h-9 gap-1.5 px-4 text-sm font-medium",
);

export const erpBtnOutline = cn(
  buttonVariants({ variant: "outline", size: "default" }),
  "h-9 gap-1.5 px-4 text-sm font-medium",
);

export const erpBtnDestructive = cn(
  buttonVariants({ variant: "destructive", size: "sm" }),
);

/** Drop-in aliases used across legacy workspaces */
export const field = erpField;
export const btn = erpBtn;
export const btnOutline = erpBtnOutline;

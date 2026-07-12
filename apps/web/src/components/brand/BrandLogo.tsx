import Image from "next/image";
import { TENANT } from "@/lib/types";

type BrandLogoProps = {
  size?: number;
  priority?: boolean;
  className?: string;
  highlight?: "sm" | "lg";
  /** Crest only — use with separate school name text on dark backgrounds. */
  variant?: "full" | "crest";
};

/** Official BHB crest / wordmark. Prefer `crest` on dark UI. */
export function BrandLogo({
  size = 64,
  priority = false,
  className = "",
  highlight = "sm",
  variant = "crest",
}: BrandLogoProps) {
  const mark = highlight === "lg" ? "logo-mark-lg" : "logo-mark";
  const src = variant === "full" ? TENANT.logoUrl : TENANT.logoCrestUrl;
  const ratio = variant === "full" ? 0.87 : 1.04;
  return (
    <Image
      src={src}
      alt={variant === "full" ? TENANT.name : ""}
      width={size}
      height={Math.round(size * ratio)}
      priority={priority}
      className={`${mark} object-contain ${className}`}
      aria-hidden={variant === "crest" ? true : undefined}
    />
  );
}

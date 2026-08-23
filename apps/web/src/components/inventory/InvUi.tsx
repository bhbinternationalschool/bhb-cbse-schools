"use client";

/**
 * Inventory — small shared UI pieces.
 *
 * The performance rule for this module lives here: every input is an
 * uncontrolled-feeling local field. Nothing in these components reads global
 * state, parses a catalogue, or triggers a network call while you type.
 */

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared control styling — deliberately carries NO width.
 *
 * A `w-full` baked in here would beat any `w-auto` added at a call site
 * (Tailwind resolves by stylesheet order, not by class-attribute order), which
 * is what made every toolbar filter stack onto its own row. Form fields add
 * `w-full` themselves; toolbars size their own controls.
 */
export const FIELD_CLASS =
  "h-9 min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50";

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  type = "text",
  className,
  disabled,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
}) {
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <input
        type={type}
        className={cn(FIELD_CLASS, "w-full", inputClassName)}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder = "— none —",
  hint,
  required,
  className,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <select
        className={cn(FIELD_CLASS, "w-full")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Money input in rupees. Keeps the raw text so "12." stays typable. */
export function MoneyField({
  label,
  value,
  onChange,
  hint,
  className,
  placeholder = "0.00",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          ₹
        </span>
        <input
          type="text"
          inputMode="decimal"
          className={cn(FIELD_CLASS, "w-full pl-6 text-right tabular-nums")}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        />
      </div>
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  className,
  suffix,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  className?: string;
  suffix?: string;
  step?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          step={step}
          className={cn(FIELD_CLASS, "w-full text-right tabular-nums", suffix && "pr-8")}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

export function InvAlert({
  error,
  notice,
  onDismiss,
}: {
  error?: string;
  notice?: string;
  onDismiss?: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        error
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {error ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="flex-1">{error || notice}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs underline opacity-70 hover:opacity-100"
        >
          dismiss
        </button>
      ) : null}
    </div>
  );
}

export function InvSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}…
    </div>
  );
}

/** A compact headline number for the dashboard strip. */
export function StatTile({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
  sub?: string;
}) {
  const toneClass = {
    neutral: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", toneClass)}>
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const toneClass = {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bad: "bg-destructive/10 text-destructive",
    info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

/** Right-hand drawer used for every create/edit form in this module. */
export function InvDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          "relative flex h-full w-full flex-col bg-background shadow-xl",
          wide ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

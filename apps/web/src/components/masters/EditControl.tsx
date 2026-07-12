"use client";

/** Small Edit link used next to Inactivate / Remove in Masters lists. */
export function EditControl({
  onEdit,
  active = false,
  label = "Edit",
}: {
  onEdit: () => void;
  active?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`text-xs font-medium ${
        active
          ? "text-[var(--brand-deep)] underline underline-offset-2"
          : "text-[var(--brand-mid)]"
      }`}
      onClick={onEdit}
    >
      {active ? "Editing…" : label}
    </button>
  );
}

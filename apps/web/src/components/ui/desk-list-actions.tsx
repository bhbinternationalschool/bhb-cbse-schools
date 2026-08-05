"use client";

type DeskListActionsProps = {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  readOnly?: boolean;
  deleteConfirm?: string;
};

/** Compact Edit / Delete links for desk list rows. */
export function DeskListActions({
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
  readOnly = false,
  deleteConfirm,
}: DeskListActionsProps) {
  if (readOnly) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {onEdit ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--brand-deep)]"
          onClick={onEdit}
        >
          {editLabel}
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="text-[11px] font-semibold text-[#b42318]"
          onClick={() => {
            if (deleteConfirm && !window.confirm(deleteConfirm)) return;
            onDelete();
          }}
        >
          {deleteLabel}
        </button>
      ) : null}
    </div>
  );
}

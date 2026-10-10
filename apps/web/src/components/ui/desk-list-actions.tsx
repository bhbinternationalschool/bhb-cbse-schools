"use client";

import { Pencil, Trash2 } from "lucide-react";

import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { RowActionMenu, type RowAction } from "@/components/ui/erp-grid";

type DeskListActionsProps = {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  readOnly?: boolean;
  deleteConfirm?: string;
  /** Screen-specific items shown above Edit / Delete. */
  extra?: RowAction<unknown>[];
  label?: string;
};

/**
 * The row menu for desk list rows: Edit, Delete and anything the screen adds,
 * behind the same "…" trigger every grid in the app uses. It used to render
 * two bare text links; the premium grid standard (docs/PREMIUM_GRID_STANDARD.md)
 * puts one menu on every row instead, so this became a thin wrapper and every
 * screen that already used it converted in one step.
 */
export function DeskListActions({
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
  readOnly = false,
  deleteConfirm,
  extra = [],
  label = "Row actions",
}: DeskListActionsProps) {
  const { ask, dialog } = useConfirmDialog({
    title: deleteConfirm || "Delete this item?",
    confirmLabel: deleteLabel,
    tone: "danger",
  });

  if (readOnly) return null;
  const actions: RowAction<unknown>[] = [...extra];
  if (onEdit) actions.push({ id: "edit", label: editLabel, icon: <Pencil />, onSelect: () => onEdit() });
  if (onDelete) {
    actions.push({
      id: "delete",
      label: deleteLabel,
      icon: <Trash2 />,
      tone: "danger",
      separatorAbove: actions.length > 0,
      onSelect: () => {
        if (deleteConfirm) {
          ask(onDelete);
          return;
        }
        onDelete();
      },
    });
  }
  if (actions.length === 0) return null;
  return (
    <>
      <RowActionMenu row={null} actions={actions} label={label} />
      {deleteConfirm ? dialog : null}
    </>
  );
}

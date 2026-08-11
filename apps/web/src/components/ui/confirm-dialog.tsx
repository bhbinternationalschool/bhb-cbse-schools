"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "default" | "danger"
  onConfirm: () => void | Promise<void>
}

/**
 * Styled, focus-trapped replacement for `window.confirm()` — used for
 * destructive actions (delete/void/cancel) across desk list rows. Renders
 * nothing until `open`, so it's safe to mount unconditionally.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {cancelLabel}
          </DialogClose>
          <Button
            type="button"
            variant={tone === "danger" ? "destructive" : "default"}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

/**
 * Drop-in replacement for the `window.confirm(message) ? action() : void`
 * pattern: renders the dialog and exposes an `ask()` trigger that opens it,
 * calling `onConfirm` only if the user accepts.
 */
export function useConfirmDialog(opts: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "default" | "danger"
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<(() => void | Promise<void>) | null>(
    null
  )

  function ask(onConfirm: () => void | Promise<void>) {
    setPending(() => onConfirm)
    setOpen(true)
  }

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={opts.title}
      description={opts.description}
      confirmLabel={opts.confirmLabel}
      cancelLabel={opts.cancelLabel}
      tone={opts.tone}
      onConfirm={async () => {
        await pending?.()
      }}
    />
  )

  return { ask, dialog }
}

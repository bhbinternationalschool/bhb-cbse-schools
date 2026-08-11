"use client"

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Shared modal primitive backed by @base-ui/react's AlertDialog (focus trap,
 * Escape-to-close, scroll lock, aria-modal all handled by the library).
 * Replaces the 14 hand-rolled `role="dialog"` backdrops scattered across
 * modules, which each reimplemented (and mostly skipped) that behavior.
 */
function Dialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  children,
  ...props
}: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="dialog-portal" {...props}>
      {children}
    </AlertDialogPrimitive.Portal>
  )
}

function DialogBackdrop({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

type DialogSize = "sm" | "md" | "lg"

const sizeClass: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
}

function DialogPopup({
  className,
  size = "md",
  children,
  ...props
}: AlertDialogPrimitive.Popup.Props & { size?: DialogSize }) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <AlertDialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
        <AlertDialogPrimitive.Popup
          data-slot="dialog-popup"
          className={cn(
            "max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            sizeClass[size],
            className
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Viewport>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("mb-3 flex items-start justify-between gap-3", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base font-semibold text-[var(--brand-deep)]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-[var(--muted)]", className)}
      {...props}
    />
  )
}

function DialogClose({
  className,
  showIcon = false,
  ...props
}: AlertDialogPrimitive.Close.Props & { showIcon?: boolean }) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="dialog-close"
      className={cn(
        showIcon &&
          "rounded-md p-1 text-[var(--muted)] hover:bg-[rgba(32,48,80,0.06)] hover:text-[var(--brand-deep)]",
        className
      )}
      {...props}
    >
      {showIcon ? <XIcon className="size-4" /> : props.children}
    </AlertDialogPrimitive.Close>
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-4 flex flex-wrap items-center justify-end gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
}

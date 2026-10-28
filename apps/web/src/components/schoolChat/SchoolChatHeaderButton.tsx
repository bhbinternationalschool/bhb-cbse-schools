"use client";

/**
 * The staff header's chat button (director, 29 Oct 2026): "I made a new
 * group, sent hello, and it did not reach anyone."
 *
 * The old button (StaffInternalChatButton) kept every group and message in
 * the browser's localStorage and in one Cloud Run instance's memory
 * (lib/erpChatServer, .data/erp_chat.json), so a message reached only people
 * whose browser happened to sync with the same instance. This one is school
 * chat: every conversation is a row in the database, read through
 * /api/v1/school-chat by the web ERP, the staff app and the parent app alike.
 *
 * The badge is the caller's unread count across their own conversations,
 * read from the server (polled every 30 s while the tab is visible). The
 * drawer is the same pane as the School chat page.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { QueryError } from "@/components/data/QueryError";
import { ChatsPanel, unreadTotal, useConversations } from "@/components/schoolChat/SchoolChatPanel";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

export function ChatUnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] leading-none font-bold text-white ring-2 ring-[var(--surface)]"
      data-testid="chat-unread-badge"
      aria-hidden
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The right-hand chat drawer, rendered into <body>: the headers it opens
 * from blur their backdrop, which makes a `fixed` child size itself to the
 * header (a 70 px strip) instead of the screen.
 */
export function ChatDrawer({ label, testId, onClose, children }: { label: string; testId: string; onClose: () => void; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-dvh w-full max-w-md flex-col gap-3 bg-[var(--surface)] p-3 shadow-xl"
        role="dialog"
        aria-label={label}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SchoolChatHeaderButton() {
  const session = useDemoSessionOptional();
  // Every staff login: the server decides who it chats as (its staff row, or
  // for an owner's account with none, a login id — schoolChat.server
  // staffChatId) and says so plainly when it cannot.
  const staff = session?.persona === "staff";
  const [open, setOpen] = useState(false);
  const convs = useConversations(undefined, { enabled: staff, pollMs: open ? 10_000 : 30_000 });
  const unread = unreadTotal(convs.data);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!staff) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[var(--brand-deep)] hover:bg-[var(--muted-surface)] dark:text-[var(--ink)]"
        aria-label={unread ? `Chat — ${unread} unread` : "Chat"}
        title="School chat"
        data-testid="header-chat-button"
      >
        <MessageCircle className="h-[18px] w-[18px]" />
        <ChatUnreadBadge count={unread} />
      </button>
      {open ? (
        <ChatDrawer label="School chat" testId="header-chat-drawer" onClose={() => setOpen(false)}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-[var(--brand-deep)] dark:text-[var(--ink)]">School chat</p>
            <span className="flex items-center gap-3">
              <Link href="/school-chat" className="text-xs font-semibold text-[var(--brand-accent)] underline" onClick={() => setOpen(false)}>
                Open full page
              </Link>
              <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="text-[var(--ink)]">
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>
          <ChatsPanel view={convs.data} loading={convs.isLoading} reload={convs.refetch} initial="" compact />
          {convs.isError ? <QueryError what="your chats" error={convs.error} retry={convs.refetch} /> : null}
        </ChatDrawer>
      ) : null}
    </>
  );
}

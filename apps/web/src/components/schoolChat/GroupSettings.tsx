"use client";

/**
 * A staff-made group's settings (director, 30 Oct 2026: "after making chat
 * groups there is no option to edit the group and remove or add members").
 *
 * The group header's ⋮ menu (GroupMenu) and the pane it opens
 * (GroupSettings): Edit name, Members (add with the same staff picker as New
 * group, remove), Class section, Leave group. What is shown comes from the
 * server (conversation.manage): the maker while in the group, or a chat
 * moderator, may change it; any member may leave. Every change sends the
 * version of the group it was made against (`rev`); a group someone else
 * changed meanwhile answers 409 and the pane says so and reloads.
 */
import { useState } from "react";
import { QueryError } from "@/components/data/QueryError";
import { useErpQuery } from "@/lib/data/client/hooks";
import { chatPost, type ContactsView, type MessagesView } from "@/lib/schoolChatClient";

const btn = "rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--muted-surface)] disabled:opacity-50 dark:text-[var(--ink)]";
const btnPrimary = "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]";
const label = "mb-1 block text-xs font-semibold uppercase text-[var(--muted)]";

export type GroupManage = NonNullable<MessagesView["conversation"]["manage"]>;
export type GroupPane = "name" | "members" | "section";

/** The staff picker of New group and of Members → Add. */
export function StaffChecklist({
  staff,
  picked,
  onToggle,
  loading,
  exclude = [],
}: {
  staff: ContactsView["staff"];
  picked: string[];
  onToggle: (id: string) => void;
  loading?: boolean;
  exclude?: string[];
}) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  return (
    <>
      <input className={`mb-2 ${field}`} placeholder="Search staff" aria-label="Search staff" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {loading ? <p className="text-[var(--muted)]">Loading staff…</p> : null}
      <ul className="space-y-0.5">
        {staff
          .filter((s) => !exclude.includes(s.id))
          .filter((s) => !f || s.name.toLowerCase().includes(f) || picked.includes(s.id))
          .slice(0, 120)
          .map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 rounded px-2 py-1 text-[var(--ink)] hover:bg-[var(--muted-surface)]">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={() => onToggle(s.id)} />
                <span className="min-w-0 break-words">{s.name}</span>
              </label>
            </li>
          ))}
      </ul>
    </>
  );
}

/** The ⋮ menu in the group's header: only the items this person may use. */
export function GroupMenu({ manage, onPick, onLeave }: { manage: GroupManage; onPick: (p: GroupPane) => void; onLeave: () => void }) {
  const [open, setOpen] = useState(false);
  const item = "block w-full px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--muted-surface)]";
  const pick = (p: GroupPane) => {
    setOpen(false);
    onPick(p);
  };
  return (
    <div className="relative ml-auto shrink-0">
      <button type="button" className={`${btn} px-2`} aria-label="Group menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="school-chat-group-menu">
        ⋮
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-lg">
          {manage.canManage ? (
            <button type="button" role="menuitem" className={item} onClick={() => pick("name")}>
              Edit name
            </button>
          ) : null}
          <button type="button" role="menuitem" className={item} onClick={() => pick("members")}>
            Members ({manage.members.length})
          </button>
          {manage.canManage ? (
            <button type="button" role="menuitem" className={item} onClick={() => pick("section")}>
              Class section
            </button>
          ) : null}
          {manage.canLeave ? (
            <button
              type="button"
              role="menuitem"
              className={`${item} text-[var(--danger)]`}
              onClick={() => {
                setOpen(false);
                onLeave();
              }}
            >
              Leave group
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Change = { op: string; title?: string; staffIds?: string[]; section?: { classId: string; sectionId: string } };

/** Send one change; the answer's words on a refusal (409: someone else changed it first). */
export async function changeGroup(conversationId: string, rev: string, c: Change) {
  return chatPost<{ id: string; title: string; rev: string; left: boolean }>("/api/v1/school-chat/groups", { conversationId, rev, ...c });
}

export function GroupSettings({
  conversationId,
  title,
  manage,
  pane,
  onPane,
  onClose,
  onChanged,
}: {
  conversationId: string;
  title: string;
  manage: GroupManage;
  pane: GroupPane;
  onPane: (p: GroupPane) => void;
  onClose: () => void;
  /** After a change (or a 409): reload the group and the list. */
  onChanged: () => unknown;
}) {
  const contacts = useErpQuery<ContactsView>(["school-chat", "contacts", ""], "/api/v1/school-chat/contacts", { enabled: manage.canManage });
  const [name, setName] = useState(title);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const me = manage.me;

  async function run(c: Change, done: string) {
    setBusy(true);
    setMsg(null);
    const r = await changeGroup(conversationId, manage.rev, c);
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: r.error });
      if (r.status === 409) void onChanged();
      return false;
    }
    setMsg({ kind: "ok", text: done });
    void onChanged();
    return true;
  }

  const tabs: { id: GroupPane; label: string }[] = [
    ...(manage.canManage ? [{ id: "name" as const, label: "Name" }] : []),
    { id: "members", label: "Members" },
    ...(manage.canManage ? [{ id: "section" as const, label: "Class section" }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="school-chat-group-settings">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`${btn} ${pane === t.id ? "bg-[var(--muted-surface)]" : ""}`} aria-pressed={pane === t.id} onClick={() => onPane(t.id)}>
            {t.label}
          </button>
        ))}
        <button type="button" className={`${btn} ml-auto`} onClick={onClose}>
          Done
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {manage.creatorLeft ? (
          <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--ink)]" data-testid="school-chat-creator-left">
            {manage.creatorName ? `${manage.creatorName}, who made this group, has left it` : "The staff member who made this group has left it"} — only a chat moderator can change it now.
          </p>
        ) : !manage.canManage ? (
          <p className="text-xs text-[var(--muted)]">Only {manage.creatorName || "the staff member who made this group"} or a chat moderator can change this group.</p>
        ) : null}

        {pane === "name" && manage.canManage ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ op: "rename", title: name }, "Name saved.");
            }}
          >
            <label className="block">
              <span className={label}>Group name</span>
              <input aria-label="Group name" className={field} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className={btnPrimary} disabled={busy || !name.trim() || name.trim() === title}>
              {busy ? "Saving…" : "Save name"}
            </button>
          </form>
        ) : null}

        {pane === "members" ? (
          <div className="space-y-2">
            <span className={label}>Staff in this group ({manage.members.length})</span>
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]" data-testid="school-chat-members">
              {manage.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-[var(--ink)]">
                    {m.name}
                    {m.id === me ? <span className="text-xs text-[var(--muted)]"> (you)</span> : null}
                  </span>
                  {manage.canManage && m.id !== me ? (
                    <button
                      type="button"
                      className={`${btn} shrink-0 px-2 py-1 text-xs text-[var(--danger)]`}
                      disabled={busy || manage.members.length <= 2}
                      title={manage.members.length <= 2 ? "A group needs at least two staff" : undefined}
                      aria-label={`Remove ${m.name}`}
                      onClick={() => {
                        if (window.confirm(`Remove ${m.name} from this group? They stop seeing it at once.`)) void run({ op: "removeStaff", staffIds: [m.id] }, `${m.name} removed.`);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {manage.canManage && manage.members.length <= 2 ? <p className="text-xs text-[var(--muted)]">A group needs at least two staff — add someone before removing anyone.</p> : null}
            {manage.canManage ? (
              adding ? (
                <div className="space-y-2 rounded-lg border border-[var(--border)] p-2" data-testid="school-chat-add-members">
                  {contacts.isError ? (
                    <QueryError what="the staff list" error={contacts.error} retry={contacts.refetch} />
                  ) : (
                    <StaffChecklist
                      staff={contacts.data?.staff ?? []}
                      loading={contacts.isLoading}
                      exclude={manage.members.map((m) => m.id)}
                      picked={picked}
                      onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy || picked.length === 0}
                      onClick={async () => {
                        if (await run({ op: "addStaff", staffIds: picked }, picked.length === 1 ? "1 person added." : `${picked.length} people added.`)) {
                          setPicked([]);
                          setAdding(false);
                        }
                      }}
                    >
                      {busy ? "Adding…" : `Add ${picked.length || ""}`.trim()}
                    </button>
                    <button type="button" className={btn} onClick={() => setAdding(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className={btn} onClick={() => setAdding(true)} data-testid="school-chat-add-member">
                  + Add staff
                </button>
              )
            ) : null}
          </div>
        ) : null}

        {pane === "section" && manage.canManage ? (
          <div className="space-y-2">
            <p className="text-[var(--ink)]">
              {manage.sectionLabel ? (
                <>
                  Now: <b>{manage.sectionLabel}</b> — its families can read this group (they cannot post).
                </>
              ) : (
                "Now: staff only."
              )}
            </p>
            {contacts.isError ? <QueryError what="your class sections" error={contacts.error} retry={contacts.refetch} /> : null}
            {(contacts.data?.sections ?? []).length ? (
              <label className="block">
                <span className={label}>Class section (its families can read the group)</span>
                <select aria-label="Class section" className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                  <option value="">Pick a section</option>
                  {(contacts.data?.sections ?? []).map((s) => (
                    <option key={`${s.classId}|${s.sectionId}`} value={`${s.classId}|${s.sectionId}`}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : contacts.isLoading ? (
              <p className="text-[var(--muted)]">Loading your sections…</p>
            ) : (
              <p className="text-xs text-[var(--muted)]">You can add only a class section you teach.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || !section}
                onClick={() => {
                  const [classId, sectionId] = section.split("|");
                  void run({ op: "setSection", section: { classId: classId!, sectionId: sectionId! } }, "Class section saved.");
                }}
              >
                Save section
              </button>
              {manage.sectionLabel ? (
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Make this group staff only? ${manage.sectionLabel} families stop seeing it.`)) void run({ op: "clearSection" }, "The group is staff only now.");
                  }}
                >
                  Make staff only
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {msg ? (
        <p className={`px-3 pb-2 text-xs ${msg.kind === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"}`} role={msg.kind === "error" ? "alert" : "status"} data-testid="school-chat-group-msg">
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

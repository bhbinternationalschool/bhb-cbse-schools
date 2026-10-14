"use client";

/**
 * Inputs that keep their own draft while you type and hand the value up only
 * when you pause or are done — after a short pause in typing, on blur, on
 * Enter, or when the box goes away. Escape puts the stored value back.
 *
 * Why (director, 14 Oct 2026, payroll "Adjust / pay"): every keystroke in a
 * controlled box used to write the whole payroll store, add an audit row,
 * schedule a server sync and re-render the whole run — so boxes lagged and
 * stuck, and a date box re-rendered between the digits of its year until
 * the browser dropped them. Here a keystroke re-renders only the box itself.
 *
 * The pause matters on phones: iOS does not always blur a box when a button
 * is tapped, so "commit on blur" alone could leave a typed figure unsaved.
 *
 * The rules for what a half-typed value means live in lib/draftInput (with a
 * selftest). While a box is not focused it follows the stored value, so a
 * change from elsewhere (a rebuild, a clamp, another tab's save) still shows.
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";

import {
  dateDraftCommit,
  draftNumberValue,
  numberDraftText,
} from "@/lib/draftInput";

type BaseProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onBlur" | "type"
>;

/** Idle time after the last keystroke before a number / text box saves. */
const PAUSE_MS = 700;

/**
 * Draft state plus a pending commit: `schedule` after each keystroke,
 * `flush` on blur / Enter / unmount, `cancel` on Escape.
 */
function useDraftCommit(
  stored: string,
  commit: (draft: string, el: HTMLInputElement | null) => void,
  pauseMs: number | null,
) {
  const [draft, setDraft] = useState(stored);
  const [focused, setFocused] = useState(false);
  // Follow the stored value whenever the box is not being typed in — also
  // right after a blur, so a clamped or refused value shows as stored.
  useEffect(() => {
    if (!focused) setDraft(stored);
  }, [stored, focused]);

  const el = useRef<HTMLInputElement | null>(null);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    const d = pending.current;
    pending.current = null;
    if (d !== null) latest.current(d, el.current);
  }, []);
  const cancel = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
  }, []);
  const schedule = useCallback(
    (d: string) => {
      pending.current = d;
      if (pauseMs === null) return;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, pauseMs);
    },
    [flush, pauseMs],
  );
  // A box removed while something is still pending (the row collapsed, the
  // tab changed) saves it rather than losing it.
  useEffect(() => () => flush(), [flush]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancel();
      setDraft(stored);
      const node = e.currentTarget;
      window.setTimeout(() => node.blur(), 0);
    }
  };

  return { draft, setDraft, setFocused, el, flush, schedule, onKeyDown };
}

/** A number box: `onCommit` gets the number when typing pauses or ends. */
export const DraftNumberInput = memo(function DraftNumberInput({
  value,
  onCommit,
  onFocus,
  onKeyDown,
  ...rest
}: BaseProps & {
  value: number;
  /** Called with the typed number when it differs from `value`. */
  onCommit: (n: number) => void;
}) {
  const d = useDraftCommit(
    numberDraftText(value),
    (draft, node) => {
      // "1e", "-" … : the browser reports "" with badInput — not a zero.
      if (node?.validity.badInput) return;
      const n = draftNumberValue(draft);
      if (n === null) return; // unreadable — the box shows the stored value again
      if (n !== value) onCommit(n);
    },
    PAUSE_MS,
  );
  return (
    <input
      {...rest}
      ref={d.el}
      type="number"
      inputMode="decimal"
      value={d.draft}
      onFocus={(e) => {
        d.setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        d.setDraft(e.target.value);
        d.schedule(e.target.value);
      }}
      onKeyDown={(e) => {
        d.onKeyDown(e);
        onKeyDown?.(e);
      }}
      onBlur={() => {
        d.flush();
        d.setFocused(false);
      }}
    />
  );
});

/** A text box: `onCommit` gets the text when typing pauses or ends. */
export const DraftTextInput = memo(function DraftTextInput({
  value,
  onCommit,
  onFocus,
  onKeyDown,
  ...rest
}: BaseProps & {
  value: string;
  onCommit: (text: string) => void;
}) {
  const stored = value || "";
  const d = useDraftCommit(
    stored,
    (draft) => {
      if (draft !== stored) onCommit(draft);
    },
    PAUSE_MS,
  );
  return (
    <input
      {...rest}
      ref={d.el}
      type="text"
      value={d.draft}
      onFocus={(e) => {
        d.setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        d.setDraft(e.target.value);
        d.schedule(e.target.value);
      }}
      onKeyDown={(e) => {
        d.onKeyDown(e);
        onKeyDown?.(e);
      }}
      onBlur={() => {
        d.flush();
        d.setFocused(false);
      }}
    />
  );
});

/**
 * A date box (the browser's own date input) that lets you type dd → mm →
 * yyyy. It stores a date only when it is whole and real; while the year is
 * half-typed nothing is stored and nothing re-renders, and a partial entry
 * never clears the stored date — on blur the box shows the stored date
 * again. Choosing a day in the picker stores it at once.
 *
 * `allowEmpty={false}`: the box always holds a day — emptying it stores
 * nothing. `commitOn="blur"`: hand the date up only when the box is left
 * (or Enter is pressed), never while it is being edited — for a date whose
 * change is an action with a confirm (moving a whole exam day), where a
 * day typed digit by digit (01, then 15) must not ask twice.
 */
export const DraftDateInput = memo(function DraftDateInput({
  value,
  onCommit,
  onFocus,
  onKeyDown,
  allowEmpty = true,
  commitOn = "change",
  ...rest
}: BaseProps & {
  /** YYYY-MM-DD or "". */
  value: string;
  onCommit: (iso: string) => void;
  allowEmpty?: boolean;
  commitOn?: "change" | "blur";
}) {
  const stored = value || "";
  // What was handed up last, so one date is not sent twice (on change, then
  // on blur) before the parent's new value arrives.
  const sent = useRef(stored);
  useEffect(() => {
    sent.current = stored;
  }, [stored]);
  const d = useDraftCommit(
    stored,
    (draft, node) => {
      const r = dateDraftCommit(draft, {
        badInput: node?.validity.badInput ?? false,
        onBlur: true,
        allowEmpty,
      });
      if (!r.commit || r.value === sent.current) return;
      sent.current = r.value;
      onCommit(r.value);
    },
    null, // a date is stored the moment it is whole — no pause needed
  );
  return (
    <input
      {...rest}
      ref={d.el}
      type="date"
      value={d.draft}
      onFocus={(e) => {
        // A date the parent refused last time (a cancelled confirm, a
        // clamp) may be offered again in this new visit to the box.
        sent.current = stored;
        d.setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const v = e.target.value;
        d.setDraft(v);
        if (commitOn === "blur") return;
        const r = dateDraftCommit(v, {
          badInput: e.target.validity.badInput,
          clearNow: true,
          allowEmpty,
        });
        if (r.commit) {
          d.schedule(v);
          d.flush();
        }
      }}
      onKeyDown={(e) => {
        d.onKeyDown(e);
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        // Half-typed: nothing is stored, and the stored date shows again.
        d.schedule(e.target.value);
        d.flush();
        d.setFocused(false);
      }}
    />
  );
});

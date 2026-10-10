"use client";

import { useState } from "react";

/**
 * The admission enquiry form.
 *
 * It writes a lead straight into the Admissions desk, so a parent filling
 * this in on a Sunday evening is on the follow-up list on Monday morning —
 * which is the whole point of a website that is wired to the ERP rather
 * than sitting beside it.
 *
 * The form is deliberately short. Every extra field on a public enquiry
 * form costs completions, and the office only needs enough to ring back.
 */
export function EnquiryForm({ classes }: { classes: string[] }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/public/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guardianName: form.get("guardianName"),
          childName: form.get("childName"),
          mobile: form.get("mobile"),
          classSought: form.get("classSought"),
          message: form.get("message"),
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error || "We could not send that. Please telephone us instead.");
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError("We could not reach the school. Please telephone us instead.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-base font-semibold text-slate-900">Thank you.</p>
        <p className="mt-1 text-sm text-slate-600">
          Someone from the school will telephone you. If it is urgent, please
          ring the school office directly.
        </p>
      </div>
    );
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[15px] text-slate-900";

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-slate-600">
          Your name
          <input name="guardianName" required className={field} />
        </label>
        <label className="block text-sm text-slate-600">
          Telephone number
          <input
            name="mobile"
            required
            type="tel"
            inputMode="numeric"
            className={field}
          />
        </label>
        <label className="block text-sm text-slate-600">
          Child&rsquo;s name
          <input name="childName" className={field} />
        </label>
        <label className="block text-sm text-slate-600">
          Class sought
          <select name="classSought" className={field} defaultValue="">
            <option value="">Not sure yet</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block text-sm text-slate-600">
        Anything you would like to ask (optional)
        <textarea name="message" rows={3} className={field} />
      </label>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send enquiry"}
      </button>
      <p className="mt-3 text-xs text-slate-500">
        We use your number only to answer this enquiry.
      </p>
    </form>
  );
}

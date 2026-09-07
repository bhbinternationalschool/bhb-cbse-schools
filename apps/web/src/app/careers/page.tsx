"use client";

/**
 * Public careers page — a teacher applies, the school reads the CV.
 *
 * Three fields and a file, because every extra box on a public form is a
 * person who does not finish it. The subject and the classes are NOT
 * asked for: they are on the CV already, and reading them there is the
 * whole point. If the OCR cannot find them the office sees the CV itself
 * and rings the applicant, which is what would have happened anyway.
 *
 * The page never reports what the OCR read. An applicant told "we saw
 * Maths, VI–VIII" would start editing their CV to game it, and a public
 * endpoint that answers questions about a mobile number is a lookup tool
 * for anyone who wants one.
 */

import { useRef, useState } from "react";
import { TENANT } from "@/lib/types";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

type Phase = "form" | "sending" | "done";

export default function CareersPage() {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    setError("");
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(
        `That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — please attach one under 4 MB.`,
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Please attach your CV.");
      return;
    }
    setPhase("sending");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read that file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/public/careers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantName: name,
          mobile,
          email,
          cv: dataUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Something went wrong. Please try again.");
        setPhase("form");
        return;
      }
      setPhase("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setPhase("form");
    }
  };

  if (phase === "done") {
    return (
      <main style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>🙏</div>
          <h1 style={h1}>Thank you, {name.split(" ")[0] || "and welcome"}.</h1>
          <p style={p}>
            The school office has your CV. If your experience matches a
            vacancy, someone will call you on <strong>{mobile}</strong>.
          </p>
          <p style={{ ...p, color: "#64748b", fontSize: 13 }}>
            Please do not send it again — a second copy does not move you up
            the list.
          </p>
        </div>
      </main>
    );
  }

  const busy = phase === "sending";
  return (
    <main style={wrap}>
      <form style={card} onSubmit={submit}>
        <h1 style={h1}>Teach at {TENANT.shortName}</h1>
        <p style={p}>
          Send us your CV. We read it, and if it matches something we are
          looking for, we call you. No account needed.
        </p>

        <label style={label}>
          Your full name
          <input
            style={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoComplete="name"
            disabled={busy}
          />
        </label>

        <label style={label}>
          Mobile number
          <input
            style={input}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/[^\d+ ]/g, ""))}
            required
            inputMode="numeric"
            placeholder="10-digit number"
            autoComplete="tel"
            disabled={busy}
          />
        </label>

        <label style={label}>
          Email <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
          <input
            style={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            maxLength={120}
            autoComplete="email"
            disabled={busy}
          />
        </label>

        <label style={label}>
          Your CV
          <input
            ref={fileRef}
            style={{ ...input, padding: 8 }}
            type="file"
            accept={ACCEPT}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            required
            disabled={busy}
          />
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400 }}>
            PDF or a clear photo, up to 4 MB. Your subject and the classes you
            teach are read from the CV — you do not need to type them.
          </span>
        </label>

        {error ? <p style={errorBox}>{error}</p> : null}

        <button type="submit" style={{ ...button, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Sending…" : "Send my CV"}
        </button>

        <p style={{ ...p, fontSize: 12, color: "#64748b", marginBottom: 0 }}>
          Your CV goes to the school office and the principal. We use it only
          to consider you for a post.
        </p>
      </form>
    </main>
  );
}

// Inline styles: this page is opened by strangers on unknown devices and
// must render correctly before any stylesheet the ERP would normally load.
const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  background: "#f1f5f9",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "24px 16px 48px",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  color: "#0f172a",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "#ffffff",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 1px 3px rgba(15,23,42,0.08), 0 8px 24px rgba(15,23,42,0.06)",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const h1: React.CSSProperties = { fontSize: 22, margin: 0, fontWeight: 700 };
const p: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.5, color: "#334155" };
const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
};
const input: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 15,
  fontWeight: 400,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  color: "#0f172a",
};
const button: React.CSSProperties = {
  border: "none",
  borderRadius: 10,
  padding: "12px 16px",
  fontSize: 15,
  fontWeight: 600,
  background: "#1d4ed8",
  color: "#fff",
  cursor: "pointer",
};
const errorBox: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "#b91c1c",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 8,
  padding: "8px 10px",
};

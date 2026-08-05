import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";

const execFileAsync = promisify(execFile);

const PY_EXTRACT = `
import sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
parts = []
for page in reader.pages:
    parts.append(page.extract_text() or "")
print("\\n".join(parts))
`;

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const dir = await mkdtemp(path.join(tmpdir(), "bhb-pdf-"));
    const pdfPath = path.join(dir, "report.pdf");
    const pyPath = path.join(dir, "extract.py");
    const outPath = path.join(dir, "out.txt");
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(pdfPath, buf);
    await writeFile(pyPath, PY_EXTRACT);

    const { stdout } = await execFileAsync("python3", [pyPath, pdfPath], {
      maxBuffer: 20 * 1024 * 1024,
    });
    await writeFile(outPath, stdout);

    const text = await readFile(outPath, "utf8");
    await rm(dir, { recursive: true, force: true });

    return NextResponse.json({ text });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to extract PDF text";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

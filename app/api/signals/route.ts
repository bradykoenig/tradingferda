import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- pick a python exe (works on Win/macOS/Linux) ---
function resolvePythonCmd(): string {
  if (process.env.PYTHON_CMD) return process.env.PYTHON_CMD;
  const candidates = [
    path.join(process.cwd(), ".venv312", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), ".venv312", "bin", "python"),
    path.join(process.cwd(), ".venv", "bin", "python"),
    process.platform === "win32" ? "python" : "python3",
    "python",
  ];
  for (const c of candidates) {
    try { if (c.includes(path.sep) && fs.existsSync(c)) return c; } catch {}
  }
  return process.platform === "win32" ? "python" : "python3";
}

// Optional: quick health check in the browser
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST() {
  return new Promise((resolve) => {
    const python = resolvePythonCmd();
    const scriptPath = path.join(process.cwd(), "scripts", "build_signals.py");

    const proc = spawn(python, [scriptPath], {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      env: process.env,
    });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(NextResponse.json({ success: true, output: out.trim() }));
      } else {
        resolve(
          NextResponse.json(
            {
              success: false,
              error: (err || out || "Unknown error").slice(-4000),
              code,
            },
            { status: 500 }
          )
        );
      }
    });
  });
}

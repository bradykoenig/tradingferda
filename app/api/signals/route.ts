// app/api/signals/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";            // Workers-compatible
export const dynamic = "force-dynamic";

// --- Configure these for your repo/workflow ---
const OWNER = "bradykoenig";
const REPO = "tradingferda";
const WORKFLOW_FILE = "update-signals.yml"; // .github/workflows/update-signals.yml
const REF = "main";                         // branch to run workflow on

type DispatchBody = {
  // Optional: allow passing inputs: { force?: string; note?: string; }
  inputs?: Record<string, string>;
};

export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, hosting: "cloudflare-pages", action: WORKFLOW_FILE });
}

export async function POST(req: Request): Promise<Response> {
  const token = process.env.GITHUB_PAT; // add in Cloudflare Pages → Settings → Environment Variables
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Server missing GITHUB_PAT env var" },
      { status: 500 }
    );
  }

  let inputs: Record<string, string> | undefined = undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as DispatchBody;
    if (body && body.inputs && typeof body.inputs === "object") {
      // GitHub Actions only accepts string inputs
      inputs = Object.fromEntries(
        Object.entries(body.inputs).map(([k, v]) => [k, String(v)])
      );
    }
  } catch {
    // ignore body parse errors; inputs remain undefined
  }

  const ghUrl = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const ghRes = await fetch(ghUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ ref: REF, inputs }),
  });

  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    return NextResponse.json(
      { success: false, error: `GitHub dispatch failed: ${ghRes.status} ${text.slice(0, 500)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, dispatched: { workflow: WORKFLOW_FILE, ref: REF } });
}

// app/api/signals/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";            // ✅ works on Cloudflare Pages
export const dynamic = "force-dynamic";

type Env = {
  GITHUB_PAT?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW_FILE?: string;  // e.g. "update-signals.yml"
  GITHUB_REF?: string;            // e.g. "main"
};

function readEnv(): Required<Env> {
  const {
    GITHUB_PAT,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_WORKFLOW_FILE,
    GITHUB_REF,
  } = process.env as Env;

  const missing: string[] = [];
  if (!GITHUB_PAT) missing.push("GITHUB_PAT");
  if (!GITHUB_OWNER) missing.push("GITHUB_OWNER");
  if (!GITHUB_REPO) missing.push("GITHUB_REPO");
  if (!GITHUB_WORKFLOW_FILE) missing.push("GITHUB_WORKFLOW_FILE");

  if (missing.length) {
    // We still allow this handler to run locally without secrets,
    // but on Cloudflare you should set these in Pages → Settings → Environment variables (production & preview).
    throw new Error(
      `Missing required env var(s): ${missing.join(
        ", "
      )}. Set them in Cloudflare Pages → Settings → Environment Variables.`
    );
  }

  return {
    GITHUB_PAT,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_WORKFLOW_FILE,
    GITHUB_REF: GITHUB_REF || "main",
  };
}

async function triggerGithubWorkflow(env: Required<Env>) {
  const { GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF } = env;

  const url = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(
    GITHUB_WORKFLOW_FILE
  )}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      // Either "token" or "Bearer" works for classic PATs
      Authorization: `token ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      // Optional but nice to have:
      "User-Agent": "schlima-trading-refresh",
    },
    body: JSON.stringify({
      ref: GITHUB_REF,
      // inputs are optional; add anything your workflow might read
      inputs: {
        reason: "manual-refresh",
        ts: Date.now().toString(),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub dispatch failed: ${res.status} ${res.statusText} ${text ? `— ${text.slice(0, 500)}` : ""
      }`
    );
  }
}

export async function GET() {
  // Simple health check
  return NextResponse.json({ ok: true });
}

export async function POST(_req: Request): Promise<Response> {
  try {
    const env = readEnv();
    await triggerGithubWorkflow(env);
    // Return a friendly, quick response; the GH Action will update today.json and push
    return NextResponse.json({
      success: true,
      message: "Workflow dispatched. Signals will update when the action finishes.",
    });
  } catch (err: any) {
    // Surface a concise error message to the client
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Failed to dispatch workflow",
      },
      { status: 500 }
    );
  }
}

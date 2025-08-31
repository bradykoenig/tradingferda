import { NextResponse } from "next/server";

export const runtime = "edge"; 
export const dynamic = "force-dynamic";

type Env = {
  GITHUB_PAT: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_FILE: string;
  GITHUB_REF: string;
};

function readEnv(): Env {
  const {
    GITHUB_PAT,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_WORKFLOW_FILE,
    GITHUB_REF,
  } = process.env;

  const missing: string[] = [];
  if (!GITHUB_PAT) missing.push("GITHUB_PAT");
  if (!GITHUB_OWNER) missing.push("GITHUB_OWNER");
  if (!GITHUB_REPO) missing.push("GITHUB_REPO");
  if (!GITHUB_WORKFLOW_FILE) missing.push("GITHUB_WORKFLOW_FILE");

  if (missing.length) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}`
    );
  }

  return {
    GITHUB_PAT: GITHUB_PAT!,
    GITHUB_OWNER: GITHUB_OWNER!,
    GITHUB_REPO: GITHUB_REPO!,
    GITHUB_WORKFLOW_FILE: GITHUB_WORKFLOW_FILE!,
    GITHUB_REF: GITHUB_REF || "main",
  };
}

async function triggerGithubWorkflow(env: Env) {
  const { GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW_FILE, GITHUB_REF } = env;

  const url = `https://api.github.com/repos/${encodeURIComponent(
    GITHUB_OWNER
  )}/${encodeURIComponent(GITHUB_REPO)}/actions/workflows/${encodeURIComponent(
    GITHUB_WORKFLOW_FILE
  )}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "schlima-trading-refresh",
    },
    body: JSON.stringify({ ref: GITHUB_REF }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub dispatch failed: ${res.status} ${text}`);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST() {
  try {
    const env = readEnv();
    await triggerGithubWorkflow(env);
    return NextResponse.json({
      success: true,
      message: "Workflow dispatched. Signals will update soon.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to dispatch workflow" },
      { status: 500 }
    );
  }
}

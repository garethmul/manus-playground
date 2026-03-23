/**
 * /api/annotations — Shared annotations store backed by a JSON file in GitHub.
 *
 * Architecture
 * ────────────
 * All annotations are stored in `data/annotations.json` in the GitHub repository.
 * The file is a JSON object keyed by publicationId, each value being an array of
 * Annotation objects.
 *
 * Reads  → fetch the raw file from GitHub (fast, cached by CDN)
 * Writes → use the GitHub Contents API to update the file (creates a commit)
 *
 * This proves the concept of a shared, persistent, cross-user database without
 * requiring any external database service. In production, swap the GitHub API
 * calls for calls to PostgreSQL, MongoDB, or any other database.
 *
 * Environment variables required:
 *   GITHUB_TOKEN  — Personal access token with repo write access
 *   GITHUB_REPO   — Repository in "owner/name" format (e.g. "garethmul/manus-playground")
 */

import { NextResponse } from "next/server";

export type AnnotationType = "bookmark" | "highlight" | "note";
export type HighlightColor = "yellow" | "green" | "blue" | "red" | "purple" | "orange";

export interface Annotation {
  id: string;
  publicationId: string;
  type: AnnotationType;
  locator: {
    href: string;
    type: string;
    title?: string;
    locations?: {
      progression?: number;
      position?: number;
      totalProgression?: number;
      fragments?: string[];
    };
    text?: {
      highlight?: string;
      before?: string;
      after?: string;
    };
  };
  color?: HighlightColor;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── GitHub store helpers ──────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const DATA_FILE = "data/annotations.json";

function getGitHubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN environment variable is not set");
  return {
    Authorization: `token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "readium-playground",
  };
}

function getRepo() {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO environment variable is not set");
  return repo;
}

/**
 * Read the full annotations store from GitHub.
 * Returns { data, sha } where sha is needed for the subsequent write.
 */
async function readStore(): Promise<{ data: Record<string, Annotation[]>; sha: string }> {
  const repo = getRepo();
  const headers = getGitHubHeaders();

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${DATA_FILE}`, {
    headers,
    // Disable Next.js caching so we always get the latest version
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 404) {
      // File doesn't exist yet — return empty store with empty sha
      return { data: {}, sha: "" };
    }
    const text = await res.text();
    throw new Error(`GitHub read failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  const data = JSON.parse(content) as Record<string, Annotation[]>;
  return { data, sha: json.sha as string };
}

/**
 * Write the full annotations store back to GitHub.
 * sha must be the current file sha (from readStore) to avoid conflicts.
 */
async function writeStore(
  data: Record<string, Annotation[]>,
  sha: string,
  message: string
): Promise<void> {
  const repo = getRepo();
  const headers = getGitHubHeaders();
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

  const body: Record<string, unknown> = {
    message,
    content,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${DATA_FILE}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub write failed: ${res.status} ${text}`);
  }
}

// ─── ID generation ─────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ─── Route handlers ────────────────────────────────────────────────────────────

// GET /api/annotations?publicationId=xxx[&type=bookmark|highlight|note]
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const publicationId = searchParams.get("publicationId");
  const type = searchParams.get("type") as AnnotationType | null;

  if (!publicationId) {
    return NextResponse.json(
      { error: "publicationId parameter is required" },
      { status: 400 }
    );
  }

  try {
    const { data } = await readStore();
    let annotations = data[publicationId] || [];
    if (type) annotations = annotations.filter((a) => a.type === type);
    return NextResponse.json({ annotations });
  } catch (err) {
    console.error("[annotations GET]", err);
    return NextResponse.json({ annotations: [] });
  }
}

// POST /api/annotations
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicationId, type, locator, color, note } = body;

    if (!publicationId || !type || !locator) {
      return NextResponse.json(
        { error: "publicationId, type, and locator are required" },
        { status: 400 }
      );
    }

    if (!["bookmark", "highlight", "note"].includes(type)) {
      return NextResponse.json(
        { error: "type must be bookmark, highlight, or note" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: generateId(),
      publicationId,
      type,
      locator,
      color: color || (type !== "bookmark" ? "yellow" : undefined),
      note: note || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const { data, sha } = await readStore();
    if (!data[publicationId]) data[publicationId] = [];
    data[publicationId].push(annotation);

    await writeStore(
      data,
      sha,
      `annotation: add ${type} for ${publicationId}`
    );

    return NextResponse.json({ annotation }, { status: 201 });
  } catch (err) {
    console.error("[annotations POST]", err);
    return NextResponse.json({ error: "Failed to save annotation" }, { status: 500 });
  }
}

// DELETE /api/annotations?id=xxx&publicationId=xxx
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const publicationId = searchParams.get("publicationId");

  if (!id || !publicationId) {
    return NextResponse.json(
      { error: "id and publicationId parameters are required" },
      { status: 400 }
    );
  }

  try {
    const { data, sha } = await readStore();
    const annotations = data[publicationId] || [];
    const index = annotations.findIndex((a) => a.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }

    data[publicationId].splice(index, 1);
    await writeStore(data, sha, `annotation: delete ${id}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[annotations DELETE]", err);
    return NextResponse.json({ error: "Failed to delete annotation" }, { status: 500 });
  }
}

// PATCH /api/annotations — update note text or colour
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, publicationId, note, color } = body;

    if (!id || !publicationId) {
      return NextResponse.json(
        { error: "id and publicationId are required" },
        { status: 400 }
      );
    }

    const { data, sha } = await readStore();
    const annotations = data[publicationId] || [];
    const annotation = annotations.find((a) => a.id === id);

    if (!annotation) {
      return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    }

    if (note !== undefined) annotation.note = note;
    if (color !== undefined) annotation.color = color;
    annotation.updatedAt = new Date().toISOString();

    await writeStore(data, sha, `annotation: update ${id}`);

    return NextResponse.json({ annotation });
  } catch (err) {
    console.error("[annotations PATCH]", err);
    return NextResponse.json({ error: "Failed to update annotation" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

// In-memory store for the proof of concept.
// In production, replace with a database call using the user's ID.
// The store is keyed by publicationId, then annotationId.
const annotationsStore: Record<string, Annotation[]> = {};

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
  // Only for highlights and notes
  color?: HighlightColor;
  // Only for notes
  note?: string;
  // Metadata
  createdAt: string;
  updatedAt: string;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// GET /api/annotations?publicationId=xxx
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

  let annotations = annotationsStore[publicationId] || [];

  if (type) {
    annotations = annotations.filter((a) => a.type === type);
  }

  return NextResponse.json({ annotations });
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

    if (!annotationsStore[publicationId]) {
      annotationsStore[publicationId] = [];
    }
    annotationsStore[publicationId].push(annotation);

    return NextResponse.json({ annotation }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
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

  const annotations = annotationsStore[publicationId] || [];
  const index = annotations.findIndex((a) => a.id === id);

  if (index === -1) {
    return NextResponse.json(
      { error: "Annotation not found" },
      { status: 404 }
    );
  }

  annotationsStore[publicationId].splice(index, 1);

  return NextResponse.json({ success: true });
}

// PATCH /api/annotations — update note text
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

    const annotations = annotationsStore[publicationId] || [];
    const annotation = annotations.find((a) => a.id === id);

    if (!annotation) {
      return NextResponse.json(
        { error: "Annotation not found" },
        { status: 404 }
      );
    }

    if (note !== undefined) annotation.note = note;
    if (color !== undefined) annotation.color = color;
    annotation.updatedAt = new Date().toISOString();

    return NextResponse.json({ annotation });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

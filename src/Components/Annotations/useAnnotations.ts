"use client";

import { useState, useEffect, useCallback } from "react";

export type AnnotationType = "bookmark" | "highlight" | "note";
export type HighlightColor = "yellow" | "green" | "blue" | "red" | "purple" | "orange";

export interface Locator {
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
}

export interface Annotation {
  id: string;
  publicationId: string;
  type: AnnotationType;
  locator: Locator;
  color?: HighlightColor;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: "#FFE066",
  green: "#A8E6A3",
  blue: "#87CEEB",
  red: "#FFB3B3",
  purple: "#D4A8E8",
  orange: "#FFD4A3",
};

// ─── localStorage cache ────────────────────────────────────────────────────────
// Used as a fast local cache while the server fetch is in flight.
// The GitHub-backed API is the source of truth for cross-user sync.

const STORAGE_KEY_PREFIX = "wcp-annotations-";

function loadFromStorage(publicationId: string): Annotation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${publicationId}`);
    if (!raw) return [];
    return JSON.parse(raw) as Annotation[];
  } catch {
    return [];
  }
}

function saveToStorage(publicationId: string, annotations: Annotation[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${publicationId}`,
      JSON.stringify(annotations)
    );
  } catch {
    // localStorage may be full or unavailable
  }
}

function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function useAnnotations(publicationId: string | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch from the shared server store ─────────────────────────────────────
  // The server (GitHub-backed API) is the source of truth.
  // We show cached localStorage data immediately while the fetch is in flight.
  const fetchAnnotations = useCallback(async () => {
    if (!publicationId) return;

    // Show cached data immediately (fast)
    const cached = loadFromStorage(publicationId);
    if (cached.length > 0) setAnnotations(cached);

    setLoading(true);
    try {
      const res = await fetch(
        `/api/annotations?publicationId=${encodeURIComponent(publicationId)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        const serverAnnotations: Annotation[] = data.annotations || [];
        // Server is source of truth — always use server data
        setAnnotations(serverAnnotations);
        saveToStorage(publicationId, serverAnnotations);
      }
    } catch {
      // Network error — keep cached data
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  // Load on mount and whenever publicationId changes
  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  // ── Add annotation ──────────────────────────────────────────────────────────
  const addAnnotation = useCallback(
    async (params: {
      type: AnnotationType;
      locator: Locator;
      color?: HighlightColor;
      note?: string;
    }): Promise<Annotation | null> => {
      if (!publicationId) return null;

      const now = new Date().toISOString();
      // Optimistic local annotation (shown immediately while server call is in flight)
      const localAnnotation: Annotation = {
        id: generateLocalId(),
        publicationId,
        type: params.type,
        locator: params.locator,
        color: params.color,
        note: params.note,
        createdAt: now,
        updatedAt: now,
      };

      // Show immediately
      setAnnotations((prev) => {
        const next = [...prev, localAnnotation];
        saveToStorage(publicationId, next);
        return next;
      });

      // Persist to shared server store
      try {
        const res = await fetch("/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicationId, ...params }),
        });
        if (res.ok) {
          const data = await res.json();
          const serverAnnotation: Annotation = data.annotation;
          // Replace local placeholder with server annotation (has stable server ID)
          setAnnotations((prev) => {
            const next = prev.map((a) =>
              a.id === localAnnotation.id ? serverAnnotation : a
            );
            saveToStorage(publicationId, next);
            return next;
          });
          return serverAnnotation;
        }
      } catch {
        // Server unavailable — local annotation is still shown
      }

      return localAnnotation;
    },
    [publicationId]
  );

  // ── Delete annotation ───────────────────────────────────────────────────────
  const deleteAnnotation = useCallback(
    async (id: string): Promise<boolean> => {
      if (!publicationId) return false;

      // Optimistic remove
      setAnnotations((prev) => {
        const next = prev.filter((a) => a.id !== id);
        saveToStorage(publicationId, next);
        return next;
      });

      try {
        await fetch(
          `/api/annotations?id=${encodeURIComponent(id)}&publicationId=${encodeURIComponent(publicationId)}`,
          { method: "DELETE" }
        );
      } catch {
        // Server unavailable — local deletion still applied
      }

      return true;
    },
    [publicationId]
  );

  // ── Update annotation ───────────────────────────────────────────────────────
  const updateAnnotation = useCallback(
    async (
      id: string,
      updates: { note?: string; color?: HighlightColor }
    ): Promise<boolean> => {
      if (!publicationId) return false;

      // Optimistic update
      setAnnotations((prev) => {
        const next = prev.map((a) =>
          a.id === id
            ? { ...a, ...updates, updatedAt: new Date().toISOString() }
            : a
        );
        saveToStorage(publicationId, next);
        return next;
      });

      try {
        await fetch("/api/annotations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, publicationId, ...updates }),
        });
      } catch {
        // Server unavailable — local update still applied
      }

      return true;
    },
    [publicationId]
  );

  const bookmarks = annotations.filter((a) => a.type === "bookmark");
  const highlights = annotations.filter((a) => a.type === "highlight");
  const notes = annotations.filter((a) => a.type === "note");

  return {
    annotations,
    bookmarks,
    highlights,
    notes,
    loading,
    fetchAnnotations,
    addAnnotation,
    deleteAnnotation,
    updateAnnotation,
  };
}

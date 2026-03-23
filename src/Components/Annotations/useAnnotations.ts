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

// ─── localStorage persistence ──────────────────────────────────────────────────
// Vercel serverless functions lose in-memory state between invocations, so we
// persist annotations in localStorage as the primary store. The /api/annotations
// route is called for all mutations so the architecture is correct for a real
// backend integration — just swap the API route to use a real database.

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
  const [loading, setLoading] = useState(false);

  // Load from localStorage on mount (fast, synchronous)
  useEffect(() => {
    if (!publicationId) return;
    const stored = loadFromStorage(publicationId);
    setAnnotations(stored);
  }, [publicationId]);

  // Also try to sync from the API (may have data from other sessions)
  const fetchAnnotations = useCallback(async () => {
    if (!publicationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/annotations?publicationId=${encodeURIComponent(publicationId)}`);
      if (res.ok) {
        const data = await res.json();
        const serverAnnotations: Annotation[] = data.annotations || [];
        // Prefer server data if available, otherwise keep local
        if (serverAnnotations.length > 0) {
          setAnnotations(serverAnnotations);
          saveToStorage(publicationId, serverAnnotations);
        }
      }
    } catch {
      // Network error — use localStorage data (already loaded)
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  const addAnnotation = useCallback(async (params: {
    type: AnnotationType;
    locator: Locator;
    color?: HighlightColor;
    note?: string;
  }): Promise<Annotation | null> => {
    if (!publicationId) return null;

    const now = new Date().toISOString();
    // Optimistically create locally first
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

    // Update state and localStorage immediately
    setAnnotations((prev) => {
      const next = [...prev, localAnnotation];
      saveToStorage(publicationId, next);
      return next;
    });

    // Also push to API (best-effort — replaces local ID with server ID)
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicationId, ...params }),
      });
      if (res.ok) {
        const data = await res.json();
        const serverAnnotation: Annotation = data.annotation;
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
      // API unavailable — local annotation is still saved
    }

    return localAnnotation;
  }, [publicationId]);

  const deleteAnnotation = useCallback(async (id: string): Promise<boolean> => {
    if (!publicationId) return false;

    // Optimistically remove locally
    setAnnotations((prev) => {
      const next = prev.filter((a) => a.id !== id);
      saveToStorage(publicationId, next);
      return next;
    });

    // Also delete from API (best-effort)
    try {
      await fetch(
        `/api/annotations?id=${encodeURIComponent(id)}&publicationId=${encodeURIComponent(publicationId)}`,
        { method: "DELETE" }
      );
    } catch {
      // API unavailable — local deletion is still applied
    }

    return true;
  }, [publicationId]);

  const updateAnnotation = useCallback(async (id: string, updates: { note?: string; color?: HighlightColor }): Promise<boolean> => {
    if (!publicationId) return false;

    // Optimistically update locally
    setAnnotations((prev) => {
      const next = prev.map((a) =>
        a.id === id
          ? { ...a, ...updates, updatedAt: new Date().toISOString() }
          : a
      );
      saveToStorage(publicationId, next);
      return next;
    });

    // Also update via API (best-effort)
    try {
      await fetch("/api/annotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, publicationId, ...updates }),
      });
    } catch {
      // API unavailable — local update is still applied
    }

    return true;
  }, [publicationId]);

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

"use client";

/**
 * AnnotationsPlugin
 *
 * This component lives inside the ThPluginProvider context (rendered as a
 * Thorium Web plugin action Target), giving it access to useEpubNavigator().
 *
 * Text-selection interception strategy
 * ─────────────────────────────────────
 * The StatefulReader hardcodes `textSelected: () => {}` in its listeners
 * object, so we cannot inject a handler via props.  Instead we use a
 * module-level global callback:
 *
 *   window.__wcpAnnotations = { onTextSelected: (event) => … }
 *
 * A MutationObserver + polling loop detects when the navigator iframe is
 * ready, then patches `navigatorInstance.listeners.textSelected` to also
 * call `window.__wcpAnnotations?.onTextSelected`.
 *
 * This is intentionally a proof-of-concept approach.  The recommended
 * open-source contribution would be to add an `onTextSelected` prop to
 * StatefulReader (or expose it via a plugin hook).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useEpubNavigator } from "@edrlab/thorium-web/epub";
import { SelectionToolbar } from "./SelectionToolbar";
import { NoteEditor } from "./NoteEditor";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { useAnnotations, HighlightColor, Locator, HIGHLIGHT_COLORS } from "./useAnnotations";

interface SelectionEvent {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetFrameSrc: string;
}

interface AnnotationsPluginProps {
  publicationId: string;
  isPanelOpen: boolean;
  onClosePanelRequest: () => void;
}

// ─── Global text-selection bridge ────────────────────────────────────────────
// Declared on window so the navigator patch (below) can reach it.
declare global {
  interface Window {
    __wcpAnnotations?: {
      onTextSelected: (event: SelectionEvent) => void;
    };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const AnnotationsPlugin = ({
  publicationId,
  isPanelOpen,
  onClosePanelRequest,
}: AnnotationsPluginProps) => {
  const { getCframes, currentLocator, go } = useEpubNavigator();
  const { highlights, notes, addAnnotation, fetchAnnotations } = useAnnotations(publicationId);

  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionEvent | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const patchedRef = useRef(false);

  // ── Register the global text-selection handler ──────────────────────────
  useEffect(() => {
    window.__wcpAnnotations = {
      onTextSelected: (event: SelectionEvent) => {
        setSelection(event);
      },
    };
    return () => {
      window.__wcpAnnotations = undefined;
    };
  }, []);

  // ── Patch navigatorInstance.listeners.textSelected ──────────────────────
  // We poll until getCframes() returns a non-empty array, then patch.
  useEffect(() => {
    if (patchedRef.current) return;

    const tryPatch = () => {
      const cframes = getCframes();
      if (!cframes || cframes.length === 0) return false;

      // The navigator instance is the object that owns _cframes.
      // We reach it via the framePool parent stored on the cframe.
      // As a fallback we also try the global window reference.
      try {
        // Approach 1: access via cframe's parent navigator reference
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyFrame = cframes[0] as any;
        const nav =
          anyFrame?._navigator ||
          anyFrame?.navigator ||
          anyFrame?.pool?.navigator ||
          // Approach 2: walk up from the iframe to find the navigator
          null;

        if (nav?.listeners) {
          const original = nav.listeners.textSelected;
          nav.listeners.textSelected = (event: SelectionEvent) => {
            original?.(event);
            window.__wcpAnnotations?.onTextSelected(event);
          };
          patchedRef.current = true;
          return true;
        }
      } catch {
        // ignore
      }

      // Approach 3: use a window message listener as a fallback
      // The readium injectables send comms via postMessage; we intercept
      // the raw message before the navigator processes it.
      return false;
    };

    // Poll every 200ms for up to 10 seconds
    const interval = setInterval(() => {
      if (tryPatch()) {
        clearInterval(interval);
      }
    }, 200);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!patchedRef.current) {
        // Fallback: listen for the raw postMessage from the iframe
        setupPostMessageFallback();
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCframes]);

  // ── Fallback: intercept raw postMessage from the readium iframe ──────────
  const setupPostMessageFallback = useCallback(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        data._readium &&
        data.key === "text_selected" &&
        data.data
      ) {
        const sel = data.data;
        window.__wcpAnnotations?.onTextSelected({
          text: sel.text || sel.selectedText || "",
          x: sel.x ?? sel.clientX ?? 0,
          y: sel.y ?? sel.clientY ?? 0,
          width: sel.width ?? 0,
          height: sel.height ?? 0,
          targetFrameSrc: event.source
            ? (event.source as Window).location?.href ?? ""
            : "",
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Apply decorations (highlights) to the iframe ─────────────────────────
  const applyDecorations = useCallback(() => {
    const cframes = getCframes();
    if (!cframes || cframes.length === 0) return;

    const allAnnotated = [...highlights, ...notes];

    for (const cframe of cframes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (cframe as any)?.msg;
      if (!msg) continue;

      // Clear previous decorations
      try {
        msg.send("decorate", { group: "wcp-annotations", action: "clear" }, () => {});
      } catch { /* ignore */ }

      // Add each annotation as a decoration
      for (const annotation of allAnnotated) {
        if (!annotation.locator?.text?.highlight) continue;
        const color = HIGHLIGHT_COLORS[annotation.color as HighlightColor] || "#FFFF00";
        try {
          msg.send("decorate", {
            group: "wcp-annotations",
            action: "add",
            decoration: {
              id: annotation.id,
              locator: annotation.locator,
              style: { tint: color },
            },
          }, () => {});
        } catch { /* ignore */ }
      }
    }
  }, [getCframes, highlights, notes]);

  useEffect(() => {
    const timer = setTimeout(applyDecorations, 500);
    return () => clearTimeout(timer);
  }, [applyDecorations]);

  // ── Handle highlight action ───────────────────────────────────────────────
  const handleHighlight = useCallback(async (color: HighlightColor) => {
    if (!selection) return;
    const loc = currentLocator();
    if (!loc) return;

    const annotationLocator: Locator = {
      href: loc.href,
      type: (loc as { type?: string }).type || "application/xhtml+xml",
      title: (loc as { title?: string }).title,
      locations: {
        progression: loc.locations?.progression,
        position: loc.locations?.position,
        totalProgression: loc.locations?.totalProgression,
      },
      text: { highlight: selection.text },
    };

    await addAnnotation({ type: "highlight", locator: annotationLocator, color });
    setSelection(null);
    setTimeout(applyDecorations, 100);
  }, [selection, currentLocator, addAnnotation, applyDecorations]);

  // ── Handle note action ────────────────────────────────────────────────────
  const handleOpenNote = useCallback(() => {
    setPendingSelection(selection);
    setIsNoteEditorOpen(true);
    setSelection(null);
  }, [selection]);

  const handleSaveNote = useCallback(async (noteText: string, color: HighlightColor) => {
    if (!pendingSelection) return;
    const loc = currentLocator();
    if (!loc) return;

    const annotationLocator: Locator = {
      href: loc.href,
      type: (loc as { type?: string }).type || "application/xhtml+xml",
      title: (loc as { title?: string }).title,
      locations: {
        progression: loc.locations?.progression,
        position: loc.locations?.position,
        totalProgression: loc.locations?.totalProgression,
      },
      text: { highlight: pendingSelection.text },
    };

    await addAnnotation({ type: "note", locator: annotationLocator, color, note: noteText });
    setIsNoteEditorOpen(false);
    setPendingSelection(null);
    setTimeout(applyDecorations, 100);
  }, [pendingSelection, currentLocator, addAnnotation, applyDecorations]);

  // ── Navigate to a locator ─────────────────────────────────────────────────
  const handleGoToLocator = useCallback((locator: Locator) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    go(locator as any, true, () => {});
    onClosePanelRequest();
  }, [go, onClosePanelRequest]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Floating selection toolbar */}
      <SelectionToolbar
        selection={selection}
        onHighlight={handleHighlight}
        onNote={handleOpenNote}
        onDismiss={() => setSelection(null)}
      />

      {/* Note editor modal */}
      <NoteEditor
        isOpen={isNoteEditorOpen}
        selectedText={pendingSelection?.text || ""}
        onSave={handleSaveNote}
        onClose={() => {
          setIsNoteEditorOpen(false);
          setPendingSelection(null);
        }}
      />

      {/* Annotations side panel */}
      {isPanelOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "320px",
            background: "#fff",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.14)",
            zIndex: 8000,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 16px 12px",
              borderBottom: "1px solid #e8e8e8",
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "15px", color: "#1a1a1a" }}>
              Annotations
            </span>
            <button
              onClick={onClosePanelRequest}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "18px",
                color: "#888",
                padding: "4px 8px",
                borderRadius: "4px",
                lineHeight: 1,
              }}
              aria-label="Close annotations panel"
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <AnnotationsPanel
              publicationId={publicationId}
              onGoToLocator={handleGoToLocator}
            />
          </div>
        </div>
      )}
    </>
  );
};

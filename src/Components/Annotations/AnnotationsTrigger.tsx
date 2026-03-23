"use client";

/**
 * AnnotationsTrigger
 *
 * The Thorium Web plugin "Trigger" component — rendered in the reader header
 * toolbar.  This component serves two purposes:
 *
 * 1. It renders the toolbar button (bookmark + annotations panel toggle) using
 *    Thorium's StatefulActionIcon so it integrates seamlessly with the reader UI.
 *
 * 2. Because Trigger components are always mounted, this is also where we
 *    register the text-selection listener and render the floating SelectionToolbar
 *    and NoteEditor.  This ensures annotations are always interactive while reading.
 *
 * Architecture note — text selection
 * ────────────────────────────────────
 * The Readium iframes are same-origin (served from the same Next.js host), so
 * we can inject a `selectionchange` listener directly into each iframe's document.
 * When the user finishes selecting text (mouseup / touchend), we read the
 * Selection object, compute the absolute position in the parent window, and
 * update the React state to show the SelectionToolbar at that position.
 *
 * We poll for new iframes every second so that the listener is re-attached
 * whenever the navigator loads a new spine item.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  StatefulActionIcon,
  StatefulOverflowMenuItem,
  StatefulActionTriggerProps,
  useAppDispatch,
  useAppSelector,
  setActionOpen,
  setHovering,
  useNavigator,
} from "@edrlab/thorium-web/epub";
import { ThActionsTriggerVariant } from "@edrlab/thorium-web/core/components";
import { CustomKeys, PlaygroundActionsKeys } from "@/preferences/preferences";
import { usePreferences } from "@edrlab/thorium-web/epub";
import { useAnnotations, HighlightColor, Locator, HIGHLIGHT_COLORS } from "./useAnnotations";
import { SelectionToolbar } from "./SelectionToolbar";
import { NoteEditor } from "./NoteEditor";
import { BookmarkButton } from "./BookmarkButton";

// ─── Publication ID resolution ────────────────────────────────────────────────
function usePublicationId(): string {
  if (typeof window === "undefined") return "unknown";
  const parts = window.location.pathname.split("/");
  const readIdx = parts.indexOf("read");
  if (readIdx !== -1 && parts[readIdx + 1]) {
    return decodeURIComponent(parts[readIdx + 1]);
  }
  return "unknown";
}

// ─── Text selection event shape ───────────────────────────────────────────────
interface SelectionEvent {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The iframe element the selection came from, so we can read its locator */
  sourceIframe?: HTMLIFrameElement;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AnnotationsTrigger = ({ variant }: StatefulActionTriggerProps) => {
  const { preferences } = usePreferences<CustomKeys>();
  const actionState = useAppSelector(
    (state) => state.actions.keys[PlaygroundActionsKeys.annotations]
  );
  const dispatch = useAppDispatch();
  const { getCframes, currentLocator } = useNavigator();

  const publicationId = usePublicationId();
  const { highlights, notes, addAnnotation } = useAnnotations(publicationId);

  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionEvent | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);

  // Track which iframes we've already injected into
  const injectedIframes = useRef<Set<HTMLIFrameElement>>(new Set());

  // ── Toggle panel open/close ─────────────────────────────────────────────
  const setOpen = useCallback(
    (value: boolean) => {
      dispatch(setActionOpen({ key: PlaygroundActionsKeys.annotations, isOpen: value }));
      if (!value) dispatch(setHovering(false));
    },
    [dispatch]
  );

  // ── Dismiss selection when clicking outside the toolbar ─────────────────
  const dismissSelection = useCallback(() => setSelection(null), []);

  // ── Inject selection listeners into Readium iframes ─────────────────────
  // The iframes are same-origin, so we can access their documents directly.
  // We use a polling interval to catch new iframes as the navigator loads
  // new spine items.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const injectIntoIframe = (iframe: HTMLIFrameElement) => {
      if (injectedIframes.current.has(iframe)) return;

      try {
        const iframeWin = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument;
        if (!iframeWin || !iframeDoc) return;

        // We listen on mouseup / touchend rather than selectionchange so we
        // only fire once the user has finished selecting (not on every character).
        const handlePointerUp = () => {
          // Small delay so the selection is finalised
          setTimeout(() => {
            const sel = iframeWin.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

            const text = sel.toString().trim();
            if (text.length === 0) return;

            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            // Translate iframe-relative coords to parent-window coords
            const iframeRect = iframe.getBoundingClientRect();
            const absX = iframeRect.left + rect.left;
            const absY = iframeRect.top + rect.top;

            setSelection({
              text,
              x: absX,
              y: absY,
              width: rect.width,
              height: rect.height,
              sourceIframe: iframe,
            });
          }, 50);
        };

        // Dismiss toolbar when the user clicks without selecting
        const handlePointerDown = () => {
          const sel = iframeWin.getSelection();
          if (!sel || sel.isCollapsed) {
            setSelection(null);
          }
        };

        iframeDoc.addEventListener("mouseup", handlePointerUp);
        iframeDoc.addEventListener("touchend", handlePointerUp);
        iframeDoc.addEventListener("mousedown", handlePointerDown);

        injectedIframes.current.add(iframe);
      } catch {
        // Cross-origin or not yet loaded — skip silently
      }
    };

    const scanForIframes = () => {
      const iframes = document.querySelectorAll<HTMLIFrameElement>(
        "iframe.readium-navigator-iframe"
      );
      iframes.forEach(injectIntoIframe);
    };

    // Scan immediately and then every second
    scanForIframes();
    const interval = setInterval(scanForIframes, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Apply decorations (highlights) to the iframe ─────────────────────────
  const applyDecorations = useCallback(() => {
    const cframes = getCframes?.();
    if (!cframes || cframes.length === 0) return;

    const annotated = [...highlights, ...notes];

    for (const cframe of cframes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (cframe as any)?.msg;
      if (!msg) continue;

      try {
        msg.send("decorate", { group: "wcp-annotations", action: "clear" }, () => {});
      } catch {
        /* ignore */
      }

      for (const annotation of annotated) {
        if (!annotation.locator?.text?.highlight) continue;
        const color =
          HIGHLIGHT_COLORS[annotation.color as HighlightColor] ?? "#FFE066";
        try {
          msg.send(
            "decorate",
            {
              group: "wcp-annotations",
              action: "add",
              decoration: {
                id: annotation.id,
                locator: annotation.locator,
                style: { tint: color },
              },
            },
            () => {}
          );
        } catch {
          /* ignore */
        }
      }
    }
  }, [getCframes, highlights, notes]);

  // Re-apply decorations whenever the annotation list changes
  useEffect(() => {
    const timer = setTimeout(applyDecorations, 600);
    return () => clearTimeout(timer);
  }, [applyDecorations]);

  // ── Handle highlight action ───────────────────────────────────────────────
  const handleHighlight = useCallback(
    async (color: HighlightColor) => {
      if (!selection) return;
      const loc = currentLocator?.();
      if (!loc) return;

      const annotationLocator: Locator = {
        href: loc.href,
        type: (loc as { type?: string }).type ?? "application/xhtml+xml",
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
      setTimeout(applyDecorations, 200);
    },
    [selection, currentLocator, addAnnotation, applyDecorations]
  );

  // ── Handle note action ────────────────────────────────────────────────────
  const handleOpenNote = useCallback(() => {
    setPendingSelection(selection);
    setIsNoteEditorOpen(true);
    setSelection(null);
  }, [selection]);

  const handleSaveNote = useCallback(
    async (noteText: string, color: HighlightColor) => {
      if (!pendingSelection) return;
      const loc = currentLocator?.();
      if (!loc) return;

      const annotationLocator: Locator = {
        href: loc.href,
        type: (loc as { type?: string }).type ?? "application/xhtml+xml",
        title: (loc as { title?: string }).title,
        locations: {
          progression: loc.locations?.progression,
          position: loc.locations?.position,
          totalProgression: loc.locations?.totalProgression,
        },
        text: { highlight: pendingSelection.text },
      };

      await addAnnotation({
        type: "note",
        locator: annotationLocator,
        color,
        note: noteText,
      });
      setIsNoteEditorOpen(false);
      setPendingSelection(null);
      setTimeout(applyDecorations, 200);
    },
    [pendingSelection, currentLocator, addAnnotation, applyDecorations]
  );

  // ── Total annotation count for badge ─────────────────────────────────────
  const total = highlights.length + notes.length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Bookmark button — always visible in toolbar */}
      <BookmarkButton publicationId={publicationId} />

      {/* Annotations panel toggle */}
      {variant && variant === ThActionsTriggerVariant.menu ? (
        <StatefulOverflowMenuItem
          label="Annotations"
          SVGIcon={() => (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          )}
          shortcut={
            preferences.actions.keys[PlaygroundActionsKeys.annotations]?.shortcut ?? null
          }
          id={PlaygroundActionsKeys.annotations}
          onAction={() => setOpen(!actionState?.isOpen)}
        />
      ) : (
        <StatefulActionIcon
          visibility={
            preferences.actions.keys[PlaygroundActionsKeys.annotations]?.visibility
          }
          aria-label="Annotations"
          placement="bottom"
          tooltipLabel="Annotations"
          onPress={() => setOpen(!actionState?.isOpen)}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            {total > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-6px",
                  background: "#0ea5e9",
                  color: "#fff",
                  fontSize: "9px",
                  fontWeight: 700,
                  borderRadius: "8px",
                  padding: "0 3px",
                  minWidth: "14px",
                  height: "14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
              >
                {total > 99 ? "99+" : total}
              </span>
            )}
          </span>
        </StatefulActionIcon>
      )}

      {/* Floating selection toolbar — fixed-positioned at selection coordinates */}
      <SelectionToolbar
        selection={selection}
        onHighlight={handleHighlight}
        onNote={handleOpenNote}
        onDismiss={dismissSelection}
      />

      {/* Note editor modal */}
      <NoteEditor
        isOpen={isNoteEditorOpen}
        selectedText={pendingSelection?.text ?? ""}
        onSave={handleSaveNote}
        onClose={() => {
          setIsNoteEditorOpen(false);
          setPendingSelection(null);
        }}
      />
    </>
  );
};

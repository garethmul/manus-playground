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
 * 2. Because Trigger components are always mounted (unlike Target/Container
 *    components which only mount when the panel is open), this is also where we
 *    register the text-selection listener and render the floating SelectionToolbar
 *    and NoteEditor.  This ensures annotations are always interactive while reading.
 *
 * Architecture note
 * ─────────────────
 * Thorium Web's StatefulReader hardcodes `textSelected: () => {}` in its
 * listeners object, so we cannot inject a handler via props.  Instead we
 * intercept the raw `window.postMessage` events that the Readium iframe sends
 * when the user selects text.  The message format is:
 *
 *   { _readium: 1, key: "text_selected", data: { text, x, y, width, height } }
 *
 * This is a proof-of-concept approach.  The recommended open-source
 * contribution would be to add an `onTextSelected` prop to StatefulReader.
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
// The publicationId is derived from the URL path at runtime.
function usePublicationId(): string {
  if (typeof window === "undefined") return "unknown";
  const parts = window.location.pathname.split("/");
  // URL pattern: /read/[identifier]
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
  const { highlights, notes, addAnnotation, fetchAnnotations } =
    useAnnotations(publicationId);

  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionEvent | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);

  // ── Toggle panel open/close ─────────────────────────────────────────────
  const setOpen = useCallback(
    (value: boolean) => {
      dispatch(setActionOpen({ key: PlaygroundActionsKeys.annotations, isOpen: value }));
      if (!value) dispatch(setHovering(false));
    },
    [dispatch]
  );

  // ── Listen for text selection postMessages from the Readium iframe ──────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        data._readium === 1 &&
        data.key === "text_selected" &&
        data.data
      ) {
        const sel = data.data;
        const text: string = sel.text || sel.selectedText || "";
        if (text.trim().length === 0) {
          // Empty selection — dismiss toolbar
          setSelection(null);
          return;
        }
        setSelection({
          text,
          x: sel.x ?? sel.clientX ?? 0,
          y: sel.y ?? sel.clientY ?? 0,
          width: sel.width ?? 0,
          height: sel.height ?? 0,
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
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

      // Clear previous decorations for this group
      try {
        msg.send("decorate", { group: "wcp-annotations", action: "clear" }, () => {});
      } catch {
        /* ignore */
      }

      // Re-add each annotation as a decoration
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

      {/* Floating selection toolbar — rendered at document root level via fixed positioning */}
      <SelectionToolbar
        selection={selection}
        onHighlight={handleHighlight}
        onNote={handleOpenNote}
        onDismiss={() => setSelection(null)}
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

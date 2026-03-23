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
 * Architecture note — notes vs highlights
 * ─────────────────────────────────────────
 * Highlights use the navigator's tint-based decoration (coloured background).
 * Notes use the same decoration API but we inject a <style> tag into each iframe
 * that overrides the navigator's CSS for note groups to render as underlines
 * instead of background colours.  When the user clicks on an underlined note,
 * we show a NotePopover with the note text and edit/delete actions.
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
import { useAnnotations, HighlightColor, Locator, HIGHLIGHT_COLORS, Annotation } from "./useAnnotations";
import { SelectionToolbar } from "./SelectionToolbar";
import { NoteEditor } from "./NoteEditor";
import { NotePopover } from "./NotePopover";
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
  /** The iframe element the selection came from, so we can clear it later */
  sourceIframe?: HTMLIFrameElement;
}

// ─── Note popover state ───────────────────────────────────────────────────────
interface NotePopoverState {
  note: Annotation;
  anchorX: number;
  anchorY: number;
}

// ─── Toast notification ───────────────────────────────────────────────────────
interface ToastState {
  message: string;
  visible: boolean;
}

// ─── Note decoration group name ───────────────────────────────────────────────
const NOTE_GROUP_PREFIX = "wcp-notes";

// ─── Note tint colours ────────────────────────────────────────────────────────
// We use slightly different hex values for note tints vs highlight tints so the
// MutationObserver can distinguish which readium-decoration-N groups are notes.
// These are the canonical underline colours shown to the user.
const NOTE_TINT_COLORS: Record<HighlightColor, string> = {
  yellow: "#FFC107",
  green:  "#4CAF50",
  blue:   "#2196F3",
  red:    "#F44336",
  purple: "#9C27B0",
  orange: "#FF9800",
};

// Build a reverse-lookup: tint hex → underline colour (same value, just for clarity)
const NOTE_TINT_SET = new Set(Object.values(NOTE_TINT_COLORS).map(c => c.toLowerCase()));

// ─── Component ────────────────────────────────────────────────────────────────

export const AnnotationsTrigger = ({ variant }: StatefulActionTriggerProps) => {
  const { preferences } = usePreferences<CustomKeys>();
  const actionState = useAppSelector(
    (state) => state.actions.keys[PlaygroundActionsKeys.annotations]
  );
  const dispatch = useAppDispatch();
  const { getCframes, currentLocator } = useNavigator();

  const publicationId = usePublicationId();
  const { highlights, notes, addAnnotation, deleteAnnotation, updateAnnotation } = useAnnotations(publicationId);

  const [selection, setSelection] = useState<SelectionEvent | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SelectionEvent | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Annotation | null>(null);
  const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null);
  const [toast, setToast] = useState<ToastState>({ message: "", visible: false });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track which iframes we've already injected into
  const injectedIframes = useRef<Set<HTMLIFrameElement>>(new Set());

  // Keep a ref to the current notes list so the iframe click handler can access it
  const notesRef = useRef<Annotation[]>(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, visible: true });
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 1800);
  }, []);

  // ── Clear selection in the source iframe ────────────────────────────────────
  const clearIframeSelection = useCallback((iframe?: HTMLIFrameElement) => {
    try {
      if (iframe?.contentWindow) {
        iframe.contentWindow.getSelection()?.removeAllRanges();
      }
    } catch {
      // Cross-origin or unavailable — ignore
    }
  }, []);

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

  // ── Inject a MutationObserver into an iframe to patch note decoration CSS ──
  // The Readium navigator maps our group name (e.g. "wcp-notes-blue") to an
  // internal sequential ID (e.g. "readium-decoration-8") and injects a <style>
  // element with CSS like:
  //   ::highlight(readium-decoration-8) { background-color: #2196F3 }
  // We can't predict the internal ID, so we use a MutationObserver to watch for
  // new style[data-readium] elements.  When one appears, if its background-color
  // matches one of our NOTE_TINT_COLORS we replace the CSS with underline styling.
  const injectNoteStyles = useCallback((iframe: HTMLIFrameElement) => {
    try {
      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      // Avoid double-injecting the observer
      if (iframeDoc.getElementById("wcp-note-observer-marker")) return;
      const marker = iframeDoc.createElement("meta");
      marker.id = "wcp-note-observer-marker";
      iframeDoc.head.appendChild(marker);

      const patchStyleIfNote = (styleEl: HTMLStyleElement) => {
        const css = styleEl.textContent ?? "";
        // Extract the background-color value from the navigator's injected CSS
        const bgMatch = css.match(/background-color:\s*([^;]+);/);
        if (!bgMatch) return;
        const bgColor = bgMatch[1].trim().toLowerCase();
        if (!NOTE_TINT_SET.has(bgColor)) return;

        // This is a note group — replace background with underline
        const groupMatch = css.match(/::highlight\(([^)]+)\)/);
        if (!groupMatch) return;
        const groupName = groupMatch[1];

        styleEl.textContent = `
          ::highlight(${groupName}) {
            background-color: transparent !important;
            color: inherit !important;
            text-decoration: underline !important;
            text-decoration-color: ${bgColor} !important;
            text-decoration-thickness: 2px !important;
            text-underline-offset: 3px !important;
          }
        `;
      };

      // Patch any existing readium decoration styles (in case they were added before we ran)
      iframeDoc.querySelectorAll<HTMLStyleElement>("style[data-readium]").forEach(patchStyleIfNote);

      // Watch for new ones
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as Element).tagName.toUpperCase() === "STYLE" &&
              (node as HTMLStyleElement).dataset?.readium === "true"
            ) {
              patchStyleIfNote(node as HTMLStyleElement);
            }
          }
          // Also handle text content changes on existing style elements
          if (
            mutation.type === "characterData" &&
            mutation.target.parentElement?.tagName.toUpperCase() === "STYLE" &&
            (mutation.target.parentElement as HTMLStyleElement).dataset?.readium === "true"
          ) {
            patchStyleIfNote(mutation.target.parentElement as HTMLStyleElement);
          }
        }
      });

      observer.observe(iframeDoc.head, { childList: true, subtree: true, characterData: true });
    } catch {
      // ignore
    }
  }, []);

  // ── Inject selection listeners into Readium iframes ─────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const injectIntoIframe = (iframe: HTMLIFrameElement) => {
      if (injectedIframes.current.has(iframe)) return;

      try {
        const iframeWin = iframe.contentWindow;
        const iframeDoc = iframe.contentDocument;
        if (!iframeWin || !iframeDoc) return;

        // Inject underline styles for note groups
        injectNoteStyles(iframe);

        // We listen on mouseup / touchend rather than selectionchange so we
        // only fire once the user has finished selecting (not on every character).
        const handlePointerUp = (e: MouseEvent | TouchEvent) => {
          // Small delay so the selection is finalised
          setTimeout(() => {
            const sel = iframeWin.getSelection();

            // If there is a real text selection, show the toolbar
            if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
              const text = sel.toString().trim();
              if (text.length > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0) {
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
                  return;
                }
              }
            }

            // No text selection — check if the click landed on a note underline
            // by checking whether the click point is within any note's text range.
            const clientX = "clientX" in e ? e.clientX : e.changedTouches[0].clientX;
            const clientY = "clientY" in e ? e.clientY : e.changedTouches[0].clientY;

            // Use caretRangeFromPoint to find what was clicked
            const caretRange = iframeDoc.caretRangeFromPoint?.(clientX, clientY);
            if (!caretRange) return;

            // Check all note CSS Highlight ranges to see if the caret is inside one.
            // The navigator maps our group names to internal readium-decoration-N IDs,
            // so we iterate ALL CSS highlight groups and match by range text content.
            const currentNotes = notesRef.current;
            // Build a quick lookup: highlight text → note (for notes on this page)
            const noteByText = new Map<string, typeof currentNotes[0]>();
            for (const note of currentNotes) {
              if (note.type !== "note") continue;
              const txt = note.locator?.text?.highlight;
              if (txt) noteByText.set(txt, note);
            }
            if (noteByText.size === 0) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const highlights = (iframeWin as any).CSS?.highlights;
            if (!highlights) return;

            for (const [, highlightGroup] of highlights) {
              for (const range of highlightGroup) {
                try {
                  // Check if the caret position is within this range
                  const startCmp = caretRange.compareBoundaryPoints(Range.START_TO_START, range);
                  const endCmp = caretRange.compareBoundaryPoints(Range.END_TO_END, range);
                  if (startCmp >= 0 && endCmp <= 0) {
                    // Click is inside this range — check if it's a note
                    const rangeText = range.toString();
                    const matchedNote = noteByText.get(rangeText);
                    if (matchedNote) {
                      const iframeRect = iframe.getBoundingClientRect();
                      const absX = iframeRect.left + clientX;
                      const absY = iframeRect.top + clientY;
                      setNotePopover({ note: matchedNote, anchorX: absX, anchorY: absY });
                      return;
                    }
                  }
                } catch {
                  // Range comparison may throw if ranges are in different documents
                }
              }
            }
          }, 50);
        };

        // Dismiss toolbar when the user clicks without selecting
        const handlePointerDown = () => {
          const sel = iframeWin.getSelection();
          if (!sel || sel.isCollapsed) {
            setSelection(null);
          }
        };

        iframeDoc.addEventListener("mouseup", handlePointerUp as EventListener);
        iframeDoc.addEventListener("touchend", handlePointerUp as EventListener);
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
  }, [injectNoteStyles]);

  // Re-inject note styles when iframes reload (e.g. page turn)
  // We do this by clearing the injected set when the URL changes
  useEffect(() => {
    injectedIframes.current.clear();
  }, [publicationId]);

  // ── Apply decorations (highlights) to the iframe ─────────────────────────
  // Highlights: one group per colour, tint = background colour
  // Notes: one group per colour, tint = underline colour (CSS overrides background)
  const applyDecorations = useCallback(() => {
    const cframes = getCframes?.();
    if (!cframes || cframes.length === 0) return;

    // Group highlights by colour
    const highlightsByColor: Record<string, typeof highlights> = {};
    for (const annotation of highlights) {
      if (!annotation.locator?.text?.highlight) continue;
      const colorKey = annotation.color ?? "yellow";
      if (!highlightsByColor[colorKey]) highlightsByColor[colorKey] = [];
      highlightsByColor[colorKey].push(annotation);
    }

    // Group notes by colour (separate groups from highlights)
    const notesByColor: Record<string, typeof notes> = {};
    for (const annotation of notes) {
      if (!annotation.locator?.text?.highlight) continue;
      const colorKey = annotation.color ?? "yellow";
      if (!notesByColor[colorKey]) notesByColor[colorKey] = [];
      notesByColor[colorKey].push(annotation);
    }

    for (const cframe of cframes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (cframe as any)?.msg;
      if (!msg) continue;

      // Clear all highlight groups
      for (const colorKey of Object.keys(HIGHLIGHT_COLORS)) {
        try {
          msg.send("decorate", { group: `wcp-annotations-${colorKey}`, action: "clear" }, () => {});
        } catch { /* ignore */ }
      }

      // Clear all note groups
      for (const colorKey of Object.keys(HIGHLIGHT_COLORS)) {
        try {
          msg.send("decorate", { group: `${NOTE_GROUP_PREFIX}-${colorKey}`, action: "clear" }, () => {});
        } catch { /* ignore */ }
      }

      // Add highlights (coloured background)
      for (const [colorKey, annotations] of Object.entries(highlightsByColor)) {
        const tint = HIGHLIGHT_COLORS[colorKey as HighlightColor] ?? "#FFE066";
        for (const annotation of annotations) {
          try {
            msg.send(
              "decorate",
              {
                group: `wcp-annotations-${colorKey}`,
                action: "add",
                decoration: {
                  id: annotation.id,
                  locator: annotation.locator,
                  style: { tint },
                },
              },
              () => {}
            );
          } catch { /* ignore */ }
        }
      }

      // Add notes (underline — NOTE_TINT_COLORS used so MutationObserver can identify them)
      for (const [colorKey, annotations] of Object.entries(notesByColor)) {
        const tint = NOTE_TINT_COLORS[colorKey as HighlightColor] ?? NOTE_TINT_COLORS.yellow;
        for (const annotation of annotations) {
          try {
            msg.send(
              "decorate",
              {
                group: `${NOTE_GROUP_PREFIX}-${colorKey}`,
                action: "add",
                decoration: {
                  id: annotation.id,
                  locator: annotation.locator,
                  // tint is still passed so the navigator registers the range;
                  // the injected CSS overrides background-color → transparent + underline
                  style: { tint },
                },
              },
              () => {}
            );
          } catch { /* ignore */ }
        }
      }
    }

    // Re-inject note styles into all current iframes (in case they reloaded)
    document.querySelectorAll<HTMLIFrameElement>("iframe.readium-navigator-iframe")
      .forEach(injectNoteStyles);
  }, [getCframes, highlights, notes, injectNoteStyles]);

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

      clearIframeSelection(selection.sourceIframe);
      setSelection(null);

      await addAnnotation({ type: "highlight", locator: annotationLocator, color });
      showToast("Highlight added ✓");
      setTimeout(applyDecorations, 200);
    },
    [selection, currentLocator, addAnnotation, applyDecorations, clearIframeSelection, showToast]
  );

  // ── Handle note action ────────────────────────────────────────────────────
  const handleOpenNote = useCallback(() => {
    setPendingSelection(selection);
    setEditingNote(null);
    setIsNoteEditorOpen(true);
    setSelection(null);
  }, [selection]);

  const handleSaveNote = useCallback(
    async (noteText: string, color: HighlightColor) => {
      const loc = currentLocator?.();
      if (!loc) return;

      if (editingNote) {
        // Updating an existing note
        await updateAnnotation(editingNote.id, { note: noteText, color });
        setIsNoteEditorOpen(false);
        setEditingNote(null);
        showToast("Note updated ✓");
        setTimeout(applyDecorations, 200);
        return;
      }

      if (!pendingSelection) return;

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

      clearIframeSelection(pendingSelection.sourceIframe);

      await addAnnotation({
        type: "note",
        locator: annotationLocator,
        color,
        note: noteText,
      });
      setIsNoteEditorOpen(false);
      setPendingSelection(null);
      showToast("Note saved ✓");
      setTimeout(applyDecorations, 200);
    },
    [pendingSelection, editingNote, currentLocator, addAnnotation, updateAnnotation, applyDecorations, clearIframeSelection, showToast]
  );

  // ── Handle note popover edit ──────────────────────────────────────────────
  const handleEditNote = useCallback((note: Annotation) => {
    setEditingNote(note);
    setPendingSelection(null);
    setIsNoteEditorOpen(true);
  }, []);

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

      {/* Note editor modal — for creating new notes or editing existing ones */}
      <NoteEditor
        isOpen={isNoteEditorOpen}
        selectedText={editingNote?.locator?.text?.highlight ?? pendingSelection?.text ?? ""}
        existingNote={editingNote}
        onSave={handleSaveNote}
        onDelete={editingNote ? () => {
          deleteAnnotation(editingNote.id);
          setIsNoteEditorOpen(false);
          setEditingNote(null);
          showToast("Note deleted");
          setTimeout(applyDecorations, 200);
        } : undefined}
        onClose={() => {
          setIsNoteEditorOpen(false);
          setPendingSelection(null);
          setEditingNote(null);
        }}
      />

      {/* Note popover — shown when user clicks an underlined note */}
      {notePopover && (
        <NotePopover
          note={notePopover.note}
          anchorX={notePopover.anchorX}
          anchorY={notePopover.anchorY}
          onEdit={handleEditNote}
          onDelete={(id) => {
            deleteAnnotation(id);
            showToast("Note deleted");
            setTimeout(applyDecorations, 200);
          }}
          onClose={() => setNotePopover(null)}
        />
      )}

      {/* Toast notification — brief confirmation after highlight / note */}
      {toast.visible && (
        <div
          style={{
            position: "fixed",
            bottom: "32px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.92)",
            color: "#f8fafc",
            padding: "10px 20px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            zIndex: 99999,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            letterSpacing: "0.01em",
          }}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </>
  );
};

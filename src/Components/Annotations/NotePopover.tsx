"use client";

/**
 * NotePopover
 *
 * Shown when the user clicks on an underlined note in the reader.
 * Displays the quoted text, the note content, and Edit / Delete actions.
 * Matches the mobile app UX: a bottom sheet-style panel with a left-border
 * quote, the note text, and icon buttons.
 */

import { useEffect, useRef, useState } from "react";
import { Annotation, HighlightColor, HIGHLIGHT_COLORS } from "./useAnnotations";

interface NotePopoverProps {
  note: Annotation;
  /** Absolute position (px) in the parent window where the click occurred */
  anchorX: number;
  anchorY: number;
  onEdit: (note: Annotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export const NotePopover = ({
  note,
  anchorX,
  anchorY,
  onEdit,
  onDelete,
  onClose,
}: NotePopoverProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: anchorY + 16, left: anchorX });

  // Adjust position so the popover stays within the viewport
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchorY + 16;
    let left = anchorX - rect.width / 2;

    // Keep within horizontal bounds
    if (left < 12) left = 12;
    if (left + rect.width > vw - 12) left = vw - rect.width - 12;

    // If it would go below the viewport, show above the anchor
    if (top + rect.height > vh - 12) {
      top = anchorY - rect.height - 8;
    }

    setPosition({ top, left });
  }, [anchorX, anchorY]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture so we get the event before the iframe injection
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [onClose]);

  const color = note.color ?? "yellow";
  const borderColor = HIGHLIGHT_COLORS[color as HighlightColor] ?? "#FFE066";
  const displayText = (note.locator?.text?.highlight ?? "").length > 300
    ? (note.locator?.text?.highlight ?? "").substring(0, 300) + "…"
    : (note.locator?.text?.highlight ?? "");

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 99998,
        background: "#fff",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
        width: "min(360px, calc(100vw - 24px))",
        padding: "16px",
        fontFamily: "inherit",
      }}
      role="dialog"
      aria-label="Note"
    >
      {/* Quoted text with left border */}
      {displayText && (
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "12px",
            paddingBottom: "12px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div
            style={{
              width: "3px",
              borderRadius: "2px",
              background: borderColor,
              flexShrink: 0,
              minHeight: "100%",
            }}
          />
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              lineHeight: "1.6",
              color: "#444",
              fontStyle: "italic",
            }}
          >
            {displayText}
          </p>
        </div>
      )}

      {/* Note text */}
      {note.note ? (
        <p
          style={{
            margin: "0 0 14px 0",
            fontSize: "14px",
            lineHeight: "1.6",
            color: "#222",
          }}
        >
          {note.note}
        </p>
      ) : (
        <p
          style={{
            margin: "0 0 14px 0",
            fontSize: "13px",
            lineHeight: "1.5",
            color: "#aaa",
            fontStyle: "italic",
          }}
        >
          No note text — tap Edit to add one.
        </p>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Delete */}
        <button
          onClick={() => {
            onDelete(note.id);
            onClose();
          }}
          style={{
            background: "#fff0f0",
            border: "none",
            borderRadius: "50%",
            width: "40px",
            height: "40px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            transition: "background 0.15s",
          }}
          aria-label="Delete note"
          onMouseOver={(e) => (e.currentTarget.style.background = "#ffd5d5")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#fff0f0")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>

        {/* Edit */}
        <button
          onClick={() => {
            onEdit(note);
            onClose();
          }}
          style={{
            background: "#e8e8e8",
            border: "none",
            borderRadius: "50%",
            width: "40px",
            height: "40px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            transition: "background 0.15s, color 0.15s",
          }}
          aria-label="Edit note"
          onMouseOver={(e) => (e.currentTarget.style.background = "#0ea5e9")}
          onMouseOut={(e) => (e.currentTarget.style.background = "#e8e8e8")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./annotations.module.css";
import { HighlightColor, HIGHLIGHT_COLORS } from "./useAnnotations";

interface SelectionEvent {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionToolbarProps {
  selection: SelectionEvent | null;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onDismiss: () => void;
}

export const SelectionToolbar = ({
  selection,
  onHighlight,
  onNote,
  onDismiss,
}: SelectionToolbarProps) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showColors, setShowColors] = useState(false);

  useEffect(() => {
    if (!selection) {
      setShowColors(false);
    }
  }, [selection]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    if (selection) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selection, onDismiss]);

  if (!selection) return null;

  const colors: HighlightColor[] = ["yellow", "green", "blue", "red", "purple", "orange"];

  return (
    <div
      ref={toolbarRef}
      className={styles.selectionToolbar}
      style={{
        // Position is relative to the reader container; the reader uses position:relative
        // The x/y from the selection event are relative to the iframe viewport
        // We position the toolbar above the selection
        position: "fixed",
        left: `${selection.x + selection.width / 2}px`,
        top: `${selection.y - 8}px`,
        transform: "translate(-50%, -100%)",
        zIndex: 9999,
      }}
    >
      {showColors ? (
        <div className={styles.colorPicker}>
          {colors.map((color) => (
            <button
              key={color}
              className={styles.colorSwatch}
              style={{ backgroundColor: HIGHLIGHT_COLORS[color] }}
              title={color}
              onClick={() => {
                onHighlight(color);
                setShowColors(false);
              }}
              aria-label={`Highlight ${color}`}
            />
          ))}
          <button
            className={styles.toolbarButton}
            onClick={() => setShowColors(false)}
            aria-label="Back"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className={styles.toolbarButtons}>
          <button
            className={styles.toolbarButton}
            onClick={() => setShowColors(true)}
          >
            Highlight
          </button>
          <div className={styles.toolbarDivider} />
          <button
            className={styles.toolbarButton}
            onClick={onNote}
          >
            Note
          </button>
        </div>
      )}
    </div>
  );
};

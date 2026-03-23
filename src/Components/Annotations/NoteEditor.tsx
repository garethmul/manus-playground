"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./annotations.module.css";
import { Annotation, HighlightColor, HIGHLIGHT_COLORS } from "./useAnnotations";

interface NoteEditorProps {
  isOpen: boolean;
  selectedText: string;
  existingNote?: Annotation | null;
  onSave: (noteText: string, color: HighlightColor) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export const NoteEditor = ({
  isOpen,
  selectedText,
  existingNote,
  onSave,
  onDelete,
  onClose,
}: NoteEditorProps) => {
  const [noteText, setNoteText] = useState(existingNote?.note || "");
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(
    existingNote?.color || "blue"
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNoteText(existingNote?.note || "");
      setSelectedColor(existingNote?.color || "blue");
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, existingNote]);

  if (!isOpen) return null;

  const colors: HighlightColor[] = ["yellow", "green", "blue", "red", "purple", "orange"];
  const displayText = selectedText.length > 200
    ? selectedText.substring(0, 200) + "…"
    : selectedText;

  return (
    <div className={styles.noteEditorOverlay} onClick={onClose}>
      <div
        className={styles.noteEditor}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Selected text preview */}
        <div className={styles.noteEditorQuote}>
          <div
            className={styles.noteEditorQuoteBar}
            style={{ backgroundColor: HIGHLIGHT_COLORS[selectedColor] }}
          />
          <p className={styles.noteEditorQuoteText}>{displayText}</p>
        </div>

        {/* Color picker */}
        <div className={styles.noteEditorColorRow}>
          {colors.map((color) => (
            <button
              key={color}
              className={`${styles.colorSwatch} ${selectedColor === color ? styles.colorSwatchSelected : ""}`}
              style={{ backgroundColor: HIGHLIGHT_COLORS[color] }}
              onClick={() => setSelectedColor(color)}
              aria-label={`${color} highlight`}
              aria-pressed={selectedColor === color}
            />
          ))}
        </div>

        {/* Note textarea */}
        <label className={styles.noteEditorLabel}>NOTES</label>
        <textarea
          ref={textareaRef}
          className={styles.noteEditorTextarea}
          placeholder="Notes"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={4}
        />

        {/* Actions */}
        <div className={styles.noteEditorActions}>
          {onDelete && (
            <button
              className={styles.noteEditorDeleteBtn}
              onClick={onDelete}
              aria-label="Delete note"
            >
              🗑
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className={styles.noteEditorSaveBtn}
            onClick={() => onSave(noteText, selectedColor)}
            aria-label="Save note"
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
};

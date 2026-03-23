"use client";

import { useState } from "react";
import styles from "./annotations.module.css";
import { Annotation, HighlightColor, HIGHLIGHT_COLORS, useAnnotations } from "./useAnnotations";
import { NoteEditor } from "./NoteEditor";

type Tab = "bookmarks" | "highlights" | "notes";

interface AnnotationsPanelProps {
  publicationId: string;
  onGoToLocator: (locator: Annotation["locator"]) => void;
}

export const AnnotationsPanel = ({
  publicationId,
  onGoToLocator,
}: AnnotationsPanelProps) => {
  const { bookmarks, highlights, notes, deleteAnnotation, updateAnnotation } =
    useAnnotations(publicationId);
  const [activeTab, setActiveTab] = useState<Tab>("bookmarks");
  const [editingNote, setEditingNote] = useState<Annotation | null>(null);

  const formatProgression = (locator: Annotation["locator"]) => {
    const prog = locator.locations?.progression;
    if (prog !== undefined) {
      return `${Math.round(prog * 100)}% through`;
    }
    return "";
  };

  const getChapterLabel = (locator: Annotation["locator"]) => {
    if (locator.title) return locator.title;
    const href = locator.href;
    const parts = href.split("/");
    return parts[parts.length - 1]?.replace(/\.[^.]+$/, "") || href;
  };

  const renderBookmarks = () => (
    <div className={styles.annotationList}>
      {bookmarks.length === 0 && (
        <p className={styles.emptyState}>No bookmarks yet. Use the bookmark button while reading to save your place.</p>
      )}
      {bookmarks.map((b) => (
        <div key={b.id} className={styles.annotationItem}>
          <button
            className={styles.annotationItemContent}
            onClick={() => onGoToLocator(b.locator)}
          >
            <span className={styles.bookmarkIcon}>🔖</span>
            <div className={styles.annotationItemText}>
              <span className={styles.annotationChapter}>
                {getChapterLabel(b.locator)}
              </span>
              <span className={styles.annotationProgression}>
                {formatProgression(b.locator)}
              </span>
            </div>
          </button>
          <button
            className={styles.annotationDeleteBtn}
            onClick={() => deleteAnnotation(b.id)}
            aria-label="Delete bookmark"
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  );

  const renderHighlights = () => (
    <div className={styles.annotationList}>
      {highlights.length === 0 && (
        <p className={styles.emptyState}>No highlights yet. Select text while reading to highlight it.</p>
      )}
      {highlights.map((h) => (
        <div key={h.id} className={styles.annotationItem}>
          <button
            className={styles.annotationItemContent}
            onClick={() => onGoToLocator(h.locator)}
          >
            <div
              className={styles.highlightColorBar}
              style={{ backgroundColor: HIGHLIGHT_COLORS[h.color as HighlightColor] || "#FFFF00" }}
            />
            <div className={styles.annotationItemText}>
              <span className={styles.annotationQuote}>
                {h.locator.text?.highlight
                  ? h.locator.text.highlight.substring(0, 120) + (h.locator.text.highlight.length > 120 ? "…" : "")
                  : "Highlighted text"}
              </span>
              <span className={styles.annotationProgression}>
                {getChapterLabel(h.locator)} · {formatProgression(h.locator)}
              </span>
            </div>
          </button>
          <button
            className={styles.annotationDeleteBtn}
            onClick={() => deleteAnnotation(h.id)}
            aria-label="Delete highlight"
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  );

  const renderNotes = () => (
    <div className={styles.annotationList}>
      {notes.length === 0 && (
        <p className={styles.emptyState}>No notes yet. Select text while reading and tap &quot;Note&quot; to add one.</p>
      )}
      {notes.map((n) => (
        <div key={n.id} className={styles.annotationItem}>
          <button
            className={styles.annotationItemContent}
            onClick={() => onGoToLocator(n.locator)}
          >
            {/* Underline indicator — matches how notes appear in the reader */}
            <div
              style={{
                width: "4px",
                borderRadius: "2px",
                minHeight: "40px",
                flexShrink: 0,
                alignSelf: "stretch",
                background: `linear-gradient(to bottom, ${HIGHLIGHT_COLORS[n.color as HighlightColor] || "#87CEEB"} 2px, transparent 2px) 0 bottom / 100% 4px no-repeat`,
                borderBottom: `3px solid ${HIGHLIGHT_COLORS[n.color as HighlightColor] || "#87CEEB"}`,
                backgroundColor: "transparent",
              }}
            />
            <div className={styles.annotationItemText}>
              <span
                className={styles.annotationQuote}
                style={{
                  textDecoration: "underline",
                  textDecorationColor: HIGHLIGHT_COLORS[n.color as HighlightColor] || "#87CEEB",
                  textDecorationThickness: "2px",
                  textUnderlineOffset: "3px",
                }}
              >
                {n.locator.text?.highlight
                  ? n.locator.text.highlight.substring(0, 80) + (n.locator.text.highlight.length > 80 ? "…" : "")
                  : "Underlined text"}
              </span>
              {n.note && (
                <span className={styles.annotationNote}>{n.note}</span>
              )}
              <span className={styles.annotationProgression}>
                {getChapterLabel(n.locator)} · {formatProgression(n.locator)}
              </span>
            </div>
          </button>
          <button
            className={styles.annotationEditBtn}
            onClick={() => setEditingNote(n)}
            aria-label="Edit note"
          >
            ✏
          </button>
          <button
            className={styles.annotationDeleteBtn}
            onClick={() => deleteAnnotation(n.id)}
            aria-label="Delete note"
          >
            🗑
          </button>
        </div>
      ))}

      {editingNote && (
        <NoteEditor
          isOpen={true}
          selectedText={editingNote.locator.text?.highlight || ""}
          existingNote={editingNote}
          onSave={async (noteText, color) => {
            await updateAnnotation(editingNote.id, { note: noteText, color });
            setEditingNote(null);
          }}
          onDelete={async () => {
            await deleteAnnotation(editingNote.id);
            setEditingNote(null);
          }}
          onClose={() => setEditingNote(null)}
        />
      )}
    </div>
  );

  return (
    <div className={styles.annotationsPanel}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        {(["bookmarks", "highlights", "notes"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "bookmarks" && bookmarks.length > 0 && (
              <span className={styles.tabBadge}>{bookmarks.length}</span>
            )}
            {tab === "highlights" && highlights.length > 0 && (
              <span className={styles.tabBadge}>{highlights.length}</span>
            )}
            {tab === "notes" && notes.length > 0 && (
              <span className={styles.tabBadge}>{notes.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "bookmarks" && renderBookmarks()}
      {activeTab === "highlights" && renderHighlights()}
      {activeTab === "notes" && renderNotes()}
    </div>
  );
};

"use client";

import { useCallback } from "react";
import { useEpubNavigator } from "@edrlab/thorium-web/epub";
import { useAnnotations, Locator } from "./useAnnotations";
import styles from "./annotations.module.css";

interface BookmarkButtonProps {
  publicationId: string;
}

export const BookmarkButton = ({ publicationId }: BookmarkButtonProps) => {
  const { currentLocator } = useEpubNavigator();
  const { bookmarks, addAnnotation, deleteAnnotation } = useAnnotations(publicationId);

  const currentHref = (() => {
    try {
      return currentLocator()?.href;
    } catch {
      return undefined;
    }
  })();

  const currentBookmark = currentHref
    ? bookmarks.find((b) => b.locator.href === currentHref)
    : undefined;
  const isBookmarked = !!currentBookmark;

  const handleToggle = useCallback(async () => {
    if (isBookmarked && currentBookmark) {
      await deleteAnnotation(currentBookmark.id);
    } else {
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
      };

      await addAnnotation({ type: "bookmark", locator: annotationLocator });
    }
  }, [isBookmarked, currentBookmark, currentLocator, addAnnotation, deleteAnnotation]);

  return (
    <button
      className={`${styles.bookmarkTrigger} ${isBookmarked ? styles.bookmarkTriggerActive : ""}`}
      onClick={handleToggle}
      aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
      title={isBookmarked ? "Remove bookmark" : "Bookmark this page"}
    >
      {isBookmarked ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      )}
    </button>
  );
};

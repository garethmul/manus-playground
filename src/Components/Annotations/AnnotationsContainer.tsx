"use client";

/**
 * AnnotationsContainer
 *
 * The Thorium Web plugin "Target" (Container) component — rendered inside a
 * StatefulSheetWrapper so it integrates with Thorium's docking/sheet system.
 * It displays the AnnotationsPanel with tabs for Bookmarks, Highlights, and Notes.
 *
 * This component is only mounted when the annotations panel is open.
 */

import { useCallback } from "react";
import {
  StatefulActionContainerProps,
  StatefulSheetWrapper,
  useDocking,
  useAppDispatch,
  useAppSelector,
  setActionOpen,
  setHovering,
  useNavigator,
} from "@edrlab/thorium-web/epub";
import { PlaygroundActionsKeys } from "@/preferences/preferences";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { Annotation } from "./useAnnotations";

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

// ─── Component ────────────────────────────────────────────────────────────────

export const AnnotationsContainer = ({ triggerRef }: StatefulActionContainerProps) => {
  const actionState = useAppSelector(
    (state) => state.actions.keys[PlaygroundActionsKeys.annotations]
  );
  const dispatch = useAppDispatch();
  const docking = useDocking(PlaygroundActionsKeys.annotations);
  const sheetType = docking.sheetType;
  const { go } = useNavigator();

  const publicationId = usePublicationId();

  const setOpen = useCallback(
    (value: boolean) => {
      dispatch(setActionOpen({ key: PlaygroundActionsKeys.annotations, isOpen: value }));
      if (!value) dispatch(setHovering(false));
    },
    [dispatch]
  );

  const handleGoToLocator = useCallback(
    (locator: Annotation["locator"]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      go?.(locator as any, true, () => {});
      setOpen(false);
    },
    [go, setOpen]
  );

  return (
    <StatefulSheetWrapper
      sheetType={sheetType}
      sheetProps={{
        id: PlaygroundActionsKeys.annotations,
        triggerRef,
        heading: "Annotations",
        className: "",
        placement: "bottom",
        isOpen: actionState?.isOpen ?? false,
        onOpenChange: setOpen,
        onClosePress: () => setOpen(false),
        docker: docking.getDocker(),
        scrollTopOnFocus: true,
      }}
    >
      <AnnotationsPanel
        publicationId={publicationId}
        onGoToLocator={handleGoToLocator}
      />
    </StatefulSheetWrapper>
  );
};

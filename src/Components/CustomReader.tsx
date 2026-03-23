"use client";

import { PlaygroundActionsKeys } from "@/preferences/preferences";

import { ThPlugin, createDefaultPlugin, StatefulReader, StatefulReaderProps } from "@edrlab/thorium-web/epub";
import { PlaygroundLayoutPresetsTrigger } from "./Actions/LayoutPresets/PlaygroundLayoutPresetsTrigger";
import { PlaygroundLayoutPresetsContainer } from "./Actions/LayoutPresets/PlaygroundLayoutPresetsContainer";
import { PlaygroundReaderSettingsTrigger } from "./Actions/ReaderSettings/PlaygroundReaderSettingsTrigger";
import { PlaygroundReaderSettingsContainer } from "./Actions/ReaderSettings/PlaygroundReaderSettingsContainer";
import { AnnotationsTrigger } from "./Annotations/AnnotationsTrigger";
import { AnnotationsContainer } from "./Annotations/AnnotationsContainer";

export const CustomReader = ({
  rawManifest,
  selfHref
}: Omit<StatefulReaderProps, "plugins"> ) => {
    const defaultPlugin: ThPlugin = createDefaultPlugin();
    const customPlugins: ThPlugin[] = [ defaultPlugin, {
      id: "custom",
      name: "Custom Components",
      description: "Custom components for Readium Playground StatefulReader",
      version: "1.2.0",
      components: {
        actions: {
          [PlaygroundActionsKeys.layoutPresets]: {
            Trigger: PlaygroundLayoutPresetsTrigger,
            Target: PlaygroundLayoutPresetsContainer
          },
          [PlaygroundActionsKeys.readerSettings]: {
            Trigger: PlaygroundReaderSettingsTrigger,
            Target: PlaygroundReaderSettingsContainer
          },
          [PlaygroundActionsKeys.annotations]: {
            Trigger: AnnotationsTrigger,
            Target: AnnotationsContainer
          }
        }
      }
    }];
    
    return (
      <>
        <StatefulReader 
          rawManifest={ rawManifest } 
          selfHref={ selfHref } 
          plugins={ customPlugins }
        />
      </>
    )

}

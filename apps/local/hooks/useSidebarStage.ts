"use client";

import { useMemo } from "react";
import type { ProjectWithAgents } from "@/hooks/useProjects";
import { useTrackerConnections } from "./useTrackerConnections";

export type SidebarStage = "stage1" | "stage2" | "stage3" | "stage4";

export interface TrackerConnectionEntry {
  type: string;
  connected: boolean;
  connectedAt: string;
}

export interface SidebarStageResult {
  stage: SidebarStage;
  loading: boolean;
  show: {
    home: boolean;
    threads: boolean;
    terminal: boolean;
    objectives: boolean;
    objectivesIsNew: boolean;
    tracking: boolean;
    teams: boolean;
    folders: boolean;
    scheduledTasks: boolean;
    envVars: boolean;
    notifications: boolean;
  };
  /** Connected tracker types for sidebar sub-entries */
  trackerConnections: TrackerConnectionEntry[];
}

const ALL_VISIBLE_BASE = {
  home: true,
  threads: true,
  terminal: true,
  objectives: true,
  objectivesIsNew: false,
  tracking: true, // Always true — section is always visible
  teams: true,
  folders: true,
  scheduledTasks: true,
  envVars: true,
  notifications: true,
};

/**
 * Determine which sidebar sections to show.
 * Task Tracking is always visible — shows "+ Connect" when no trackers connected.
 */
export function useSidebarStage(
  project: ProjectWithAgents | null,
): SidebarStageResult {
  const { connections, loading } = useTrackerConnections(project?.id ?? null);

  return useMemo(() => {
    const trackerConnections = connections.map((c) => ({
      type: c.type,
      connected: c.connected,
      connectedAt: c.connectedAt,
    }));

    if (loading) {
      return {
        stage: "stage1",
        loading: true,
        show: { ...ALL_VISIBLE_BASE },
        trackerConnections: [],
      };
    }

    return {
      stage: "stage4",
      loading: false,
      show: { ...ALL_VISIBLE_BASE },
      trackerConnections,
    };
  }, [loading, connections]);
}

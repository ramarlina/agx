"use client";

import { useMemo } from "react";
import type { ProjectWithAgents } from "@/hooks/useProjects";
import { useTrackerConnections } from "./useTrackerConnections";

export type SidebarStage = "stage1" | "stage2" | "stage3" | "stage4";

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
  };
}

const ALL_VISIBLE_BASE = {
  home: true,
  threads: true,
  terminal: true,
  objectives: true,
  objectivesIsNew: false,
  tracking: true,
  teams: true,
  folders: true,
  scheduledTasks: true,
  envVars: true,
};

/**
 * Determine which sidebar sections to show.
 * Gating:
 *  - tracking: shown only when the project has at least one connected tracker
 */
export function useSidebarStage(
  project: ProjectWithAgents | null,
): SidebarStageResult {
  const { connections, loading } = useTrackerConnections(project?.id ?? null);
  const hasTracker = connections.some((c) => c.connected);

  return useMemo(() => {
    if (loading) {
      return {
        stage: "stage1",
        loading: true,
        show: { ...ALL_VISIBLE_BASE, tracking: false },
      };
    }

    return {
      stage: "stage4",
      loading: false,
      show: { ...ALL_VISIBLE_BASE, tracking: hasTracker },
    };
  }, [loading, hasTracker]);
}

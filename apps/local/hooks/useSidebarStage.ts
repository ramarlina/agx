"use client";

import { useMemo, useRef } from "react";
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

  // Retain last confirmed value so the link doesn't flicker off during re-fetches
  const lastHasTracker = useRef(false);
  if (!loading) {
    lastHasTracker.current = hasTracker;
  }

  return useMemo(() => {
    const tracking = loading ? lastHasTracker.current : hasTracker;
    return {
      stage: "stage4",
      loading,
      show: { ...ALL_VISIBLE_BASE, tracking },
    };
  }, [loading, hasTracker]);
}

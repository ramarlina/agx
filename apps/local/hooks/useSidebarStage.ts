import { useMemo, useState, useEffect } from "react";
import type { ProjectWithAgents } from "@/hooks/useProjects";
import { readProjectObjectivesWorkspace } from "@/lib/project-objectives";

/**
 * Progressive sidebar maturity stages.
 *
 * - stage1: Fresh start — Home, Threads, Terminal only
 * - stage2: First objective created — adds Objectives (with NEW badge)
 * - stage3: Linear connected — adds Linear, Teams section
 * - stage4: Power user — adds Environment Variables
 */
export type SidebarStage = "stage1" | "stage2" | "stage3" | "stage4";

export interface SidebarStageResult {
  stage: SidebarStage;
  /** True while async signals (Linear, automations) are still loading. */
  loading: boolean;
  show: {
    home: boolean;
    threads: boolean;
    terminal: boolean;
    objectives: boolean;
    objectivesIsNew: boolean;
    linear: boolean;
    teams: boolean;
    folders: boolean;
    scheduledTasks: boolean;
    envVars: boolean;
  };
}

/**
 * Derives the sidebar's progressive-reveal stage from existing project signals.
 *
 * Uses current-state gating (not persisted milestones): if the user deletes all
 * objectives, the Objectives nav item hides again.
 */
export function useSidebarStage(
  project: ProjectWithAgents | null,
): SidebarStageResult {
  const [linearConnected, setLinearConnected] = useState(false);
  const [linearLoading, setLinearLoading] = useState(true);
  const [hasAutomations, setHasAutomations] = useState(false);
  const [automationsLoading, setAutomationsLoading] = useState(true);

  // Detect objectives from project metadata (synchronous — no fetch needed).
  const hasObjectives = useMemo(() => {
    if (!project) return false;
    return readProjectObjectivesWorkspace(project.metadata).objectives.length > 0;
  }, [project]);

  // Check Linear connection status (single fetch, not polled).
  useEffect(() => {
    let cancelled = false;
    setLinearLoading(true);
    fetch("/api/linear/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setLinearConnected(data?.connected === true);
      })
      .catch(() => {
        if (!cancelled) setLinearConnected(false);
      })
      .finally(() => {
        if (!cancelled) setLinearLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Check whether the project has any automations (single fetch, not polled).
  useEffect(() => {
    if (!project) {
      setHasAutomations(false);
      setAutomationsLoading(false);
      return;
    }
    let cancelled = false;
    setAutomationsLoading(true);
    fetch("/api/automations")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const items: Array<{ projectId: string | null }> = data?.automations ?? [];
        setHasAutomations(items.some((a) => a.projectId === project.id));
      })
      .catch(() => {
        if (!cancelled) setHasAutomations(false);
      })
      .finally(() => {
        if (!cancelled) setAutomationsLoading(false);
      });
    return () => { cancelled = true; };
  }, [project?.id]);

  const loading = linearLoading || automationsLoading;

  const stage: SidebarStage = useMemo(() => {
    // Default to stage1 while loading to avoid flashing advanced items.
    if (loading) return "stage1";
    if (hasAutomations) return "stage4";
    if (linearConnected) return "stage3";
    if (hasObjectives) return "stage2";
    return "stage1";
  }, [loading, hasObjectives, linearConnected, hasAutomations]);

  const show = useMemo((): SidebarStageResult["show"] => {
    const s = stage;
    return {
      home: true,
      threads: true,
      terminal: true,
      objectives: s === "stage2" || s === "stage3" || s === "stage4",
      objectivesIsNew: s === "stage2",
      linear: s === "stage3" || s === "stage4",
      teams: s === "stage3" || s === "stage4",
      folders: s === "stage3" || s === "stage4",
      scheduledTasks: true,
      envVars: s === "stage4",
    };
  }, [stage]);

  return { stage, loading, show };
}

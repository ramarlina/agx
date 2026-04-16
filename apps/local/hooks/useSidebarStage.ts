import type { ProjectWithAgents } from "@/hooks/useProjects";

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

const ALL_VISIBLE: SidebarStageResult = {
  stage: "stage4",
  loading: false,
  show: {
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
  },
};

export function useSidebarStage(
  _project: ProjectWithAgents | null,
): SidebarStageResult {
  return ALL_VISIBLE;
}

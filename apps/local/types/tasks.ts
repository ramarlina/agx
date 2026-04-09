export interface TaskDraft {
  id: string;
  title: string;
  description: string;
  dependsOn?: string[]; // IDs of other TaskDrafts this task depends on
}

export interface TaskDraftMessage {
  draftId: string;
  revision: number;
  tasks: TaskDraft[];
  buildId?: string;
  projectId?: string;
  projectName?: string;
  builtTaskIds?: Record<string, string>; // client_task_id -> remote task id
  buildStatus?: "idle" | "building" | "done" | "partial_failure";
}

export interface AgxProject {
  id: string;
  name: string;
  description?: string;
}

export interface AgxTask {
  id: string;
  content: string;
  status: string;
  project_id?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildResult {
  buildId: string;
  projectId: string;
  results: Array<{
    clientTaskId: string;
    remoteTaskId?: string;
    status: "created" | "failed";
    error?: string;
  }>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { ScheduleConditionPicker } from "@/components/scheduling/ScheduleConditionPicker";
import {
  addObjectiveActivity,
  buildObjectiveTimelineActivities,
  createManualObjectiveActivity,
  createObjectiveManualTask,
  createProjectObjective,
  readProjectObjectivesWorkspace,
  removeObjectiveManualTask,
  removeProjectObjective,
  type ProjectObjective,
  type ProjectObjectiveHealth,
  type ProjectObjectiveManualTask,
  type ProjectObjectiveTaskStatus,
  type ProjectObjectiveWorkspaceState,
  upsertObjectiveManualTask,
  upsertProjectObjective,
  writeProjectObjectivesWorkspace,
} from "@/lib/project-objectives";

interface ProjectObjectivesWorkspaceProps {
  projectSlug: string;
}

interface ProjectObjectiveDetailProps extends ProjectObjectivesWorkspaceProps {
  objectiveId: string;
}

interface ObjectiveEditorDraft {
  id?: string;
  title: string;
  teamId: string;
  summary: string;
  cadence: string;
  condition: string;
  progress: number;
  status: ProjectObjectiveHealth;
}

interface ProjectTeamSummary {
  id: string;
  name: string;
}

interface ManualTaskDraft {
  id?: string;
  title: string;
  notes: string;
  status: ProjectObjectiveTaskStatus;
}

const HEALTH_META: Record<
  ProjectObjectiveHealth,
  { label: string; chipClass: string; toneClass: string }
> = {
  on_track: {
    label: "On track",
    chipClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    toneClass: "text-emerald-300",
  },
  at_risk: {
    label: "At risk",
    chipClass: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    toneClass: "text-amber-300",
  },
  off_track: {
    label: "Off track",
    chipClass: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    toneClass: "text-rose-300",
  },
  done: {
    label: "Done",
    chipClass: "border-sky-500/20 bg-sky-500/10 text-sky-100",
    toneClass: "text-sky-300",
  },
};

const TASK_STATUS_META: Record<
  ProjectObjectiveTaskStatus,
  { label: string; chipClass: string }
> = {
  todo: {
    label: "Todo",
    chipClass: "border-slate-500/20 bg-slate-500/10 text-slate-200",
  },
  in_progress: {
    label: "Working",
    chipClass: "border-amber-500/20 bg-amber-500/10 text-amber-100",
  },
  done: {
    label: "Done",
    chipClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
  },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function sortTasks(tasks: ProjectObjectiveManualTask[]): ProjectObjectiveManualTask[] {
  const rank: Record<ProjectObjectiveTaskStatus, number> = {
    in_progress: 0,
    todo: 1,
    done: 2,
  };
  return [...tasks].sort((left, right) => {
    const rankDelta = rank[left.status] - rank[right.status];
    if (rankDelta !== 0) return rankDelta;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function buildEmptyObjectiveDraft(): ObjectiveEditorDraft {
  return {
    title: "",
    teamId: "",
    summary: "",
    cadence: "",
    condition: "",
    progress: 0,
    status: "on_track",
  };
}

function buildObjectiveDraft(objective: ProjectObjective): ObjectiveEditorDraft {
  return {
    id: objective.id,
    title: objective.title,
    teamId: objective.teamId,
    summary: objective.summary,
    cadence: objective.cadence,
    condition: objective.condition,
    progress: objective.progress,
    status: objective.status,
  };
}

function buildEmptyTaskDraft(): ManualTaskDraft {
  return {
    title: "",
    notes: "",
    status: "todo",
  };
}

function buildTaskDraft(task: ProjectObjectiveManualTask): ManualTaskDraft {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
  };
}

function buildTaskSummary(task: ProjectObjectiveManualTask): string {
  const status = TASK_STATUS_META[task.status].label;
  return task.notes ? `${status}. ${task.notes}` : status;
}

function buildObjectiveHref(projectSlug: string, objectiveId: string): string {
  return `/projects/${projectSlug}/objectives/${encodeURIComponent(objectiveId)}`;
}

function formatActivityCount(count: number): string {
  return count === 1 ? "1 activity" : `${count} activities`;
}

function buildActivityMeta(count: number, lastActivityAt: string | null): string {
  const activityLabel = formatActivityCount(count);
  if (!lastActivityAt) {
    return `${activityLabel} · No activity yet`;
  }
  return `${activityLabel} · Last ${formatDateTime(lastActivityAt)}`;
}

function findObjectiveAssignedToTeam(
  workspace: ProjectObjectiveWorkspaceState,
  teamId: string,
  excludeObjectiveId?: string
): ProjectObjective | null {
  if (!teamId) return null;
  return (
    workspace.objectives.find(
      (entry) => entry.teamId === teamId && entry.id !== excludeObjectiveId
    ) ?? null
  );
}

function getAvailableTeams(
  teams: ProjectTeamSummary[],
  workspace: ProjectObjectiveWorkspaceState,
  excludeObjectiveId?: string
): ProjectTeamSummary[] {
  return teams.filter(
    (team) => !findObjectiveAssignedToTeam(workspace, team.id, excludeObjectiveId)
  );
}

function getTeamName(teams: ProjectTeamSummary[], teamId: string): string | null {
  return teams.find((team) => team.id === teamId)?.name ?? null;
}

function useProjectObjectivesWorkspace(projectSlug: string) {
  const { projects, isLoading, updateProject } = useProjects();
  const [teams, setTeams] = useState<ProjectTeamSummary[]>([]);
  const project = useMemo(
    () => projects.find((entry) => entry.slug === projectSlug) ?? null,
    [projectSlug, projects]
  );
  const workspace = useMemo(
    () => readProjectObjectivesWorkspace(project?.metadata),
    [project?.metadata]
  );

  const persistWorkspace = useCallback(
    async (nextWorkspace: ProjectObjectiveWorkspaceState) => {
      if (!project) {
        throw new Error("Project not found.");
      }

      await updateProject(project.id, {
        metadata: writeProjectObjectivesWorkspace(project.metadata ?? {}, nextWorkspace),
      });
    },
    [project, updateProject]
  );

  useEffect(() => {
    let isActive = true;

    async function fetchTeams() {
      if (!project?.id) {
        setTeams([]);
        return;
      }

      try {
        const response = await fetch(`/api/projects/${project.id}/teams`);
        if (!response.ok) {
          throw new Error("Failed to fetch teams");
        }
        const payload = (await response.json()) as {
          teams?: Array<{ id?: string; name?: string }>;
        };
        if (!isActive) return;
        setTeams(
          (payload.teams ?? [])
            .map((team) => ({
              id: typeof team.id === "string" ? team.id : "",
              name: typeof team.name === "string" ? team.name : "Untitled team",
            }))
            .filter((team) => team.id)
        );
      } catch {
        if (!isActive) return;
        setTeams([]);
      }
    }

    void fetchTeams();

    return () => {
      isActive = false;
    };
  }, [project?.id]);

  return {
    isLoading,
    project,
    workspace,
    teams,
    persistWorkspace,
  };
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
      {label}
    </div>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
      <AlertTriangle className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

function ObjectiveListCard({
  projectSlug,
  objective,
  activityCount,
  lastActivityAt,
}: {
  projectSlug: string;
  objective: ProjectObjective;
  activityCount: number;
  lastActivityAt: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const noteId = `objective-note-${objective.id}`;
  const activityMeta = buildActivityMeta(activityCount, lastActivityAt);

  return (
    <article className="px-2 transition-colors hover:bg-white/[0.02]">
      <div className="flex items-center gap-2 py-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={noteId}
          onClick={() => setIsExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1.5 text-left"
        >
          <span className="shrink-0 text-[var(--muted-foreground)]">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {objective.title}
          </span>
        </button>

        <div className="hidden shrink-0 text-right text-xs text-[var(--muted-foreground)] sm:block">
          <div>{activityMeta}</div>
        </div>

        <Link
          href={buildObjectiveHref(projectSlug, objective.id)}
          aria-label={`Open details for ${objective.title}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-white/5 hover:text-[var(--foreground)]"
        >
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {isExpanded ? (
        <div
          id={noteId}
          className="border-t border-[var(--border)] pb-3 pl-7 pr-10 pt-3 text-sm leading-6 text-[var(--muted-foreground)]"
        >
          <p>{objective.summary || "No notes yet."}</p>
          <div className="mt-2 text-xs text-[var(--muted-foreground)] sm:hidden">
            {activityMeta}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function ProjectObjectivesOverview({
  projectSlug,
}: ProjectObjectivesWorkspaceProps) {
  const router = useRouter();
  const { isLoading, project, workspace, teams, persistWorkspace } =
    useProjectObjectivesWorkspace(projectSlug);
  const objectives = workspace.objectives;
  const availableTeams = useMemo(
    () => getAvailableTeams(teams, workspace),
    [teams, workspace]
  );
  const [objectiveEditor, setObjectiveEditor] = useState<ObjectiveEditorDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleObjectiveSave = async () => {
    if (!objectiveEditor) return;

    const title = objectiveEditor.title.trim();
    if (!title) {
      setSaveError("Objective statement is required.");
      return;
    }
    const teamId = objectiveEditor.teamId.trim();
    if (!teamId) {
      setSaveError("Team owner is required.");
      return;
    }
    const assignedObjective = findObjectiveAssignedToTeam(workspace, teamId);
    if (assignedObjective) {
      setSaveError(`Team owner is already assigned to "${assignedObjective.title}".`);
      return;
    }

    const now = new Date().toISOString();
    const nextObjective = createProjectObjective({
      title,
      teamId,
      summary: objectiveEditor.summary,
      cadence: objectiveEditor.cadence,
      condition: objectiveEditor.condition,
      progress: objectiveEditor.progress,
      status: objectiveEditor.status,
      now,
    });

    setIsSaving(true);
    setSaveError(null);

    try {
      await persistWorkspace(upsertProjectObjective(workspace, nextObjective));
      setObjectiveEditor(null);
      router.push(buildObjectiveHref(projectSlug, nextObjective.id));
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save objective updates."
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingState label="Loading objectives..." />;
  }

  if (!project) {
    return <LoadingState label="Project not found." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_28%),var(--background)] text-[var(--foreground)]">
      <div className="border-b border-[var(--border)] bg-[rgba(10,14,20,0.7)] px-4 py-5 backdrop-blur md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-[var(--muted-foreground)]">
              {objectives.length === 0
                ? "Add an objective to start tracking work in this project."
                : "Expand a row for notes or open the detail view when you need more."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setObjectiveEditor(buildEmptyObjectiveDraft())}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
          >
            <Plus className="h-4 w-4" />
            New objective
          </button>
        </div>
        <ErrorBanner message={saveError} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {objectives.length === 0 ? (
          <div className="mx-auto max-w-3xl rounded-[32px] border border-dashed border-[var(--border)] bg-[var(--card-bg)] p-8 text-center">
            <p className="text-lg font-semibold text-[var(--foreground)]">No objectives yet</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Keep the root view simple: objective list first, detail after click-through.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl divide-y divide-[var(--border)] overflow-hidden rounded-[24px] border border-[var(--border)] bg-[rgba(8,12,18,0.58)]">
            {objectives.map((objective) => {
              const objectiveActivities = buildObjectiveTimelineActivities({
                objective,
                workspace,
              });

              return (
                <ObjectiveListCard
                  key={objective.id}
                  projectSlug={projectSlug}
                  objective={objective}
                  activityCount={objectiveActivities.length}
                  lastActivityAt={objectiveActivities[0]?.createdAt ?? null}
                />
              );
            })}
          </div>
        )}
      </div>

      {objectiveEditor ? (
        <ObjectiveEditorModal
          mode="create"
          draft={objectiveEditor}
          teams={availableTeams}
          isSaving={isSaving}
          onChange={setObjectiveEditor}
          onClose={() => setObjectiveEditor(null)}
          onSave={() => void handleObjectiveSave()}
        />
      ) : null}
    </div>
  );
}

export function ProjectObjectiveDetail({
  projectSlug,
  objectiveId,
}: ProjectObjectiveDetailProps) {
  const router = useRouter();
  const { isLoading, project, workspace, teams, persistWorkspace } =
    useProjectObjectivesWorkspace(projectSlug);
  const objective = useMemo(
    () => workspace.objectives.find((entry) => entry.id === objectiveId) ?? null,
    [objectiveId, workspace.objectives]
  );
  const availableTeams = useMemo(
    () => getAvailableTeams(teams, workspace, objectiveId),
    [objectiveId, teams, workspace]
  );
  const teamName = objective ? getTeamName(teams, objective.teamId) : null;
  const [objectiveEditor, setObjectiveEditor] = useState<ObjectiveEditorDraft | null>(null);
  const [wakeEditor, setWakeEditor] = useState<ObjectiveEditorDraft | null>(null);
  const [taskEditor, setTaskEditor] = useState<ManualTaskDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const runPersist = async (nextWorkspace: ProjectObjectiveWorkspaceState) => {
    setIsSaving(true);
    setSaveError(null);

    try {
      await persistWorkspace(nextWorkspace);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save objective updates."
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleObjectiveSave = async () => {
    if (!objectiveEditor || !objective) return;

    const title = objectiveEditor.title.trim();
    if (!title) {
      setSaveError("Objective statement is required.");
      return;
    }
    const teamId = objectiveEditor.teamId.trim();
    if (!teamId) {
      setSaveError("Team owner is required.");
      return;
    }
    const assignedObjective = findObjectiveAssignedToTeam(workspace, teamId, objective.id);
    if (assignedObjective) {
      setSaveError(`Team owner is already assigned to "${assignedObjective.title}".`);
      return;
    }

    const nextObjective = {
      ...objective,
      title,
      teamId,
      summary: objectiveEditor.summary.trim(),
      cadence: objectiveEditor.cadence.trim(),
      condition: objectiveEditor.condition.trim(),
      progress: clampProgress(objectiveEditor.progress),
      status: objectiveEditor.status,
      updatedAt: new Date().toISOString(),
    };

    await runPersist(upsertProjectObjective(workspace, nextObjective));
    setObjectiveEditor(null);
  };

  const handleWakeSave = async () => {
    if (!wakeEditor || !objective) return;

    const nextObjective = {
      ...objective,
      cadence: wakeEditor.cadence.trim(),
      condition: wakeEditor.condition.trim(),
      updatedAt: new Date().toISOString(),
    };

    await runPersist(upsertProjectObjective(workspace, nextObjective));
    setWakeEditor(null);
  };

  const handleObjectiveDelete = async () => {
    if (!objective) return;

    const confirmed = window.confirm(`Delete "${objective.title}"?`);
    if (!confirmed) return;

    await runPersist(removeProjectObjective(workspace, objective.id));
    router.push(`/projects/${projectSlug}`);
  };

  const handleTaskSave = async () => {
    if (!objective || !taskEditor) return;

    const title = taskEditor.title.trim();
    if (!title) {
      setSaveError("Manual task title is required.");
      return;
    }

    const now = new Date().toISOString();
    const existingTask = taskEditor.id
      ? objective.manualTasks.find((task) => task.id === taskEditor.id) ?? null
      : null;
    const nextTask = existingTask
      ? {
          ...existingTask,
          title,
          notes: taskEditor.notes.trim(),
          status: taskEditor.status,
          updatedAt: now,
          completedAt:
            taskEditor.status === "done" ? existingTask.completedAt ?? now : null,
        }
      : createObjectiveManualTask({
          title,
          notes: taskEditor.notes,
          status: taskEditor.status,
          now,
        });

    let nextWorkspace = upsertObjectiveManualTask(
      workspace,
      objective.id,
      nextTask,
      now
    );

    if (!existingTask) {
      const activity = createManualObjectiveActivity({
        objectiveId: objective.id,
        title: nextTask.title,
        body: `Manual task added. ${buildTaskSummary(nextTask)}`,
        sourceType: "manual_task",
        sourceLabel: "Manual task",
        relatedTaskId: nextTask.id,
        now,
      });
      nextWorkspace = addObjectiveActivity(nextWorkspace, activity);
    } else if (existingTask.status !== nextTask.status) {
      const activity = createManualObjectiveActivity({
        objectiveId: objective.id,
        title: nextTask.title,
        body: `Status changed to ${TASK_STATUS_META[nextTask.status].label.toLowerCase()}.`,
        sourceType: "manual_task",
        sourceLabel: "Manual task",
        relatedTaskId: nextTask.id,
        now,
      });
      nextWorkspace = addObjectiveActivity(nextWorkspace, activity);
    }

    await runPersist(nextWorkspace);
    setTaskEditor(null);
  };

  const handleTaskStatusChange = async (
    task: ProjectObjectiveManualTask,
    status: ProjectObjectiveTaskStatus
  ) => {
    if (!objective || task.status === status) return;

    const now = new Date().toISOString();
    const nextTask: ProjectObjectiveManualTask = {
      ...task,
      status,
      updatedAt: now,
      completedAt: status === "done" ? task.completedAt ?? now : null,
    };
    let nextWorkspace = upsertObjectiveManualTask(
      workspace,
      objective.id,
      nextTask,
      now
    );
    const activity = createManualObjectiveActivity({
      objectiveId: objective.id,
      title: nextTask.title,
      body: `Status changed to ${TASK_STATUS_META[status].label.toLowerCase()}.`,
      sourceType: "manual_task",
      sourceLabel: "Manual task",
      relatedTaskId: task.id,
      now,
    });
    nextWorkspace = addObjectiveActivity(nextWorkspace, activity);

    await runPersist(nextWorkspace);
  };

  const handleTaskDelete = async (task: ProjectObjectiveManualTask) => {
    if (!objective) return;

    const confirmed = window.confirm(`Delete manual task "${task.title}"?`);
    if (!confirmed) return;

    const now = new Date().toISOString();
    let nextWorkspace = removeObjectiveManualTask(workspace, objective.id, task.id, now);
    const activity = createManualObjectiveActivity({
      objectiveId: objective.id,
      title: task.title,
      body: "Manual task removed.",
      sourceType: "manual_task",
      sourceLabel: "Manual task",
      relatedTaskId: task.id,
      now,
    });
    nextWorkspace = addObjectiveActivity(nextWorkspace, activity);

    await runPersist(nextWorkspace);
  };

  if (isLoading) {
    return <LoadingState label="Loading objective..." />;
  }

  if (!project) {
    return <LoadingState label="Project not found." />;
  }

  if (!objective) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="rounded-[32px] border border-[var(--border)] bg-[var(--card-bg)] p-8 text-center">
          <p className="text-lg font-semibold text-[var(--foreground)]">Objective not found</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            It may have been deleted or the link is stale.
          </p>
          <Link
            href={`/projects/${projectSlug}`}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to objectives
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_28%),var(--background)] text-[var(--foreground)]">
      <div className="border-b border-[var(--border)] bg-[rgba(10,14,20,0.76)] px-4 py-5 backdrop-blur md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Link
              href={`/projects/${projectSlug}`}
              className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to objectives
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${HEALTH_META[objective.status].chipClass}`}
              >
                {HEALTH_META[objective.status].label}
              </span>
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{objective.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-[var(--muted-foreground)]">
                {objective.summary ||
                  "No notes yet. Use this space to explain what better looks like."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start">
            <button
              type="button"
              onClick={() => setObjectiveEditor(buildObjectiveDraft(objective))}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => void handleObjectiveDelete()}
              aria-label={`Delete objective ${objective.title}`}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
        <ErrorBanner message={saveError} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Team owner</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Each objective is owned by a single team, and each team can own only one objective.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setObjectiveEditor(buildObjectiveDraft(objective))}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
              >
                <Pencil className="h-4 w-4" />
                Edit team
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.35)] px-4 py-4">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {teamName ?? "Missing team"}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {teamName
                  ? "This team is currently responsible for the objective."
                  : "The selected team no longer exists. Pick a new team owner."}
              </p>
            </div>
          </section>

          <div className="space-y-3 px-1">
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              How often agents should wake up and work on it?
            </p>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="rounded-xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] px-4 py-3 text-sm text-[var(--foreground)]">
                  <span className="block truncate">{objective.cadence || "Not set yet"}</span>
                </div>
                {objective.condition ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span className="block text-xs uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
                      Condition
                    </span>
                    <span className="mt-1 block truncate">{objective.condition}</span>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setWakeEditor(buildObjectiveDraft(objective))}
                aria-label={`Edit cadence for ${objective.title}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[rgba(15,23,42,0.28)] text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>

          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Scheduled Tasks</p>
              <button
                type="button"
                onClick={() => setTaskEditor(buildEmptyTaskDraft())}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:border-[var(--card-hover-border)]"
              >
                <Plus className="h-4 w-4" />
                Add task
              </button>
            </div>

            {objective.manualTasks.length === 0 ? (
              <EmptyState label="No scheduled tasks yet." />
            ) : (
              <div className="space-y-3">
                {sortTasks(objective.manualTasks).map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.35)] px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {task.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {task.notes || "No extra notes"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${TASK_STATUS_META[task.status].chipClass}`}
                      >
                        {TASK_STATUS_META[task.status].label}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span>Updated {formatDateTime(task.updatedAt)}</span>
                      {task.completedAt ? (
                        <span>Completed {formatDateTime(task.completedAt)}</span>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {(["todo", "in_progress", "done"] as ProjectObjectiveTaskStatus[]).map(
                        (status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => void handleTaskStatusChange(task, status)}
                            className={`rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                              task.status === status
                                ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
                                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            }`}
                          >
                            {TASK_STATUS_META[status].label}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => setTaskEditor(buildTaskDraft(task))}
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTaskDelete(task)}
                        className="rounded-xl border border-rose-500/20 px-3 py-1.5 text-xs text-rose-100 transition-colors hover:bg-rose-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-[var(--border)] bg-[var(--card-bg)] p-5">
            <div className="mb-4">
              <p className="text-sm font-semibold">Linear Tickets</p>
            </div>
            <EmptyState label="No Linear ticket tracking configured for this objective yet." />
          </section>
        </div>
      </div>

      {objectiveEditor ? (
        <ObjectiveEditorModal
          mode="edit"
          draft={objectiveEditor}
          teams={availableTeams}
          isSaving={isSaving}
          onChange={setObjectiveEditor}
          onClose={() => setObjectiveEditor(null)}
          onSave={() => void handleObjectiveSave()}
        />
      ) : null}

      {wakeEditor ? (
        <ObjectiveWakeModal
          draft={wakeEditor}
          isSaving={isSaving}
          onChange={setWakeEditor}
          onClose={() => setWakeEditor(null)}
          onSave={() => void handleWakeSave()}
        />
      ) : null}

      {taskEditor ? (
        <ManualTaskModal
          draft={taskEditor}
          isSaving={isSaving}
          onChange={setTaskEditor}
          onClose={() => setTaskEditor(null)}
          onSave={() => void handleTaskSave()}
        />
      ) : null}
    </div>
  );
}

export function ProjectObjectivesWorkspace(props: ProjectObjectivesWorkspaceProps) {
  return <ProjectObjectivesOverview {...props} />;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
      {label}
    </div>
  );
}

function ObjectiveEditorModal({
  mode,
  draft,
  teams,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  draft: ObjectiveEditorDraft;
  teams: ProjectTeamSummary[];
  isSaving: boolean;
  onChange: (draft: ObjectiveEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit objective" : "New objective"}
        className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-[var(--border)] bg-[rgba(6,10,16,0.96)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {mode === "edit" ? "Edit objective" : "New objective"}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {mode === "edit"
              ? "Update the tracking details for this objective."
              : "Keep the statement measurable and use notes only for context that matters."}
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <FieldLabel label="Objective statement" />
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
              placeholder="Get 50 qualified visitors daily"
            />
          </div>

          <div>
            <FieldLabel label="Team owner" />
            <select
              value={draft.teamId}
              onChange={(event) => onChange({ ...draft, teamId: event.target.value })}
              className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
            >
              <option value="">Select a team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Teams can only own one objective at a time.
            </p>
          </div>

          <div>
            <FieldLabel label="Notes" />
            <textarea
              value={draft.summary}
              onChange={(event) => onChange({ ...draft, summary: event.target.value })}
              className="min-h-28 w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
              placeholder="Capture the current angle, constraints, or what the team should keep in mind."
            />
          </div>

          {mode === "edit" ? (
            <div className="space-y-4">
              <div>
                <ScheduleConditionPicker
                  value={{ cadence: draft.cadence, condition: draft.condition }}
                  onChange={(nextValue) =>
                    onChange({
                      ...draft,
                      cadence: nextValue.cadence,
                      condition: nextValue.condition,
                    })
                  }
                  allowEmptySchedule
                  scheduleLabel="Schedule"
                  conditionLabel="Condition"
                  conditionHelpText="Use a condition when agents should only work on this objective in specific circumstances."
                />
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <div>
                  <FieldLabel label={`Progress (${draft.progress}%)`} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.progress}
                    onChange={(event) =>
                      onChange({ ...draft, progress: Number(event.target.value) })
                    }
                    className="mt-3 w-full accent-sky-400"
                  />
                </div>

                <div>
                  <FieldLabel label="Health" />
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        status: event.target.value as ProjectObjectiveHealth,
                      })
                    }
                    className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
                  >
                    <option value="on_track">On track</option>
                    <option value="at_risk">At risk</option>
                    <option value="off_track">Off track</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : mode === "edit" ? "Save objective" : "Create objective"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ObjectiveWakeModal({
  draft,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  draft: ObjectiveEditorDraft;
  isSaving: boolean;
  onChange: (draft: ObjectiveEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit wake schedule"
        className="w-full max-w-2xl overflow-hidden rounded-[32px] border border-[var(--border)] bg-[rgba(6,10,16,0.96)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--foreground)]">Edit wake schedule</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Control when agents should wake up and whether they should gate execution on a condition.
          </p>
        </div>

        <div className="px-5 py-5">
          <ScheduleConditionPicker
            value={{ cadence: draft.cadence, condition: draft.condition }}
            onChange={(nextValue) =>
              onChange({
                ...draft,
                cadence: nextValue.cadence,
                condition: nextValue.condition,
              })
            }
            allowEmptySchedule
            scheduleLabel="Schedule"
            conditionLabel="Condition"
            conditionHelpText="Use a condition when agents should only work on this objective in specific circumstances."
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualTaskModal({
  draft,
  isSaving,
  onChange,
  onClose,
  onSave,
}: {
  draft: ManualTaskDraft;
  isSaving: boolean;
  onChange: (draft: ManualTaskDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-2xl rounded-[32px] border border-[var(--border)] bg-[rgba(6,10,16,0.96)] shadow-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--foreground)]">
            {draft.id ? "Edit manual task" : "New manual task"}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Use manual tasks only for explicit pushes that should sit under this objective.
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <FieldLabel label="Task" />
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
              placeholder="Ship a new referral landing page draft"
            />
          </div>

          <div>
            <FieldLabel label="Notes" />
            <textarea
              value={draft.notes}
              onChange={(event) => onChange({ ...draft, notes: event.target.value })}
              className="min-h-28 w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
              placeholder="Include any specifics that make this push concrete."
            />
          </div>

          <div>
            <FieldLabel label="Status" />
            <select
              value={draft.status}
              onChange={(event) =>
                onChange({
                  ...draft,
                  status: event.target.value as ProjectObjectiveTaskStatus,
                })
              }
              className="w-full rounded-2xl border border-[var(--border)] bg-[rgba(15,23,42,0.55)] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-sky-500/50"
            >
              <option value="todo">Todo</option>
              <option value="in_progress">Working</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
      {label}
    </label>
  );
}

export const PROJECT_OBJECTIVES_METADATA_KEY = "project_objectives_workspace";
export const LEGACY_PROJECT_GOALS_METADATA_KEY = "project_goals_workspace";
export const CURRENT_OBJECTIVE_CHAT_SESSION_VERSION = 2;

export type ProjectObjectiveHealth = "on_track" | "at_risk" | "off_track" | "done";
export type ProjectObjectiveTaskStatus = "todo" | "in_progress" | "done";
export type ProjectObjectiveActivitySource = "note" | "manual_task";

export interface ProjectObjectiveManualTask {
  id: string;
  title: string;
  notes: string;
  status: ProjectObjectiveTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectObjective {
  id: string;
  title: string;
  teamId: string;
  key: string;
  threadId: string | null;
  chatSessionVersion: number;
  scheduledTaskIds: string[];
  summary: string;
  cadence: string;
  condition: string;
  progress: number;
  status: ProjectObjectiveHealth;
  manualTasks: ProjectObjectiveManualTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectObjectiveActivity {
  id: string;
  objectiveId: string;
  sourceType: ProjectObjectiveActivitySource;
  sourceLabel: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  relatedTaskId: string | null;
}

export interface ProjectObjectiveTimelineActivity extends ProjectObjectiveActivity {
  threadCount: number;
}

export interface ProjectObjectiveActivityThreadMessage {
  id: string;
  activityId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ProjectObjectiveWorkspaceState {
  objectives: ProjectObjective[];
  activities: ProjectObjectiveActivity[];
  activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]>;
}

interface CreateProjectObjectiveInput {
  id?: string;
  title: string;
  teamId: string;
  key?: string;
  threadId?: string | null;
  chatSessionVersion?: number;
  scheduledTaskIds?: string[];
  summary?: string;
  cadence?: string;
  condition?: string;
  progress?: number;
  status?: ProjectObjectiveHealth;
  now: string;
}

interface CreateObjectiveManualTaskInput {
  id?: string;
  title: string;
  notes?: string;
  status?: ProjectObjectiveTaskStatus;
  now: string;
}

interface CreateManualObjectiveActivityInput {
  id?: string;
  objectiveId: string;
  title: string;
  body?: string;
  sourceType?: ProjectObjectiveActivitySource;
  sourceLabel?: string;
  relatedTaskId?: string | null;
  now: string;
}

interface CreateObjectiveActivityThreadMessageInput {
  id?: string;
  activityId: string;
  author?: string;
  body: string;
  now: string;
}

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const OBJECTIVE_HEALTH_VALUES = new Set<ProjectObjectiveHealth>([
  "on_track",
  "at_risk",
  "off_track",
  "done",
]);
const OBJECTIVE_TASK_STATUS_VALUES = new Set<ProjectObjectiveTaskStatus>([
  "todo",
  "in_progress",
  "done",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortByNewest<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
}

function sortByCreatedAsc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
  );
}

function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  );
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    )
  );
}

function readTimestamp(value: unknown, fallback = DEFAULT_TIMESTAMP): string {
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function readProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function readObjectiveHealth(value: unknown): ProjectObjectiveHealth {
  return typeof value === "string" && OBJECTIVE_HEALTH_VALUES.has(value as ProjectObjectiveHealth)
    ? (value as ProjectObjectiveHealth)
    : "on_track";
}

function readTaskStatus(value: unknown): ProjectObjectiveTaskStatus {
  return typeof value === "string" && OBJECTIVE_TASK_STATUS_VALUES.has(value as ProjectObjectiveTaskStatus)
    ? (value as ProjectObjectiveTaskStatus)
    : "todo";
}

function slugifyObjectiveKey(value: string, fallback = "objective"): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 32);

  if (normalized) {
    return normalized;
  }

  return fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "objective";
}

function buildUniqueObjectiveKey(baseValue: string, seenKeys: Set<string>, fallback = "objective"): string {
  const fallbackKey = slugifyObjectiveKey(fallback);
  const baseKey = slugifyObjectiveKey(baseValue, fallbackKey);
  let candidate = baseKey;
  let suffix = 2;

  while (seenKeys.has(candidate)) {
    const suffixText = `-${suffix}`;
    const maxBaseLength = Math.max(1, 32 - suffixText.length);
    candidate = `${baseKey.slice(0, maxBaseLength)}${suffixText}`;
    suffix += 1;
  }

  seenKeys.add(candidate);
  return candidate;
}

function withUniqueObjectiveKeys(objectives: ProjectObjective[]): ProjectObjective[] {
  const seenKeys = new Set<string>();
  return objectives.map((objective) => {
    const nextKey = buildUniqueObjectiveKey(
      objective.key || objective.title || objective.id,
      seenKeys,
      objective.id || objective.title || "objective"
    );

    if (objective.key === nextKey) {
      return objective;
    }

    return {
      ...objective,
      key: nextKey,
    };
  });
}

export function generateProjectObjectiveKey(
  value: string,
  objectives: Array<Pick<ProjectObjective, "id" | "title" | "key">>,
  excludeObjectiveId?: string
): string {
  const seenKeys = new Set(
    objectives
      .filter((objective) => objective.id !== excludeObjectiveId)
      .map((objective) => slugifyObjectiveKey(objective.key || objective.title || objective.id))
  );

  return buildUniqueObjectiveKey(value, seenKeys, excludeObjectiveId ?? value);
}

function normalizeManualTask(raw: unknown): ProjectObjectiveManualTask | null {
  if (!isRecord(raw)) return null;
  const updatedAt = readTimestamp(raw.updatedAt ?? raw.createdAt);
  const createdAt = readTimestamp(raw.createdAt, updatedAt);
  const status = readTaskStatus(raw.status);
  const completedAt =
    status === "done"
      ? readTimestamp(raw.completedAt, updatedAt)
      : null;

  return {
    id: readString(raw.id, createId("objective_task")),
    title: readString(raw.title, "Untitled manual task"),
    notes: readString(raw.notes),
    status,
    createdAt,
    updatedAt,
    completedAt,
  };
}

function normalizeObjective(raw: unknown): ProjectObjective | null {
  if (!isRecord(raw)) return null;
  const updatedAt = readTimestamp(raw.updatedAt ?? raw.createdAt);
  const createdAt = readTimestamp(raw.createdAt, updatedAt);
  const manualTasks = Array.isArray(raw.manualTasks)
    ? raw.manualTasks
        .map((entry) => normalizeManualTask(entry))
        .filter((entry): entry is ProjectObjectiveManualTask => entry !== null)
    : [];

  return {
    id: readString(raw.id, createId("objective")),
    title: readString(raw.title, "Untitled objective"),
    teamId: readString(raw.teamId ?? raw.team_id ?? raw.ownerTeamId),
    key: slugifyObjectiveKey(
      readString(raw.key ?? raw.slug ?? raw.label),
      readString(raw.title ?? raw.id, "objective")
    ),
    threadId: readString(raw.threadId) || null,
    chatSessionVersion: readNonNegativeInteger(raw.chatSessionVersion, 0),
    scheduledTaskIds: readStringArray(raw.scheduledTaskIds ?? raw.promptJobIds),
    summary: readString(raw.summary),
    cadence: readString(raw.cadence),
    condition: readString(raw.condition),
    progress: readProgress(raw.progress),
    status: readObjectiveHealth(raw.status),
    manualTasks: sortByNewest(manualTasks),
    createdAt,
    updatedAt,
  };
}

function normalizeActivity(raw: unknown): ProjectObjectiveActivity | null {
  if (!isRecord(raw)) return null;
  const updatedAt = readTimestamp(raw.updatedAt ?? raw.createdAt);
  const createdAt = readTimestamp(raw.createdAt, updatedAt);
  const objectiveId = readString(raw.objectiveId ?? raw.goalId);
  if (!objectiveId) return null;

  return {
    id: readString(raw.id, createId("objective_activity")),
    objectiveId,
    sourceType:
      raw.sourceType === "manual_task" ? "manual_task" : "note",
    sourceLabel: readString(
      raw.sourceLabel,
      raw.sourceType === "manual_task" ? "Manual task" : "Update"
    ),
    title: readString(raw.title, "Untitled activity"),
    body: readString(raw.body),
    createdAt,
    updatedAt,
    relatedTaskId: readString(raw.relatedTaskId) || null,
  };
}

function normalizeThreadMessage(raw: unknown): ProjectObjectiveActivityThreadMessage | null {
  if (!isRecord(raw)) return null;
  const activityId = readString(raw.activityId);
  if (!activityId) return null;
  return {
    id: readString(raw.id, createId("objective_thread_message")),
    activityId,
    author: readString(raw.author, "You"),
    body: readString(raw.body),
    createdAt: readTimestamp(raw.createdAt),
  };
}

function emptyWorkspace(): ProjectObjectiveWorkspaceState {
  return {
    objectives: [],
    activities: [],
    activityThreads: {},
  };
}

function normalizeWorkspace(raw: unknown): ProjectObjectiveWorkspaceState {
  if (!isRecord(raw)) return emptyWorkspace();

  const objectives = Array.isArray(raw.objectives)
    ? raw.objectives
        .map((entry) => normalizeObjective(entry))
        .filter((entry): entry is ProjectObjective => entry !== null)
    : [];

  const activities = Array.isArray(raw.activities)
    ? raw.activities
        .map((entry) => normalizeActivity(entry))
        .filter((entry): entry is ProjectObjectiveActivity => entry !== null)
    : [];

  const activityThreads = isRecord(raw.activityThreads)
    ? Object.fromEntries(
        Object.entries(raw.activityThreads).map(([activityId, messages]) => [
          activityId,
          sortByCreatedAsc(
            Array.isArray(messages)
              ? messages
                  .map((entry) => normalizeThreadMessage(entry))
                  .filter(
                    (entry): entry is ProjectObjectiveActivityThreadMessage => entry !== null
                  )
              : []
          ),
        ])
      )
    : {};

  return {
    objectives: sortByNewest(withUniqueObjectiveKeys(objectives)),
    activities: sortByCreatedDesc(activities),
    activityThreads,
  };
}

function normalizeLegacyGoal(raw: unknown): ProjectObjective | null {
  if (!isRecord(raw)) return null;
  const target = readString(raw.target);
  const summary = readString(raw.summary);
  const mergedSummary = [summary, target ? `Measure: ${target}` : ""]
    .filter(Boolean)
    .join("\n\n");

  return normalizeObjective({
    ...raw,
    summary: mergedSummary,
    cadence: "",
    manualTasks: [],
  });
}

function normalizeLegacyWorkspace(raw: unknown): ProjectObjectiveWorkspaceState {
  if (!isRecord(raw)) return emptyWorkspace();

  const objectives = Array.isArray(raw.goals)
    ? raw.goals
        .map((entry) => normalizeLegacyGoal(entry))
        .filter((entry): entry is ProjectObjective => entry !== null)
    : [];
  const activities = Array.isArray(raw.manualActivities)
    ? raw.manualActivities
        .map((entry) => normalizeActivity({ ...entry, sourceLabel: "Update" }))
        .filter((entry): entry is ProjectObjectiveActivity => entry !== null)
    : [];
  const activityThreads = isRecord(raw.activityThreads)
    ? Object.fromEntries(
        Object.entries(raw.activityThreads).map(([activityId, messages]) => [
          activityId,
          sortByCreatedAsc(
            Array.isArray(messages)
              ? messages
                  .map((entry) => normalizeThreadMessage({ ...entry, activityId }))
                  .filter(
                    (entry): entry is ProjectObjectiveActivityThreadMessage => entry !== null
                  )
              : []
          ),
        ])
      )
    : {};

  return {
    objectives: sortByNewest(objectives),
    activities: sortByCreatedDesc(activities),
    activityThreads,
  };
}

export function readProjectObjectivesWorkspace(
  metadata: Record<string, unknown> | undefined
): ProjectObjectiveWorkspaceState {
  if (!isRecord(metadata)) return emptyWorkspace();

  const currentWorkspace = metadata[PROJECT_OBJECTIVES_METADATA_KEY];
  if (currentWorkspace !== undefined) {
    const normalized = normalizeWorkspace(currentWorkspace);
    if (
      normalized.objectives.length > 0 ||
      normalized.activities.length > 0 ||
      Object.keys(normalized.activityThreads).length > 0
    ) {
      return normalized;
    }
  }

  const legacyWorkspace = metadata[LEGACY_PROJECT_GOALS_METADATA_KEY];
  if (legacyWorkspace !== undefined) {
    return normalizeLegacyWorkspace(legacyWorkspace);
  }

  return emptyWorkspace();
}

export function writeProjectObjectivesWorkspace(
  metadata: Record<string, unknown>,
  workspace: ProjectObjectiveWorkspaceState
): Record<string, unknown> {
  const nextMetadata = { ...metadata };
  delete nextMetadata[LEGACY_PROJECT_GOALS_METADATA_KEY];
  nextMetadata[PROJECT_OBJECTIVES_METADATA_KEY] = normalizeWorkspace(workspace);
  return nextMetadata;
}

export function createProjectObjective(
  input: CreateProjectObjectiveInput
): ProjectObjective {
  return {
    id: input.id ?? createId("objective"),
    title: input.title.trim(),
    teamId: input.teamId.trim(),
    key: slugifyObjectiveKey(input.key?.trim() ?? input.title.trim(), input.id ?? input.title),
    threadId: typeof input.threadId === "string" && input.threadId.trim() ? input.threadId.trim() : null,
    chatSessionVersion: readNonNegativeInteger(
      input.chatSessionVersion ?? CURRENT_OBJECTIVE_CHAT_SESSION_VERSION,
      CURRENT_OBJECTIVE_CHAT_SESSION_VERSION
    ),
    scheduledTaskIds: readStringArray(input.scheduledTaskIds ?? []),
    summary: input.summary?.trim() ?? "",
    cadence: input.cadence?.trim() ?? "",
    condition: input.condition?.trim() ?? "",
    progress: readProgress(input.progress ?? 0),
    status: input.status ?? "on_track",
    manualTasks: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createObjectiveManualTask(
  input: CreateObjectiveManualTaskInput
): ProjectObjectiveManualTask {
  const status = input.status ?? "todo";
  return {
    id: input.id ?? createId("objective_task"),
    title: input.title.trim(),
    notes: input.notes?.trim() ?? "",
    status,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: status === "done" ? input.now : null,
  };
}

export function createManualObjectiveActivity(
  input: CreateManualObjectiveActivityInput
): ProjectObjectiveActivity {
  return {
    id: input.id ?? createId("objective_activity"),
    objectiveId: input.objectiveId,
    sourceType: input.sourceType ?? "note",
    sourceLabel:
      input.sourceLabel ?? (input.sourceType === "manual_task" ? "Manual task" : "Update"),
    title: input.title.trim(),
    body: input.body?.trim() ?? "",
    createdAt: input.now,
    updatedAt: input.now,
    relatedTaskId: input.relatedTaskId ?? null,
  };
}

export function createObjectiveActivityThreadMessage(
  input: CreateObjectiveActivityThreadMessageInput
): ProjectObjectiveActivityThreadMessage {
  return {
    id: input.id ?? createId("objective_thread_message"),
    activityId: input.activityId,
    author: input.author?.trim() || "You",
    body: input.body.trim(),
    createdAt: input.now,
  };
}

export function upsertProjectObjective(
  workspace: ProjectObjectiveWorkspaceState,
  objective: ProjectObjective
): ProjectObjectiveWorkspaceState {
  const existingIndex = workspace.objectives.findIndex((entry) => entry.id === objective.id);
  const objectives =
    existingIndex >= 0
      ? workspace.objectives.map((entry) => (entry.id === objective.id ? objective : entry))
      : [objective, ...workspace.objectives];

  return {
    ...workspace,
    objectives: sortByNewest(objectives),
  };
}

export function removeProjectObjective(
  workspace: ProjectObjectiveWorkspaceState,
  objectiveId: string
): ProjectObjectiveWorkspaceState {
  const removedActivityIds = new Set(
    workspace.activities
      .filter((activity) => activity.objectiveId === objectiveId)
      .map((activity) => activity.id)
  );
  const activityThreads = Object.fromEntries(
    Object.entries(workspace.activityThreads).filter(
      ([activityId]) => !removedActivityIds.has(activityId)
    )
  );

  return {
    objectives: workspace.objectives.filter((objective) => objective.id !== objectiveId),
    activities: workspace.activities.filter((activity) => activity.objectiveId !== objectiveId),
    activityThreads,
  };
}

export function upsertObjectiveManualTask(
  workspace: ProjectObjectiveWorkspaceState,
  objectiveId: string,
  task: ProjectObjectiveManualTask,
  now: string
): ProjectObjectiveWorkspaceState {
  const objective = workspace.objectives.find((entry) => entry.id === objectiveId);
  if (!objective) return workspace;

  const existingIndex = objective.manualTasks.findIndex((entry) => entry.id === task.id);
  const manualTasks =
    existingIndex >= 0
      ? objective.manualTasks.map((entry) => (entry.id === task.id ? task : entry))
      : [task, ...objective.manualTasks];

  return upsertProjectObjective(workspace, {
    ...objective,
    manualTasks: sortByNewest(manualTasks),
    updatedAt: now,
  });
}

export function removeObjectiveManualTask(
  workspace: ProjectObjectiveWorkspaceState,
  objectiveId: string,
  taskId: string,
  now: string
): ProjectObjectiveWorkspaceState {
  const objective = workspace.objectives.find((entry) => entry.id === objectiveId);
  if (!objective) return workspace;

  return upsertProjectObjective(workspace, {
    ...objective,
    manualTasks: objective.manualTasks.filter((task) => task.id !== taskId),
    updatedAt: now,
  });
}

export function addObjectiveActivity(
  workspace: ProjectObjectiveWorkspaceState,
  activity: ProjectObjectiveActivity
): ProjectObjectiveWorkspaceState {
  const existingIndex = workspace.activities.findIndex((entry) => entry.id === activity.id);
  const activities =
    existingIndex >= 0
      ? workspace.activities.map((entry) => (entry.id === activity.id ? activity : entry))
      : [activity, ...workspace.activities];

  return {
    ...workspace,
    activities: sortByCreatedDesc(activities),
  };
}

export function appendObjectiveActivityThreadMessage(
  workspace: ProjectObjectiveWorkspaceState,
  message: ProjectObjectiveActivityThreadMessage
): ProjectObjectiveWorkspaceState {
  const thread = workspace.activityThreads[message.activityId] ?? [];
  return {
    ...workspace,
    activityThreads: {
      ...workspace.activityThreads,
      [message.activityId]: sortByCreatedAsc([...thread, message]),
    },
  };
}

export function getObjectiveActivityThreadMessages(
  workspace: ProjectObjectiveWorkspaceState,
  activityId: string
): ProjectObjectiveActivityThreadMessage[] {
  return sortByCreatedAsc(workspace.activityThreads[activityId] ?? []);
}

export function buildObjectiveTimelineActivities({
  objective,
  workspace,
}: {
  objective: ProjectObjective;
  workspace: ProjectObjectiveWorkspaceState;
}): ProjectObjectiveTimelineActivity[] {
  return workspace.activities
    .filter((activity) => activity.objectiveId === objective.id)
    .map((activity) => ({
      ...activity,
      threadCount: workspace.activityThreads[activity.id]?.length ?? 0,
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

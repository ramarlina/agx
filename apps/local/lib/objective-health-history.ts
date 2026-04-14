import type { ObjectiveActivityFile } from "@/src/objectives/activities/types";
import type { ProjectObjectiveHealth } from "@/lib/project-objectives";

export const PROJECT_OBJECTIVE_HEALTH_HISTORY_METADATA_KEY = "project_objective_health_history";

const OBJECTIVE_HEALTH_LINE_PATTERN =
  /(?:^|\n)Objective health:\s*(\d{1,3})%\s*(On track|At risk|Off track|Done)\b/im;
const MAX_OBJECTIVE_HEALTH_SAMPLES = 200;

const STATUS_FROM_LABEL: Record<string, ProjectObjectiveHealth> = {
  "on track": "on_track",
  "at risk": "at_risk",
  "off track": "off_track",
  done: "done",
};

export interface ObjectiveHealthSample {
  progress: number;
  status: ProjectObjectiveHealth;
  recordedAt: string;
  source?: string;
  note?: string;
  objectiveId?: string | null;
  objectiveKey?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeStatus(value: unknown): ProjectObjectiveHealth | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "on_track" || normalized === "at_risk" || normalized === "off_track" || normalized === "done") {
    return normalized as ProjectObjectiveHealth;
  }
  return STATUS_FROM_LABEL[normalized] ?? null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeObjectiveHealthSample(value: unknown): ObjectiveHealthSample | null {
  if (!isRecord(value)) return null;

  const status = normalizeStatus(value.status);
  const recordedAt = normalizeTimestamp(value.recordedAt);
  if (!status || !recordedAt) {
    return null;
  }

  return {
    progress: normalizeProgress(value.progress),
    status,
    recordedAt,
    source: normalizeOptionalString(value.source),
    note: normalizeOptionalString(value.note),
    objectiveId: normalizeOptionalString(value.objectiveId) ?? null,
    objectiveKey: normalizeOptionalString(value.objectiveKey) ?? null,
  };
}

function sortSamplesByRecordedAt(samples: ObjectiveHealthSample[]): ObjectiveHealthSample[] {
  return [...samples].sort(
    (left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt),
  );
}

export function mergeObjectiveHealthSamples(
  ...collections: Array<ObjectiveHealthSample[] | null | undefined>
): ObjectiveHealthSample[] {
  const flattened = collections.flatMap((collection) => collection ?? []);
  const deduped: ObjectiveHealthSample[] = [];

  for (const sample of sortSamplesByRecordedAt(flattened)) {
    const previous = deduped[deduped.length - 1] ?? null;
    if (
      previous &&
      previous.progress === sample.progress &&
      previous.status === sample.status &&
      (
        !previous.source ||
        !sample.source ||
        previous.source === sample.source
      ) &&
      Math.abs(Date.parse(sample.recordedAt) - Date.parse(previous.recordedAt)) <= 5_000
    ) {
      continue;
    }
    deduped.push(sample);
  }

  return deduped;
}

export function readObjectiveHealthHistory(
  metadata: Record<string, unknown> | undefined,
  objectiveId: string,
): ObjectiveHealthSample[] {
  if (!isRecord(metadata) || !objectiveId.trim()) return [];

  const rawHistory = metadata[PROJECT_OBJECTIVE_HEALTH_HISTORY_METADATA_KEY];
  if (!isRecord(rawHistory)) return [];

  const entries = rawHistory[objectiveId.trim()];
  if (!Array.isArray(entries)) return [];

  return mergeObjectiveHealthSamples(
    entries
      .map((entry) => normalizeObjectiveHealthSample(entry))
      .filter((entry): entry is ObjectiveHealthSample => Boolean(entry)),
  );
}

export function appendObjectiveHealthSample(
  metadata: Record<string, unknown>,
  sample: ObjectiveHealthSample & { objectiveId: string },
): Record<string, unknown> {
  const objectiveId = sample.objectiveId.trim();
  if (!objectiveId) {
    return metadata;
  }

  const existingHistory = readObjectiveHealthHistory(metadata, objectiveId);
  const mergedHistory = mergeObjectiveHealthSamples(existingHistory, [sample]).slice(
    -MAX_OBJECTIVE_HEALTH_SAMPLES,
  );

  const rawHistory = isRecord(metadata[PROJECT_OBJECTIVE_HEALTH_HISTORY_METADATA_KEY])
    ? (metadata[PROJECT_OBJECTIVE_HEALTH_HISTORY_METADATA_KEY] as Record<string, unknown>)
    : {};

  return {
    ...metadata,
    [PROJECT_OBJECTIVE_HEALTH_HISTORY_METADATA_KEY]: {
      ...rawHistory,
      [objectiveId]: mergedHistory.map((entry) => ({
        progress: normalizeProgress(entry.progress),
        status: entry.status,
        recordedAt: entry.recordedAt,
        ...(entry.source ? { source: entry.source } : {}),
        ...(entry.note ? { note: entry.note } : {}),
        ...(entry.objectiveId ? { objectiveId: entry.objectiveId } : {}),
        ...(entry.objectiveKey ? { objectiveKey: entry.objectiveKey } : {}),
      })),
    },
  };
}

export function parseObjectiveHealthSampleFromActivity(
  activity: ObjectiveActivityFile,
): ObjectiveHealthSample | null {
  if (activity.type !== "status-update") return null;

  const match = activity.body.match(OBJECTIVE_HEALTH_LINE_PATTERN);
  if (!match) return null;

  const progress = normalizeProgress(Number(match[1]));
  const status = normalizeStatus(match[2]);
  const recordedAt = normalizeTimestamp(activity.createdAt);
  if (!status || !recordedAt) return null;

  return {
    progress,
    status,
    recordedAt,
    source: normalizeOptionalString(activity.source),
    objectiveKey: normalizeOptionalString(activity.objectiveLabel) ?? null,
  };
}

export function buildObjectiveHealthHistoryFromActivities(
  activities: ObjectiveActivityFile[],
  objectiveKey?: string | null,
): ObjectiveHealthSample[] {
  return mergeObjectiveHealthSamples(
    activities
      .map((activity) => parseObjectiveHealthSampleFromActivity(activity))
      .filter((sample): sample is ObjectiveHealthSample => {
        if (!sample) return false;
        if (!objectiveKey) return true;
        return sample.objectiveKey === objectiveKey;
      }),
  );
}

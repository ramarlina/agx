"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildObjectiveHealthHistoryFromActivities,
  mergeObjectiveHealthSamples,
  readObjectiveHealthHistory,
  type ObjectiveHealthSample,
} from "@/lib/objective-health-history";
import type { ProjectObjectiveHealth } from "@/lib/project-objectives";
import type { ObjectiveActivityPage } from "@/src/objectives/activities/types";

interface ObjectiveHealthTrendProps {
  projectId: string;
  objectiveId: string;
  objectiveKey: string;
  metadata: Record<string, unknown> | undefined;
  currentProgress: number;
  currentStatus: ProjectObjectiveHealth;
  objectiveUpdatedAt: string;
}

const STATUS_META: Record<ProjectObjectiveHealth, { label: string; stroke: string }> = {
  on_track: {
    label: "On track",
    stroke: "var(--status-completed-text)",
  },
  at_risk: {
    label: "At risk",
    stroke: "var(--status-blocked-text)",
  },
  off_track: {
    label: "Off track",
    stroke: "var(--status-failed-text)",
  },
  done: {
    label: "Done",
    stroke: "var(--status-in-progress-text)",
  },
};

function formatUpdateLabel(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildPolylinePoints(samples: ObjectiveHealthSample[], width: number, height: number): string {
  const leftPad = 6;
  const rightPad = 6;
  const topPad = 6;
  const bottomPad = 6;
  const xSpan = Math.max(1, width - leftPad - rightPad);
  const ySpan = Math.max(1, height - topPad - bottomPad);

  if (samples.length === 1) {
    const progressY = height - bottomPad - (samples[0].progress / 100) * ySpan;
    return `${width / 2},${progressY}`;
  }

  return samples
    .map((sample, index) => {
      const x = leftPad + (index / Math.max(1, samples.length - 1)) * xSpan;
      const y = height - bottomPad - (sample.progress / 100) * ySpan;
      return `${x},${y}`;
    })
    .join(" ");
}

export function ObjectiveHealthTrend(props: ObjectiveHealthTrendProps) {
  const {
    projectId,
    objectiveId,
    objectiveKey,
    metadata,
    currentProgress,
    currentStatus,
    objectiveUpdatedAt,
  } = props;

  const historyFromMetadata = useMemo(
    () => readObjectiveHealthHistory(metadata, objectiveId),
    [metadata, objectiveId],
  );
  const [samples, setSamples] = useState<ObjectiveHealthSample[]>(historyFromMetadata);
  const currentSample = useMemo(
    () => ({
      progress: currentProgress,
      status: currentStatus,
      recordedAt: objectiveUpdatedAt,
      objectiveId,
      objectiveKey,
    }),
    [currentProgress, currentStatus, objectiveId, objectiveKey, objectiveUpdatedAt],
  );

  useEffect(() => {
    setSamples(historyFromMetadata);
  }, [historyFromMetadata]);

  useEffect(() => {
    let cancelled = false;

    async function loadActivityBackfill() {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/objectives/${objectiveId}/activities?type=status-update&limit=100`,
        );
        if (!response.ok) {
          throw new Error("Failed to load objective activity history");
        }

        const payload = (await response.json()) as ObjectiveActivityPage;
        const activities = Array.isArray(payload.activities) ? payload.activities : [];
        const mergedSamples = mergeObjectiveHealthSamples(
          historyFromMetadata,
          buildObjectiveHealthHistoryFromActivities(activities, objectiveKey),
        );
        if (!cancelled) {
          setSamples(mergedSamples);
        }
      } catch {
        if (!cancelled) {
          setSamples(historyFromMetadata);
        }
      }
    }

    void loadActivityBackfill();

    return () => {
      cancelled = true;
    };
  }, [historyFromMetadata, objectiveId, objectiveKey, projectId]);

  const plottedSamples = mergeObjectiveHealthSamples(samples, [currentSample]);
  const latestSample = plottedSamples[plottedSamples.length - 1];
  const polylinePoints = buildPolylinePoints(plottedSamples, 180, 52);
  const statusMeta = STATUS_META[latestSample.status];
  const sampleCountLabel = samples.length === 0
    ? "Current state"
    : plottedSamples.length === 1
      ? "1 update"
      : `${plottedSamples.length} updates`;

  return (
    <div
      data-testid="objective-health-trend"
      className="flex min-w-[260px] flex-1 items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--overlay-panel-muted)] px-4 py-3"
    >
      <div className="min-w-[84px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          Objective health
        </div>
        <div className="mt-1 text-[24px] font-semibold leading-none text-[var(--foreground)]">
          {latestSample.progress}%
        </div>
        <div className="mt-1 text-[11px] font-medium" style={{ color: statusMeta.stroke }}>
          {statusMeta.label}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <svg
          viewBox="0 0 180 52"
          className="h-[52px] w-full overflow-visible"
          role="img"
          aria-label="Objective health trend"
        >
          <line
            x1="6"
            y1="26"
            x2="174"
            y2="26"
            stroke="var(--border)"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
          <polyline
            fill="none"
            stroke={statusMeta.stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polylinePoints}
          />
          {plottedSamples.map((sample, index) => {
            const pointString = polylinePoints.split(" ")[index] ?? "";
            const [cx = "0", cy = "0"] = pointString.split(",");
            return (
              <circle
                key={`${sample.recordedAt}-${index}`}
                cx={cx}
                cy={cy}
                r={index === plottedSamples.length - 1 ? 4 : 3}
                fill={statusMeta.stroke}
                fillOpacity={index === plottedSamples.length - 1 ? 1 : 0.2}
                stroke={statusMeta.stroke}
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--muted-foreground)]">
          <span>{sampleCountLabel}</span>
          <span>{formatUpdateLabel(latestSample.recordedAt)}</span>
        </div>
      </div>
    </div>
  );
}

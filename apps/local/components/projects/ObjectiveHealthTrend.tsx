"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    stroke: "var(--status-completed)",
  },
  at_risk: {
    label: "At risk",
    stroke: "var(--status-blocked)",
  },
  off_track: {
    label: "Off track",
    stroke: "var(--status-failed)",
  },
  done: {
    label: "Done",
    stroke: "var(--status-in-progress)",
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
  const topPad = 2;
  const xSpan = Math.max(1, width - leftPad - rightPad);
  const ySpan = Math.max(1, height - topPad);

  if (samples.length === 1) {
    const progressY = height - (samples[0].progress / 100) * ySpan;
    return `${leftPad},${progressY} ${width - rightPad},${progressY}`;
  }

  return samples
    .map((sample, index) => {
      const x = leftPad + (index / Math.max(1, samples.length - 1)) * xSpan;
      const y = height - (sample.progress / 100) * ySpan;
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const plottedSamples = mergeObjectiveHealthSamples(samples, [currentSample]);
  const latestSample = plottedSamples[plottedSamples.length - 1];
  const statusMeta = STATUS_META[latestSample.status];
  const sampleCountLabel = samples.length === 0
    ? "Current state"
    : plottedSamples.length === 1
      ? "1 update"
      : `${plottedSamples.length} updates`;

  return (
    <div
      data-testid="objective-health-trend"
      className="ml-auto inline-flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--overlay-panel-muted)] px-3 py-2"
    >
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          Objective health
        </div>
        <div className="mt-0.5 text-[20px] font-semibold leading-none text-[var(--foreground)]">
          {latestSample.progress}%
        </div>
        <div className="mt-0.5 text-[10px] font-medium" style={{ color: statusMeta.stroke }}>
          {statusMeta.label}
        </div>
      </div>

      <div
        className="h-[40px] w-[14px] overflow-hidden rounded-sm"
        style={{ background: "var(--muted)" }}
        role="progressbar"
        aria-valuenow={latestSample.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Objective health"
        title={`${latestSample.progress}%`}
      >
        <div className="flex h-full flex-col justify-end">
          <div
            className="relative w-full overflow-hidden rounded-sm transition-[height] duration-700 ease-out"
            style={{
              height: mounted ? `${latestSample.progress}%` : "0%",
              backgroundColor: statusMeta.stroke,
            }}
          >
            <div
              className="absolute inset-0 animate-pulse"
              style={{
                background: `linear-gradient(0deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

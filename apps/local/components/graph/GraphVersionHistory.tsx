"use client";

import { useMemo } from "react";

import { useGraphUIStore } from "@/components/graph/useGraphUIStore";
import type { ExecutionGraph } from "@/src/graph/types";

interface GraphVersionHistoryProps {
  graph: ExecutionGraph;
}

interface HistoryRow {
  version: number;
  fromVersion: number;
  eventType: "replan" | "rollback";
  timestamp: string;
  reason: string;
  triggeredBy: "agent" | "human";
  checkpoint: string | null;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString();
}

function toHistoryRows(graph: ExecutionGraph): HistoryRow[] {
  return graph.versionHistory.map((event, index) => {
    const version =
      event.eventType === "replan"
        ? event.toVersion
        : Math.max(2, graph.graphVersion - (graph.versionHistory.length - index - 1));

    if (event.eventType === "replan") {
      return {
        version,
        fromVersion: event.fromVersion,
        eventType: "replan" as const,
        timestamp: event.timestamp,
        reason: event.reason,
        triggeredBy: event.triggeredBy,
        checkpoint: event.triggeredAtNodeId,
      };
    }

    return {
      version,
      fromVersion: Math.max(1, version - 1),
      eventType: "rollback" as const,
      timestamp: event.timestamp,
      reason: event.reason,
      triggeredBy: event.triggeredBy,
      checkpoint: event.toCheckpoint,
    };
  });
}

export default function GraphVersionHistory({ graph }: GraphVersionHistoryProps) {
  const openComparison = useGraphUIStore((state) => state.openComparison);

  const rows = useMemo(() => toHistoryRows(graph), [graph]);

  return (
    <section className="graph-panel-card graph-version-history">
      <div className="graph-panel-card__row">
        <div className="graph-panel-card__title">Graph Version History</div>
        <span className="graph-panel-card__hint">Current v{graph.graphVersion}</span>
      </div>

      {rows.length === 0 ? (
        <p className="graph-panel-card__empty">No replan or rollback events yet.</p>
      ) : (
        <ol className="graph-version-history__timeline">
          {rows.map((row) => (
            <li key={`${row.version}-${row.timestamp}-${row.eventType}`}>
              <div className="graph-version-history__dot" aria-hidden />
              <div className="graph-version-history__content">
                <div className="graph-panel-card__row">
                  <strong>
                    v{row.fromVersion} to v{row.version}
                  </strong>
                  <span className={`graph-version-history__badge graph-version-history__badge--${row.eventType}`}>
                    {row.eventType}
                  </span>
                </div>
                <p>{row.reason}</p>
                <div className="graph-panel-card__row">
                  <span className="graph-panel-card__hint">{formatTimestamp(row.timestamp)}</span>
                  <span className="graph-panel-card__hint">by {row.triggeredBy}</span>
                </div>
                {row.checkpoint ? (
                  <div className="graph-panel-card__hint">checkpoint: {row.checkpoint}</div>
                ) : null}
                <button
                  type="button"
                  className="graph-link-button"
                  onClick={() => openComparison(row.fromVersion, row.version)}
                >
                  Compare
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

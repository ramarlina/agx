"use client";

import { useMemo } from "react";

import { useGraphUIStore } from "@/components/graph/useGraphUIStore";
import type { ExecutionGraph, ReplanEvent } from "@/src/graph/types";

interface GraphComparisonModalProps {
  graph: ExecutionGraph;
}

function resolveEventVersion(graph: ExecutionGraph, index: number): number {
  const event = graph.versionHistory[index];
  if (!event) {
    return graph.graphVersion;
  }

  if (event.eventType === "replan") {
    return event.toVersion;
  }

  return Math.max(2, graph.graphVersion - (graph.versionHistory.length - index - 1));
}

function computeDiff(graph: ExecutionGraph, fromVersion: number, toVersion: number) {
  const replanEvents: ReplanEvent[] = [];
  graph.versionHistory.forEach((event, index) => {
    const version = resolveEventVersion(graph, index);
    if (event.eventType !== "replan") {
      return;
    }
    if (version > fromVersion && version <= toVersion) {
      replanEvents.push(event);
    }
  });

  const addedNodes = new Set<string>();
  const removedNodes = new Set<string>();
  const rewiredDeps = new Set<string>();
  const estimateDeltas: Record<string, number> = {};

  for (const event of replanEvents) {
    event.changes.addedNodes.forEach((nodeId) => addedNodes.add(nodeId));
    event.changes.removedNodes.forEach((nodeId) => removedNodes.add(nodeId));
    event.changes.rewiredDeps.forEach((dependency) => rewiredDeps.add(dependency));
    for (const [nodeId, delta] of Object.entries(event.changes.estimateDeltas)) {
      estimateDeltas[nodeId] = (estimateDeltas[nodeId] ?? 0) + delta;
    }
  }

  return {
    replanEvents,
    addedNodes: [...addedNodes].sort(),
    removedNodes: [...removedNodes].sort(),
    rewiredDeps: [...rewiredDeps].sort(),
    estimateDeltas,
  };
}

export default function GraphComparisonModal({ graph }: GraphComparisonModalProps) {
  const comparisonMode = useGraphUIStore((state) => state.comparisonMode);
  const fromVersion = useGraphUIStore((state) => state.comparisonFromVersion);
  const toVersion = useGraphUIStore((state) => state.comparisonToVersion);
  const closeComparison = useGraphUIStore((state) => state.closeComparison);

  const diff = useMemo(() => {
    if (!comparisonMode || fromVersion == null || toVersion == null) {
      return null;
    }
    return computeDiff(graph, fromVersion, toVersion);
  }, [comparisonMode, fromVersion, toVersion, graph]);

  if (!comparisonMode || fromVersion == null || toVersion == null || !diff) {
    return null;
  }

  return (
    <div className="modal-backdrop p-4 z-50" onClick={(event) => event.target === event.currentTarget && closeComparison()}>
      <div className="modal-content graph-comparison-modal animate-scale-in">
        <div className="graph-panel-card__row">
          <h3>Graph diff: v{fromVersion} to v{toVersion}</h3>
          <button type="button" className="graph-link-button" onClick={closeComparison}>
            Close
          </button>
        </div>

        <div className="graph-comparison-modal__summary">
          <div>
            <h4>Added nodes</h4>
            {diff.addedNodes.length ? (
              <ul>
                {diff.addedNodes.map((nodeId) => (
                  <li key={nodeId}>+ {nodeId}</li>
                ))}
              </ul>
            ) : (
              <p>None</p>
            )}
          </div>

          <div>
            <h4>Removed nodes</h4>
            {diff.removedNodes.length ? (
              <ul>
                {diff.removedNodes.map((nodeId) => (
                  <li key={nodeId}>- {nodeId}</li>
                ))}
              </ul>
            ) : (
              <p>None</p>
            )}
          </div>

          <div>
            <h4>Rewired dependencies</h4>
            {diff.rewiredDeps.length ? (
              <ul>
                {diff.rewiredDeps.map((rewired) => (
                  <li key={rewired}>~ {rewired}</li>
                ))}
              </ul>
            ) : (
              <p>None</p>
            )}
          </div>
        </div>

        <div className="graph-comparison-modal__events">
          <h4>Replan reasons</h4>
          {diff.replanEvents.length ? (
            <ul>
              {diff.replanEvents.map((event) => (
                <li key={`${event.fromVersion}-${event.toVersion}-${event.timestamp}`}>
                  <strong>
                    v{event.fromVersion} to v{event.toVersion}
                  </strong>
                  <p>{event.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No replan events in this range.</p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { use, useState } from "react";
import TrackerSetup from "@/components/tracking/TrackerSetup";
import { TrackerIcon } from "@/components/tracking/TrackerIcon";
import { useProjects } from "@/hooks/useProjects";
import { useTrackerConnection } from "@/hooks/useTrackerConnection";
import { useTrackerConnections } from "@/hooks/useTrackerConnections";

/**
 * Available tracker types for the picker UI.
 * Must match the adapters registered in lib/tracker/index.ts.
 */
const TRACKER_TYPES = [
  { type: "linear", label: "Linear" },
  { type: "jira", label: "Jira Cloud" },
] as const;

/**
 * Connect a new tracker to the project.
 * Shows a picker of available trackers, then a setup flow for the selected one.
 */
export default function TrackingConnectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects } = useProjects();
  const project = projects.find((p) => p.slug === slug);
  const projectId = project?.id ?? "";

  const { connections, loading: connectionsLoading } = useTrackerConnections(projectId);
  const connectedTypes = new Set(connections.filter((c) => c.connected).map((c) => c.type));

  const [selected, setSelected] = useState<string | null>(null);

  // Once a tracker type is selected, use the per-tracker connection hook
  const {
    connected: singleConnected,
    loading: singleLoading,
    connect,
    connectWithKey,
  } = useTrackerConnection(selected ?? "linear", projectId);

  if (connectionsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground" />
      </div>
    );
  }

  // If a tracker type is selected, show its setup flow
  if (selected) {
    const tracker = TRACKER_TYPES.find((t) => t.type === selected);
    return (
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <button
            onClick={() => setSelected(null)}
            className="text-sm text-muted-foreground hover:text-foreground mb-8"
          >
            ← Back to tracker picker
          </button>
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-xl font-semibold">Connect {tracker?.label ?? selected}</h2>
            <TrackerSetup
              projectId={projectId}
              trackerType={selected}
              connected={singleConnected}
              loading={singleLoading}
              onConnect={connect}
              onConnectWithKey={connectWithKey}
            />
          </div>
        </div>
      </div>
    );
  }

  // Show the tracker type picker
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <h2 className="text-xl font-semibold">Connect Issue Tracker</h2>
      <p className="text-[var(--muted-foreground)] text-center max-w-md">
        Choose an issue tracker to connect to this project.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        {TRACKER_TYPES.map((tracker) => {
          const isAlreadyConnected = connectedTypes.has(tracker.type);
          return (
            <button
              key={tracker.type}
              onClick={() => setSelected(tracker.type)}
              disabled={isAlreadyConnected}
              className={
                "flex flex-col items-center gap-3 p-6 rounded-lg border transition-colors " +
                (isAlreadyConnected
                  ? "border-border/50 bg-muted/30 cursor-default"
                  : "border-border hover:border-primary/50 hover:bg-accent/50 cursor-pointer")
              }
            >
              <TrackerIcon trackerType={tracker.type} className="h-8 w-8" />
              <span className="text-sm font-medium">{tracker.label}</span>
              {isAlreadyConnected && (
                <span className="text-xs text-muted-foreground">Connected</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

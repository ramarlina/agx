"use client";

import { use } from "react";
import TrackerSetup from "@/components/tracking/TrackerSetup";
import { useProjects } from "@/hooks/useProjects";
import { useTrackerConnection } from "@/hooks/useTrackerConnection";

/**
 * Connect a new tracker to the project.
 * Phase 1: Shows TrackerSetup component which supports OAuth and API key flows.
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
  const { connected, loading, connect, connectWithKey } = useTrackerConnection("linear", projectId);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <h2 className="text-xl font-semibold">Connect Issue Tracker</h2>
      <p className="text-[var(--muted-foreground)] text-center max-w-md">
        Connect an issue tracker to manage tickets, runs, and automations for
        this project.
      </p>
      <TrackerSetup
        projectId={projectId}
        trackerType="linear"
        connected={connected}
        loading={loading}
        onConnect={connect}
        onConnectWithKey={connectWithKey}
      />
    </div>
  );
}
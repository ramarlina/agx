"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import { useTrackerConnections } from "@/hooks/useTrackerConnections";
import TrackerBoard from "@/components/TrackerBoard";

/**
 * Tracker-agnostic board page.
 * Detects the first connected tracker and renders the TrackerBoard.
 */
export default function ProjectTrackingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const searchParams = useSearchParams();
  const { projects } = useProjects();
  const project = projects.find((p) => p.slug === slug);
  const showSettings = searchParams.get("settings") === "true";
  const { connections } = useTrackerConnections(project?.id ?? null);

  // Use the first connected tracker, default to "linear"
  const trackerType = connections.length > 0 ? connections[0].type : "linear";

  return (
    <TrackerBoard
      trackerType={trackerType}
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
    />
  );
}
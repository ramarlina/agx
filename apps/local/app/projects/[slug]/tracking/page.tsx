"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import { useTrackerConnections } from "@/hooks/useTrackerConnections";
import LinearBoard from "@/components/LinearBoard";

/**
 * Tracker-agnostic board page.
 * Phase 1: If the project has a Linear connection, renders the Linear board.
 * Phase 2: Will show a multi-tracker dashboard when multiple trackers are connected.
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

  // Phase 1: Default to Linear board
  return (
    <LinearBoard
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
    />
  );
}
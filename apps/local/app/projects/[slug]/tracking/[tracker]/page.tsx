"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import TrackerBoard from "@/components/TrackerBoard";

/**
 * Tracker-specific board page.
 * Renders the tracker-agnostic TrackerBoard for any connected tracker type.
 */
export default function ProjectTrackerPage({
  params,
}: {
  params: Promise<{ slug: string; tracker: string }>;
}) {
  const { slug, tracker } = use(params);
  const searchParams = useSearchParams();
  const { projects } = useProjects();
  const project = projects.find((p) => p.slug === slug);
  const showSettings = searchParams.get("settings") === "true";

  return (
    <TrackerBoard
      trackerType={tracker}
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
    />
  );
}
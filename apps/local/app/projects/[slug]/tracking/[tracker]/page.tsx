"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import LinearBoard from "@/components/LinearBoard";

/**
 * Tracker-specific board page.
 * Phase 1: Only 'linear' is supported; all tracker types delegate to LinearBoard.
 * Phase 2: Will dispatch based on tracker param (linear, jira, etc.).
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

  // Phase 1: All tracker types use the Linear board
  return (
    <LinearBoard
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
    />
  );
}
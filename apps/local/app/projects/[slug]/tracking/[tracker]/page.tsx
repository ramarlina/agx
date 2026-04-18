"use client";

import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import TrackerBoard from "@/components/TrackerBoard";

/**
 * Tracker-specific board page.
 * Renders the tracker-agnostic TrackerBoard for any connected tracker type.
 *
 * For GitHub, the `?repo=owner/name` query param seeds the group filter
 * and triggers a background sync (PRs + issues + task matching).
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
  const repoId = tracker === "github" ? searchParams.get("repo") : null;

  useEffect(() => {
    if (tracker !== "github" || !repoId || !project?.id) return;
    fetch("/api/github/repos/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, repoId }),
    }).catch(() => {
      // Best-effort background sync; failure is surfaced via stale cache
    });
  }, [tracker, repoId, project?.id]);

  return (
    <TrackerBoard
      trackerType={tracker}
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
      initialGroupId={repoId ?? undefined}
    />
  );
}
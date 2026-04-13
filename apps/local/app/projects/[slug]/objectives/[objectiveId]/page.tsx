"use client";

import { use } from "react";
import { ProjectObjectivesOverview } from "@/components/projects/ProjectObjectivesWorkspace";

export default function ProjectObjectiveDetailPage({
  params,
}: {
  params: Promise<{ slug: string; objectiveId: string }>;
}) {
  const { slug, objectiveId } = use(params);

  return (
    <ProjectObjectivesOverview
      projectSlug={slug}
      initialObjectiveId={objectiveId}
    />
  );
}

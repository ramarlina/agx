"use client";

import { use } from "react";
import { ProjectObjectiveDetail } from "@/components/projects/ProjectObjectivesWorkspace";

export default function ProjectObjectiveDetailPage({
  params,
}: {
  params: Promise<{ slug: string; objectiveId: string }>;
}) {
  const { slug, objectiveId } = use(params);

  return <ProjectObjectiveDetail projectSlug={slug} objectiveId={objectiveId} />;
}

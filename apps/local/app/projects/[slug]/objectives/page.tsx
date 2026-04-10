"use client";

import { use } from "react";
import { ProjectObjectivesOverview } from "@/components/projects/ProjectObjectivesWorkspace";

export default function ProjectObjectivesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  return <ProjectObjectivesOverview projectSlug={slug} />;
}

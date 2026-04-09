"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useProjects } from "@/hooks/useProjects";
import LinearBoard from "@/components/LinearBoard";

export default function ProjectLinearPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const searchParams = useSearchParams();
  const { projects } = useProjects();
  const project = projects.find((p) => p.slug === slug);
  const showSettings = searchParams.get("settings") === "true";

  return (
    <LinearBoard
      projectId={project?.id}
      projectSlug={project?.slug ?? slug}
      initialShowSettings={showSettings}
    />
  );
}

"use client";

import { use } from "react";
import { useProjects } from "@/hooks/useProjects";
import { PrReviewView } from "@/components/prs/review/PrReviewView";

interface PageProps {
  params: Promise<{ slug: string; prId: string }>;
}

export default function PrReviewPage({ params }: PageProps) {
  const { slug, prId } = use(params);
  const { projects } = useProjects();
  const projectId = projects.find((p) => p.slug === slug)?.id;
  return <PrReviewView prId={prId} projectId={projectId} />;
}

"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { readProjectObjectivesWorkspace } from "@/lib/project-objectives";
import { WorkingNowCard } from "./WorkingNowCard";
import { TeamsSummaryCard } from "./TeamsSummaryCard";
import { ObjectivesSummaryCard } from "./ObjectivesSummaryCard";
import { ScheduledTasksSummaryCard } from "./ScheduledTasksSummaryCard";
import { FoldersSummaryCard } from "./FoldersSummaryCard";
import { RecentThreadEntry, RecentThreadsSummaryCard } from "./RecentThreadsSummaryCard";

interface ProjectOverviewProps {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectDescription?: string;
  projectMetadata?: Record<string, unknown>;
  repos: Array<{ id: string; name: string; path?: string; git_url?: string }>;
  threadIds: string[];
}

export function ProjectOverview({
  projectId,
  projectSlug,
  projectName,
  projectDescription,
  projectMetadata,
  repos,
  threadIds,
}: ProjectOverviewProps) {
  const router = useRouter();
  const primaryThreadId = threadIds[0] ?? null;
  const objectiveThreadHrefById = useMemo(() => {
    const workspace = readProjectObjectivesWorkspace(projectMetadata);
    const entries = workspace.objectives.flatMap((objective) => {
      const href = `/projects/${projectSlug}/objectives/${encodeURIComponent(objective.id)}`;
      const threadIdsForObjective = new Set(
        [objective.threadId?.trim(), `objective-chat:${objective.id}`].filter(
          (value): value is string => Boolean(value)
        )
      );

      return Array.from(threadIdsForObjective).map((threadId) => [threadId, href] as const);
    });

    return new Map(entries);
  }, [projectMetadata, projectSlug]);

  const handleSelectThread = (thread: RecentThreadEntry) => {
    const objectiveHref = objectiveThreadHrefById.get(thread.threadId);
    if (objectiveHref) {
      router.push(objectiveHref);
      return;
    }

    router.push(
      `/projects/${projectSlug}/thread/${encodeURIComponent(thread.threadId)}?open=${encodeURIComponent(thread.id)}`
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {projectDescription && (
          <p className="mb-6 text-sm text-zinc-400">{projectDescription}</p>
        )}

        {/* Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TeamsSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}`)}
          />
          <ObjectivesSummaryCard
            projectSlug={projectSlug}
            onViewAll={() => router.push(`/projects/${projectSlug}/objectives`)}
          />
          <ScheduledTasksSummaryCard
            projectId={projectId}
            projectSlug={projectSlug}
            onViewAll={() => router.push(`/projects/${projectSlug}/automations`)}
          />
          <FoldersSummaryCard projectId={projectId} repos={repos} />
          <RecentThreadsSummaryCard
            projectId={projectId}
            onSelectThread={handleSelectThread}
            onViewAll={primaryThreadId ? () => {
              router.push(`/projects/${projectSlug}/thread/${encodeURIComponent(primaryThreadId)}`);
            } : undefined}
          />
        </div>

        {/* Working Now */}
        <div className="mt-4">
          <WorkingNowCard
            projectSlug={projectSlug}
            projectThreadIds={threadIds}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { TeamsSummaryCard } from "./TeamsSummaryCard";
import { ObjectivesSummaryCard } from "./ObjectivesSummaryCard";
import { ActiveTasksSummaryCard } from "./ActiveTasksSummaryCard";
import { ScheduledTasksSummaryCard } from "./ScheduledTasksSummaryCard";
import { FoldersSummaryCard } from "./FoldersSummaryCard";
import { RecentThreadsSummaryCard } from "./RecentThreadsSummaryCard";

interface ProjectOverviewProps {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectDescription?: string;
  repos: Array<{ id: string; name: string; path?: string; git_url?: string }>;
  threadIds: string[];
}

export function ProjectOverview({
  projectId,
  projectSlug,
  projectName,
  projectDescription,
  repos,
  threadIds,
}: ProjectOverviewProps) {
  const router = useRouter();

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
          <ActiveTasksSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}/automations`)}
          />
          <ScheduledTasksSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}/automations`)}
          />
          <FoldersSummaryCard projectId={projectId} repos={repos} />
          <RecentThreadsSummaryCard
            threadIds={threadIds}
            projectSlug={projectSlug}
            onSelectThread={(threadId) =>
              router.push(`/projects/${projectSlug}/thread/${encodeURIComponent(threadId)}`)
            }
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
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
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-zinc-100">{projectName}</h1>
            <button
              onClick={() => router.push(`/projects/${projectSlug}/settings`)}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Project settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
          {projectDescription && (
            <p className="mt-1 text-sm text-zinc-400">{projectDescription}</p>
          )}
        </div>

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
          <FoldersSummaryCard repos={repos} />
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

"use client";

import { useRouter } from "next/navigation";
import { WorkingNowCard } from "./WorkingNowCard";
import { TeamsSummaryCard } from "./TeamsSummaryCard";
import { ScheduledTasksSummaryCard } from "./ScheduledTasksSummaryCard";
import { FoldersSummaryCard } from "./FoldersSummaryCard";
import { ObjectivesSection } from "./home/ObjectivesSection";
import { ToolPathsSection } from "./home/ToolPathsSection";

interface ProjectHomeProps {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectDescription?: string;
  projectMetadata?: Record<string, unknown>;
  repos: Array<{ id: string; name: string; path?: string; git_url?: string }>;
  threadIds: string[];
}

export function ProjectHome({
  projectId,
  projectSlug,
  projectName,
  projectDescription,
  projectMetadata,
  repos,
  threadIds,
}: ProjectHomeProps) {
  const router = useRouter();
  const primaryThreadId = threadIds[0] ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {projectDescription && (
          <p className="text-sm text-zinc-400">{projectDescription}</p>
        )}

        {/* Objectives */}
        <section>
          <h2 className="text-sm text-zinc-500 mb-3">What you're working toward</h2>
          <ObjectivesSection projectId={projectId} projectSlug={projectSlug} />
        </section>

        {/* Tool entry points */}
        <section>
          <h2 className="text-sm text-zinc-500 mb-3">Start working</h2>
          <ToolPathsSection
            projectId={projectId}
            projectSlug={projectSlug}
            primaryThreadId={primaryThreadId}
          />
        </section>

        {/* Activity */}
        <section>
          <h2 className="text-sm text-zinc-500 mb-3">What's happening now</h2>
          <div className="space-y-4">
            <WorkingNowCard
              projectSlug={projectSlug}
              projectThreadIds={threadIds}
            />
            <ScheduledTasksSummaryCard
              projectId={projectId}
              projectSlug={projectSlug}
              onViewAll={() => router.push(`/projects/${projectSlug}/automations`)}
            />
          </div>
        </section>

        {/* Project context — no label */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FoldersSummaryCard projectId={projectId} repos={repos} />
          <TeamsSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}/teams`)}
          />
        </div>
      </div>
    </div>
  );
}

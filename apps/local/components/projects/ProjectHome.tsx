"use client";

import { useRouter } from "next/navigation";
import { WorkingNowCard } from "./WorkingNowCard";
import { RecentlyCompletedCard } from "./RecentlyCompletedCard";
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
  projectDescription,
  threadIds,
}: ProjectHomeProps) {
  const router = useRouter();
  const primaryThreadId = threadIds[0] ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {projectDescription && (
          <p className="text-sm text-[var(--muted-foreground)]">{projectDescription}</p>
        )}

        {/* Objectives */}
        <section>
          <h2 className="mb-3 text-sm text-[var(--muted-foreground)]">What you're working toward</h2>
          <ObjectivesSection projectId={projectId} projectSlug={projectSlug} />
        </section>

        {/* Tool entry points */}
        <section>
          <h2 className="mb-3 text-sm text-[var(--muted-foreground)]">Start working</h2>
          <ToolPathsSection
            projectId={projectId}
            projectSlug={projectSlug}
            primaryThreadId={primaryThreadId}
          />
        </section>

        {/* Activity */}
        <section>
          <h2 className="mb-3 text-sm text-[var(--muted-foreground)]">What's happening now</h2>
          <div className="space-y-4">
            <ScheduledTasksSummaryCard
              projectId={projectId}
              projectSlug={projectSlug}
              onViewAll={() => router.push(`/projects/${projectSlug}/automations`)}
            />
            <WorkingNowCard
              projectSlug={projectSlug}
              projectThreadIds={threadIds}
            />
            <RecentlyCompletedCard
              projectId={projectId}
              projectSlug={projectSlug}
              projectThreadIds={threadIds}
            />
          </div>
        </section>

        {/* Project context — no label */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FoldersSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}/folders`)}
          />
          <TeamsSummaryCard
            projectId={projectId}
            onViewAll={() => router.push(`/projects/${projectSlug}/teams`)}
          />
        </div>
      </div>
    </div>
  );
}

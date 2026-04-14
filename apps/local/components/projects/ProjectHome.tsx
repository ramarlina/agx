"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, FolderKanban, Gauge, Sparkles } from "lucide-react";
import { WorkingNowCard } from "./WorkingNowCard";
import { TeamsSummaryCard } from "./TeamsSummaryCard";
import { ScheduledTasksSummaryCard } from "./ScheduledTasksSummaryCard";
import { FoldersSummaryCard } from "./FoldersSummaryCard";
import { RecentThreadsSummaryCard, type RecentThreadEntry } from "./RecentThreadsSummaryCard";
import { GettingStartedSection } from "./home/GettingStartedSection";
import { ObjectivesSection } from "./home/ObjectivesSection";
import { ToolPathsSection } from "./home/ToolPathsSection";
import { readProjectObjectivesWorkspace } from "@/lib/project-objectives";

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
  const [liveCount, setLiveCount] = useState(0);
  const objectivesWorkspace = useMemo(
    () => readProjectObjectivesWorkspace(projectMetadata),
    [projectMetadata]
  );
  const objectiveByThreadId = useMemo(
    () =>
      new Map(
        objectivesWorkspace.objectives
          .filter((objective) => objective.threadId)
          .map((objective) => [objective.threadId as string, objective.id])
      ),
    [objectivesWorkspace]
  );

  useEffect(() => {
    if (typeof fetch !== "function") {
      return;
    }

    let cancelled = false;
    const threadIdSet = new Set(threadIds.map((id) => id.trim()).filter(Boolean));
    const normalizedSlug = projectSlug.trim().toLowerCase();

    const loadLiveCount = async () => {
      try {
        const response = await fetch("/api/processes?enrich=1");
        if (!response.ok || cancelled) return;
        const items = (await response.json()) as Array<{
          projectSlug?: string;
          workspaceId?: string;
          threadId?: string;
          state?: string;
        }>;
        if (cancelled) return;
        const relevant = items.filter((item) => {
          if (item.state !== "spawning" && item.state !== "running") return false;
          if ((item.projectSlug ?? "").trim().toLowerCase() === normalizedSlug) return true;
          return threadIdSet.has((item.workspaceId ?? "").trim()) || threadIdSet.has((item.threadId ?? "").trim());
        });
        setLiveCount(relevant.length);
      } catch {
        if (!cancelled) {
          setLiveCount(0);
        }
      }
    };

    void loadLiveCount();
    const intervalId = window.setInterval(() => {
      void loadLiveCount();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [projectSlug, threadIds]);

  const handleRecentThreadSelect = (thread: RecentThreadEntry) => {
    const objectiveId = objectiveByThreadId.get(thread.threadId);
    if (objectiveId) {
      router.push(`/projects/${projectSlug}/objectives/${encodeURIComponent(objectiveId)}`);
      return;
    }

    router.push(
      `/projects/${projectSlug}/thread/${encodeURIComponent(thread.threadId)}?open=${encodeURIComponent(thread.id)}`
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <section className="rounded-[28px] border border-[var(--card-border)] bg-[var(--card-bg)] px-6 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                <Sparkles className="h-3.5 w-3.5" />
                Home
                {liveCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] tracking-[0.18em] text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-[var(--foreground)]">{projectName}</h1>
                <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
                  {projectDescription?.trim() || "Direction, execution paths, and live momentum for this project in one place."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  <FolderKanban className="h-3.5 w-3.5" />
                  Direction
                </div>
                <p className="mt-2 text-sm text-[var(--foreground)]">Objectives define what matters next.</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  <ArrowRight className="h-3.5 w-3.5" />
                  Paths
                </div>
                <p className="mt-2 text-sm text-[var(--foreground)]">Chat, terminal, and Linear stay one click away.</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  <Gauge className="h-3.5 w-3.5" />
                  Momentum
                </div>
                <p className="mt-2 text-sm text-[var(--foreground)]">
                  {liveCount > 0 ? `${liveCount} live ${liveCount === 1 ? "signal" : "signals"} right now.` : "No live activity right now."}
                </p>
              </div>
            </div>
          </div>
        </section>

        <GettingStartedSection
          projectName={projectName}
          projectSlug={projectSlug}
          primaryThreadId={primaryThreadId}
        />

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <FolderKanban className="h-4 w-4 text-[var(--muted-foreground)]" />
            Direction
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Objectives make the project trajectory visible and keep the next irreversible move explicit.
          </p>
          <ObjectivesSection projectId={projectId} projectSlug={projectSlug} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <ArrowRight className="h-4 w-4 text-[var(--muted-foreground)]" />
            Paths
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Pick the execution surface that matches the work: conversation, terminal control, or linked tickets.
          </p>
          <ToolPathsSection
            projectId={projectId}
            projectSlug={projectSlug}
            primaryThreadId={primaryThreadId}
          />
        </section>

        <section className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <Activity className="h-4 w-4 text-[var(--muted-foreground)]" />
              Momentum
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Running agents, scheduled work, and recent thread activity in one scan.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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

          <RecentThreadsSummaryCard
            projectId={projectId}
            title="Recent Activity"
            emptyLabel="No activity yet"
            onSelectThread={handleRecentThreadSelect}
            onViewAll={() => router.push(primaryThreadId ? `/projects/${projectSlug}/thread/${encodeURIComponent(primaryThreadId)}` : `/projects/${projectSlug}`)}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
            <FolderKanban className="h-4 w-4 text-[var(--muted-foreground)]" />
            Project Context
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            The folders and teams that anchor work in the real project surface.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FoldersSummaryCard projectId={projectId} repos={repos} />
            <TeamsSummaryCard
              projectId={projectId}
              onViewAll={() => router.push(`/projects/${projectSlug}/teams`)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

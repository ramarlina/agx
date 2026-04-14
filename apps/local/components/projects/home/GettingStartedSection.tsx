"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, BookOpenText, FolderOpen, MessageSquare, Target } from "lucide-react";

interface GettingStartedSectionProps {
  projectName: string;
  projectSlug: string;
  primaryThreadId: string | null;
}

export function GettingStartedSection({
  projectName,
  projectSlug,
  primaryThreadId,
}: GettingStartedSectionProps) {
  const router = useRouter();

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card-bg)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
          <BookOpenText className="h-4 w-4 text-[var(--primary)]" />
          Start here
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {projectName} is your project home base
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
          Everything on this page is organized around one project. Add context first, decide what the
          project is trying to achieve, then use chat and automations to keep work moving.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push(`/projects/${projectSlug}/folders`)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--card-hover-border)] hover:bg-[var(--secondary)]"
          >
            <FolderOpen className="mb-3 h-4 w-4 text-amber-400" />
            <div className="text-sm font-medium text-[var(--foreground)]">1. Add folders</div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              Attach repos or docs so the project has real working context.
            </p>
          </button>

          <button
            type="button"
            onClick={() => router.push(`/projects/${projectSlug}/objectives`)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--card-hover-border)] hover:bg-[var(--secondary)]"
          >
            <Target className="mb-3 h-4 w-4 text-emerald-400" />
            <div className="text-sm font-medium text-[var(--foreground)]">2. Define an objective</div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              Capture what success looks like before you branch into tools and agents.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!primaryThreadId) return;
              router.push(`/projects/${projectSlug}/thread/${encodeURIComponent(primaryThreadId)}`);
            }}
            className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--card-hover-border)] hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!primaryThreadId}
          >
            <MessageSquare className="mb-3 h-4 w-4 text-indigo-400" />
            <div className="text-sm font-medium text-[var(--foreground)]">3. Start in chat</div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              Use chat for active work inside this project once context and goals are set.
            </p>
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--card-bg)] p-6 shadow-sm">
        <div className="mb-4 text-sm font-medium text-[var(--foreground)]">How AGX is organized</div>
        <div className="space-y-4 text-sm leading-6 text-[var(--muted-foreground)]">
          <div>
            <div className="font-medium text-[var(--foreground)]">Project</div>
            <p>Folders, teams, objectives, chats, and scheduled tasks all belong to this project.</p>
          </div>
          <div>
            <div className="font-medium text-[var(--foreground)]">Chat</div>
            <p>Chat is where you work with the project context already attached here.</p>
          </div>
          <div>
            <div className="font-medium text-[var(--foreground)]">Scheduled tasks and Linear</div>
            <p>Add automations and ticket sync after the project has enough context to act on.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectSlug}/settings`)}
          className="mt-5 inline-flex items-center gap-1 text-sm text-[var(--foreground)] transition-colors hover:text-[var(--primary)]"
        >
          Project settings <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

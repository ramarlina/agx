// app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Loader2, Users } from "lucide-react";
import { EmptyStateCard } from "@/components/EmptyStateCard";

type HomeState =
  | { kind: "loading" }
  | { kind: "no-project" }
  | { kind: "no-team"; projectSlug: string; projectName: string }
  | { kind: "ready"; projectSlug: string };

export default function Home() {
  const router = useRouter();
  const [state, setState] = useState<HomeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          router.replace("/setup");
          return;
        }

        const data = await res.json();
        const projects = Array.isArray(data?.projects) ? data.projects : [];
        if (projects.length === 0) {
          // If no providers are installed/authenticated, send to /setup first.
          const providersRes = await fetch("/api/providers", { cache: "no-store" });
          if (cancelled) return;
          const providersData = providersRes.ok ? await providersRes.json() : { providers: [] };
          const providerList = Array.isArray(providersData?.providers) ? providersData.providers : [];
          const anyReady = providerList.some((p: { installed?: boolean; authenticated?: boolean }) => p?.installed && p?.authenticated);
          if (!anyReady) {
            router.replace("/setup");
            return;
          }
          setState({ kind: "no-project" });
          return;
        }

        const first = projects[0];
        const teamsRes = await fetch(`/api/projects/${first.id}/teams`, { cache: "no-store" });
        if (cancelled) return;
        const teamsData = teamsRes.ok ? await teamsRes.json() : { teams: [] };
        const teams = Array.isArray(teamsData?.teams) ? teamsData.teams : [];

        if (teams.length === 0) {
          setState({ kind: "no-team", projectSlug: first.slug, projectName: first.name });
          return;
        }

        router.replace(`/projects/${first.slug}`);
      } catch {
        if (!cancelled) router.replace("/setup");
      }
    })();

    return () => { cancelled = true; };
  }, [router]);

  if (state.kind === "loading" || state.kind === "ready") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[var(--background)]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (state.kind === "no-project") {
    return (
      <div className="h-screen w-full bg-[var(--background)]">
        <EmptyStateCard
          icon={<FolderPlus className="w-6 h-6 text-[var(--foreground)]" />}
          title="Create your first project"
          description="A project groups your tickets, repos, and PRs — plus the agent teams that work them. Create one to get started."
          ctaLabel="Create a project"
          ctaHref="/projects?new=1"
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[var(--background)]">
      <EmptyStateCard
        icon={<Users className="w-6 h-6 text-[var(--foreground)]" />}
        title={`Add a team to ${state.projectName}`}
        description="Teams give your project the agents that will actually do the work. Add one to get started."
        ctaLabel="Add a team"
        ctaHref={`/projects/${state.projectSlug}/teams/new`}
      />
    </div>
  );
}

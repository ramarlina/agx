// hooks/useSetupFlow.ts
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ProjectData } from "@/components/setup/ProjectStep";
import type { SelectedTeam } from "@/components/setup/TeamsStep";

export type SetupStep = 1 | 2 | 3 | 4;

export interface SetupFlowState {
  step: SetupStep;
  project: ProjectData;
  teams: SelectedTeam[];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "project";
}

export function useSetupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(1);
  const [project, setProject] = useState<ProjectData>({ name: "", description: "", folders: [] });
  const [teams, setTeams] = useState<SelectedTeam[]>([]);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, 4) as SetupStep);
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 1) as SetupStep);
  }, []);

  const complete = useCallback(async () => {
    setCompleting(true);
    setError(null);
    try {
      const slug = slugify(project.name);
      const repos = project.folders.map((f) => ({ name: f.name, path: f.path }));

      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: project.name, description: project.description || undefined, repos }),
      });

      if (!projectRes.ok) {
        const data = await projectRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create project");
      }

      const { project: createdProject } = await projectRes.json();
      const projectId = createdProject.id;

      for (const team of teams) {
        await fetch(`/api/projects/${projectId}/teams`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: team.templateId,
            variantId: team.variantId,
            name: team.name,
          }),
        });
      }

      router.push(`/projects/${createdProject.slug || slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setCompleting(false);
    }
  }, [project, teams, router]);

  return {
    step, project, teams, completing, error,
    setProject, setTeams,
    goNext, goBack, complete,
  };
}

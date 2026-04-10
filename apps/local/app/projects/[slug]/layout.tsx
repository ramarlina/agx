"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { useThreadState } from "@/hooks/useThreadState";
import type { Participant } from "@/lib/types";
import {
  loadWorkspaceSidebarVisible,
  persistWorkspaceSidebarVisible,
} from "@/state/uiSettings";
import { loadWorkspaceWidth, persistWorkspaceWidth } from "@/state/windowState";
import "@/styles/workspaceSidebar.css";

function ProjectLayoutContent({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const {
    projects,
    isLoading: projectsLoading,
    createProject,
    updateProject,
    deleteProject,
    addAgent: addAgentToProject,
    removeAgent: removeAgentFromProject,
  } = useProjectsWithAgents();
  const {
    threads,
    isLoading: threadsLoading,
    isCreating,
    deletingThreadId,
    renamingThreadId,
    isRestoringActiveThread,
    createThread,
    renameThread,
    deleteThread,
  } = useThreadState();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(368);

  useEffect(() => {
    setSidebarVisible(loadWorkspaceSidebarVisible());
    setSidebarWidth(loadWorkspaceWidth() || 368);
  }, []);

  useEffect(() => {
    void fetch("/api/participants")
      .then((response) => response.json())
      .then((data) => setParticipants(Array.isArray(data) ? data : []))
      .catch(() => setParticipants([]));
  }, []);

  const currentProject = useMemo(
    () => projects.find((project) => project.slug === slug) ?? null,
    [projects, slug]
  );
  const activeProjectThreadId = useMemo(() => {
    const match = pathname.match(/\/projects\/[^/]+\/thread\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : currentProject?.thread_ids[0] ?? null;
  }, [currentProject?.thread_ids, pathname]);
  const activeProjectView = useMemo<"overview" | "objectives" | "thread" | "knowledge" | "automations" | "linear">(
    () => {
      if (pathname.includes("/linear")) return "linear";
      if (pathname.includes("/automations")) return "automations";
      if (pathname.includes("/thread/")) return "thread";
      if (pathname.includes("/knowledge")) return "knowledge";
      if (pathname.includes("/objectives")) return "objectives";
      return "overview";
    },
    [pathname]
  );

  const toggleSidebar = () => {
    const next = !sidebarVisible;
    setSidebarVisible(next);
    persistWorkspaceSidebarVisible(next);
  };

  const handleSidebarWidthChange = useCallback((w: number) => {
    setSidebarWidth(w);
    persistWorkspaceWidth(w);
  }, []);

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <h2 className="text-xl font-bold mb-2">Project Not Found</h2>
        <p className="text-[var(--muted-foreground)] mb-4">
          The project &ldquo;{slug}&rdquo; does not exist or you do not have access to it.
        </p>
        <button
          onClick={() => router.push("/projects")}
          className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-dark)] transition-colors"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--background)]">
      <WorkspaceSidebar
        threads={threads}
        participants={participants}
        activeThreadId={activeProjectThreadId}
        isLoading={threadsLoading}
        isRestoringActiveThread={isRestoringActiveThread}
        isCreating={isCreating}
        deletingThreadId={deletingThreadId}
        renamingThreadId={renamingThreadId}
        onSelectThread={(threadId) => router.push(`/projects/${slug}/thread/${encodeURIComponent(threadId)}`)}
        onCreateThread={createThread}
        onRenameThread={renameThread}
        onDeleteThread={deleteThread}
        visible={sidebarVisible}
        onToggle={toggleSidebar}
        width={sidebarWidth}
        onWidthChange={handleSidebarWidthChange}
        projects={projects}
        onCreateProject={createProject}
        onUpdateProject={updateProject}
        onDeleteProject={deleteProject}
        onAddAgentToProject={addAgentToProject}
        onRemoveAgentFromProject={removeAgentFromProject}
        activeProjectId={currentProject.id}
        activeProjectView={activeProjectView}
        onUpdateParticipant={async (participant) => {
          const response = await fetch("/api/participants", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(participant),
          });
          if (!response.ok) {
            throw new Error("Failed to update agent");
          }
          const updated = await response.json();
          setParticipants((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        }}
        onSelectProject={(projectId) => {
          const project = projects.find((item) => item.id === projectId);
          if (project) {
            router.push(`/projects/${project.slug}`);
          }
        }}
      />
      <div className="flex-1 min-h-0 flex flex-col min-w-0 h-full overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Loading project…</div>}>
      <ProjectLayoutContent params={params}>{children}</ProjectLayoutContent>
    </Suspense>
  );
}

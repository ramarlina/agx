"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { ArrowLeft, PanelLeftOpen, Sun, Moon } from "lucide-react";
import { StatusIndicator } from "@/components/chat-ui/StatusIndicator";
import { ProjectSearchBar } from "@/components/projects/ProjectSearchBar";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { useThreadState } from "@/hooks/useThreadState";
import { useSidebarStage } from "@/hooks/useSidebarStage";
import type { Participant } from "@/lib/types";
import {
  loadWorkspaceSidebarVisible,
  persistWorkspaceSidebarVisible,
} from "@/state/uiSettings";
import { loadWorkspaceWidth, persistWorkspaceWidth } from "@/state/windowState";
import "@/styles/workspaceSidebar.css";

const THEME_STORAGE_KEY = "agx-theme";

function ProjectLayoutContent({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { isTouchLayout } = useInputCapabilities();
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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    setSidebarVisible(loadWorkspaceSidebarVisible());
    setSidebarWidth(loadWorkspaceWidth() || 368);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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
  const activeProjectView = useMemo<"home" | "objectives" | "teams" | "thread" | "threads" | "knowledge" | "automations" | "linear" | "terminal" | "settings" | "env-vars" | "folders">(
    () => {
      if (pathname.includes("/linear")) return "linear";
      if (pathname.includes("/automations")) return "automations";
      if (pathname.includes("/thread/")) return "thread";
      if (pathname.endsWith("/threads")) return "threads";
      if (pathname.includes("/knowledge")) return "knowledge";
      if (pathname.includes("/objectives")) return "objectives";
      if (pathname.includes("/teams")) return "teams";
      if (pathname.includes("/folders")) return "folders";
      if (pathname.includes("/env-vars")) return "env-vars";
      if (pathname.includes("/terminal")) return "terminal";
      if (pathname.includes("/settings")) return "settings";
      return "home";
    },
    [pathname]
  );

  // Progressive sidebar stage gating.
  const { show: stageShow, loading: stageLoading } = useSidebarStage(currentProject);

  // Redirect if the user is on a route hidden by the current stage.
  useEffect(() => {
    if (stageLoading || !currentProject) return;
    const hiddenRouteMap: Record<string, keyof typeof stageShow> = {
      objectives: "objectives",
      linear: "linear",
      automations: "scheduledTasks",
      teams: "teams",
      folders: "folders",
      "env-vars": "envVars",
    };
    const requiredFlag = hiddenRouteMap[activeProjectView];
    if (requiredFlag && !stageShow[requiredFlag]) {
      router.replace(`/projects/${slug}`);
    }
  }, [stageLoading, stageShow, activeProjectView, slug, currentProject, router]);

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
        stageShow={stageShow}
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
        <div className="desktop-titlebar flex items-center px-4 py-2 border-b border-[var(--app-shell-border)] bg-[var(--background)] shrink-0">
          {/* Left: back + breadcrumb */}
          <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
            {!sidebarVisible && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
                title="Show sidebar"
                aria-label="Show sidebar"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
            {pathname !== `/projects/${slug}` && (
              <button
                type="button"
                onClick={() => router.back()}
                className="p-1 -ml-1 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push(`/projects/${slug}`)}
              className={`text-xs transition-colors ${activeProjectView === "home" ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              {currentProject.name}
            </button>
            {activeProjectView !== "home" && (
              <>
                <span className="text-xs text-[var(--muted-foreground)]">\</span>
                <button
                  type="button"
                  onClick={() => router.push(`/projects/${slug}/${activeProjectView === "thread" ? "" : activeProjectView}`)}
                  className="text-xs text-[var(--foreground)] hover:text-[var(--muted-foreground)] transition-colors"
                >
                  {{ objectives: "Objectives", teams: "Teams", folders: "Folders", "env-vars": "Environment Variables", linear: "Tasks", automations: "Scheduled Jobs", thread: "Chat", threads: "Threads", knowledge: "Knowledge", terminal: "Terminal", settings: "Settings" }[activeProjectView] ?? activeProjectView}
                </button>
                <span id="topbar-breadcrumb" className="contents" />
              </>
            )}
          </div>

          {/* Center: persistent project search */}
          <div className="flex-1 flex justify-center min-w-0 px-4">
            <ProjectSearchBar projectId={currentProject.id} />
          </div>

          {/* Right: status + theme */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusIndicator />
            <button
              type="button"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className={`inline-flex items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] ${isTouchLayout ? "h-9 w-9" : "h-7 w-7"}`}
            >
              {theme === "dark" ? <Sun className={isTouchLayout ? "h-4 w-4" : "h-3.5 w-3.5"} /> : <Moon className={isTouchLayout ? "h-4 w-4" : "h-3.5 w-3.5"} />}
            </button>
          </div>
        </div>
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

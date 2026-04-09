"use client";

import { useState, useEffect, useCallback } from "react";
import { WorkspaceSidebar } from "@/components/thread/WorkspaceSidebar";
import {
  loadWorkspaceSidebarVisible,
  persistWorkspaceSidebarVisible,
} from "@/state/uiSettings";
import { loadWorkspaceWidth, persistWorkspaceWidth } from "@/state/windowState";
import { useProjectsWithAgents, useProjects } from "@/hooks/useProjects";
import "@/styles/workspaceSidebar.css";
import PromptJobBoard from "@/components/PromptJobBoard";

export default function AutomationsPage() {
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(368);

  useEffect(() => {
    setSidebarVisible(loadWorkspaceSidebarVisible());
    setSidebarWidth(loadWorkspaceWidth() || 368);
  }, []);

  const toggleSidebar = () => {
    setSidebarVisible((prev) => {
      const next = !prev;
      persistWorkspaceSidebarVisible(next);
      return next;
    });
  };

  const handleSidebarWidthChange = useCallback((w: number) => {
    setSidebarWidth(w);
    persistWorkspaceWidth(w);
  }, []);

  const {
    projects,
    createProject,
    deleteProject,
  } = useProjectsWithAgents();
  const { updateProject } = useProjects();

  return (
    <div className="flex h-screen bg-[var(--card-bg)] text-[var(--foreground)]">
      <WorkspaceSidebar
        threads={[]}
        activeThreadId={null}
        isLoading={false}
        isCreating={false}
        onSelectThread={() => {}}
        onCreateThread={() => {}}
        onRenameThread={() => {}}
        onDeleteThread={() => {}}
        visible={sidebarVisible}
        onToggle={toggleSidebar}
        width={sidebarWidth}
        onWidthChange={handleSidebarWidthChange}
        projects={projects}
        onCreateProject={createProject}
        onUpdateProject={updateProject}
        onDeleteProject={deleteProject}
      />
      <div className="flex-1 min-w-0 overflow-auto">
        <PromptJobBoard />
      </div>
    </div>
  );
}

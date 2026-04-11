"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Zap,
  Folder,
  FolderGit2,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  ExternalLink,
  Settings,
  Target,
  Users,
  Home,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import type { Thread } from "@/lib/storage";
import type { Participant } from "@/lib/types";
import type { ProjectRepo, ProjectWithAgents, ProjectWithRepos, UpdateProjectPayload } from "@/hooks/useProjects";
import { useFocusManagement } from "@/hooks/useFocusManagement";
import { agentAvatarUrl, AgentForm, type AgentFormData } from "@/components/chat-ui/ParticipantBar";
import ProjectModal, { createProjectPayload, useProjectFormState } from "@/components/ProjectModal";
import { readProjectObjectivesWorkspace } from "@/lib/project-objectives";

interface WorkspaceSidebarProps {
  threads: Thread[];
  participants?: Participant[];
  activeThreadId: string | null;
  isLoading: boolean;
  isCreating: boolean;
  onSelectThread: (threadId: string) => void;
  onCreateThread: (input?: { title?: string }) => Promise<unknown> | void;
  onRenameThread: (threadId: string, title: string) => Promise<unknown> | void;
  onDeleteThread: (threadId: string) => void;
  deletingThreadId?: string | null;
  renamingThreadId?: string | null;
  activeParticipantIds?: string[];
  onToggleParticipantActive?: (participantId: string, active: boolean) => void;
  visible?: boolean;
  isRestoringActiveThread?: boolean;
  onToggle?: () => void;
  onSearch?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  // Projects
  projects?: ProjectWithAgents[];
  onCreateProject?: (payload: { name: string; description?: string; repos?: Array<{ name: string; path?: string; notes?: string }> }, threadId?: string) => Promise<unknown>;
  onUpdateProject?: (projectId: string, payload: UpdateProjectPayload) => Promise<unknown>;
  onDeleteProject?: (id: string) => Promise<unknown>;
  onAddAgentToProject?: (projectId: string, agentId: string) => Promise<unknown>;
  onRemoveAgentFromProject?: (projectId: string, agentId: string) => Promise<unknown>;
  onAddAgentViaForm?: (projectId: string) => void;
  onReorderProjectAgents?: (projectId: string, orderedAgentIds: string[]) => Promise<unknown>;
  onUpdateParticipant?: (participant: Participant) => Promise<unknown>;
  onSelectProject?: (projectId: string) => void;
  activeProjectId?: string | null;
  activeProjectView?: "overview" | "objectives" | "teams" | "thread" | "knowledge" | "automations" | "linear" | "settings" | null;
  onAddTeam?: (projectId: string) => void;
}

function WorkspaceSidebarBrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`workspace-sidebar__brand-logo${compact ? " workspace-sidebar__brand-logo--compact" : ""}`}
      aria-hidden="true"
    >
      <span className="workspace-sidebar__brand-grid">
        <span className="workspace-sidebar__brand-dot workspace-sidebar__brand-dot--blue" />
        <span className="workspace-sidebar__brand-dot workspace-sidebar__brand-dot--yellow" />
        <span className="workspace-sidebar__brand-dot workspace-sidebar__brand-dot--mint" />
        <span className="workspace-sidebar__brand-dot workspace-sidebar__brand-dot--red" />
      </span>
      <span className="workspace-sidebar__brand-text">AGX</span>
    </span>
  );
}

export function WorkspaceSidebar({
  threads,
  participants = [],
  activeThreadId,
  isLoading,
  isCreating,
  onSelectThread,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
  deletingThreadId = null,
  renamingThreadId = null,
  activeParticipantIds = [],
  onToggleParticipantActive,
  visible = false,
  isRestoringActiveThread = false,
  onToggle,
  onSearch,
  projects: projectsProp = [],
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onAddAgentToProject,
  onRemoveAgentFromProject,
  onAddAgentViaForm,
  onReorderProjectAgents,
  onUpdateParticipant,
  onSelectProject,
  activeProjectId = null,
  activeProjectView = null,
  width,
  onWidthChange,
  onAddTeam,
}: WorkspaceSidebarProps) {
  const resizing = useRef(false);
  const lastX = useRef(0);
  const emptyCtaRef = useRef<HTMLButtonElement | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  // Auto-expand the first project (or the active one) on initial load
  useEffect(() => {
    if (expandedProjects.size > 0 || !projectsProp?.length) return;
    const activeProject = projectsProp.find((p: ProjectWithAgents) =>
      typeof window !== 'undefined' && window.location.pathname.includes(`/projects/${p.slug}`)
    );
    setExpandedProjects(new Set([activeProject?.id ?? projectsProp[0].id]));
  }, [projectsProp]);
  const [addAgentModal, setAddAgentModal] = useState<{ projectId: string } | null>(null);
  const [addAgentSelection, setAddAgentSelection] = useState<Set<string>>(new Set());
  const [creatingNewAgent, setCreatingNewAgent] = useState(false);
  const [createProjectModal, setCreateProjectModal] = useState<{ threadId?: string } | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectWithRepos | null>(null);
  const projectFormState = useProjectFormState();

  // Generic text input modal state
  const [inputModal, setInputModal] = useState<{
    title: string;
    placeholder: string;
    defaultValue: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  const inputModalRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Agent detail modal
  const [agentDetailId, setAgentDetailId] = useState<string | null>(null);
  const agentDetailAgent = agentDetailId ? participants.find((p) => p.id === agentDetailId) ?? null : null;
  const [repoDetail, setRepoDetail] = useState<{
    projectId: string;
    projectName: string;
    repoId: string | null;
    name: string;
    path: string;
    gitUrl: string;
    notes: string;
    generatedKnowledge: Array<{ id: string; content: string; created_at?: string }>;
    isLoadingKnowledge: boolean;
    isSaving: boolean;
    error: string | null;
  } | null>(null);

  // Team grouping state
  interface TeamAgent { team_id: string; agent_id: string; role_key: string; routing_order: number }
  interface TeamWithAgents { id: string; name: string; template_id?: string; metadata?: Record<string, unknown>; agents: TeamAgent[] }
  const [teamsByProject, setTeamsByProject] = useState<Record<string, TeamWithAgents[]>>({});
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [teamsFetchedFor, setTeamsFetchedFor] = useState<Set<string>>(new Set());
  const objectiveThreadMaintenanceRef = useRef<Set<string>>(new Set());

  // Fetch teams when a project section is expanded
  useEffect(() => {
    Array.from(expandedProjects).forEach((projectId) => {
      if (teamsFetchedFor.has(projectId)) return;
      setTeamsFetchedFor((prev) => new Set(prev).add(projectId));
      void (async () => {
        try {
          const res = await fetch(`/api/projects/${projectId}/teams`);
          if (!res.ok) return;
          const data = await res.json();
          setTeamsByProject((prev) => ({ ...prev, [projectId]: data.teams ?? [] }));
        } catch { /* silent */ }
      })();
    });
  }, [expandedProjects, teamsFetchedFor]);

  const toggleTeamExpanded = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Agent drag-to-reorder state
  const [dragState, setDragState] = useState<{ projectId: string; agentId: string; overIndex: number } | null>(null);

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleCreateProject = (threadId?: string) => {
    projectFormState.resetForm();
    setEditingProject(null);
    setCreateProjectModal(threadId ? { threadId } : {});
  };

  const handleProjectModalSubmit = async () => {
    if (!createProjectModal && !editingProject) return;
    if (!projectFormState.form.name.trim()) {
      projectFormState.setFormError("Project name is required");
      return;
    }
    const invalidRepo = projectFormState.repos.find((repo) => repo.name.trim() && !repo.path.trim());
    if (invalidRepo) {
      projectFormState.setFormError(`Local path is required for folder "${invalidRepo.name}"`);
      return;
    }
    projectFormState.setFormError(null);
    projectFormState.setIsSubmitting(true);
    const payload = createProjectPayload(projectFormState.form, projectFormState.repos);
    if (editingProject) {
      await onUpdateProject?.(editingProject.id, payload);
    } else {
      await onCreateProject?.(payload, createProjectModal?.threadId);
    }
    projectFormState.setIsSubmitting(false);
    setCreateProjectModal(null);
    setEditingProject(null);
  };

  const handleOpenProjectSettings = async (projectId: string) => {
    projectFormState.resetForm();
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        throw new Error("Failed to load project");
      }
      const data = await response.json();
      const project = data.project as ProjectWithRepos;
      setEditingProject(project);
      projectFormState.hydrateFromProject(project);
    } catch (error) {
      console.error("Failed to load project settings", error);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    const project = projectsProp.find((t) => t.id === projectId);
    setConfirmModal({
      title: "Delete project",
      message: `Delete "${project?.name ?? "project"}"? Its agents will move to the Default project.`,
      onConfirm: () => void onDeleteProject?.(projectId),
    });
  };

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRepoGeneratedKnowledge() {
      if (!repoDetail?.repoId) return;
      try {
        const res = await fetch(
          `/api/knowledge-notes?scope=repo&subjectId=${encodeURIComponent(repoDetail.repoId)}`
        );
        const data = res.ok ? await res.json() : { note: null };
        const note = data.note;
        if (!cancelled) {
          setRepoDetail((current) => current && current.repoId === repoDetail.repoId
            ? {
                ...current,
                generatedKnowledge: note?.content
                  ? [{
                      id: note.id,
                      content: note.content,
                      created_at: note.updatedAt ?? note.createdAt,
                    }]
                  : [],
                isLoadingKnowledge: false,
              }
            : current);
        }
      } catch {
        if (!cancelled) {
          setRepoDetail((current) => current && current.repoId === repoDetail.repoId
            ? { ...current, generatedKnowledge: [], isLoadingKnowledge: false }
            : current);
        }
      }
    }

    if (repoDetail?.repoId) {
      void loadRepoGeneratedKnowledge();
    }

    return () => {
      cancelled = true;
    };
  }, [repoDetail?.repoId]);

  const handleAddAgentToProject = (projectId: string) => {
    if (onAddAgentViaForm) {
      onAddAgentViaForm(projectId);
      return;
    }
    setAddAgentSelection(new Set());
    setAddAgentModal({ projectId });
  };

  const addAgentModalProject = addAgentModal ? projectsProp.find((t) => t.id === addAgentModal.projectId) : null;
  const addAgentModalMemberIds = new Set(addAgentModalProject?.agents.map((a) => a.agent_id) ?? []);
  const addAgentModalAvailable = addAgentModal ? participants.filter((p) => !addAgentModalMemberIds.has(p.id)) : [];

  const hasThreads = threads.length > 0;
  const showRestoringState = isRestoringActiveThread && hasThreads;
  const showLoadingState = (isLoading && !hasThreads) || showRestoringState;
  const showEmptyState = !showLoadingState && !hasThreads;
  const isVisible = Boolean(visible);
  const sortedWorkspaces = [...threads].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const nonDefaultProjects = projectsProp.filter((project) => !project.is_default);

  useEffect(() => {
    if (nonDefaultProjects.length === 0) {
      return;
    }

    const objectiveIndex = new Map<
      string,
      { projectId: string; canonicalThreadId: string }
    >();
    const linkedThreadIds = new Set<string>();
    const objectiveThreadsByTitle = new Map<string, Thread[]>();

    for (const project of nonDefaultProjects) {
      for (const threadId of project.thread_ids ?? []) {
        if (typeof threadId === "string" && threadId.trim()) {
          linkedThreadIds.add(threadId);
        }
      }

      const workspace = readProjectObjectivesWorkspace(project.metadata);
      for (const objective of workspace.objectives) {
        const objectiveId = objective.id.trim();
        if (!objectiveId) continue;
        objectiveIndex.set(objectiveId, {
          projectId: project.id,
          canonicalThreadId:
            objective.threadId?.trim() || `objective-chat:${objectiveId}`,
        });
      }
    }

    for (const thread of threads) {
      const metadata =
        thread.metadata && typeof thread.metadata === "object"
          ? (thread.metadata as Record<string, unknown>)
          : null;
      const scope = typeof metadata?.scope === "string" ? metadata.scope : "";
      const isObjectiveThread =
        scope === "objective" || thread.id.startsWith("objective-chat:");
      const normalizedTitle = thread.title?.trim().toLowerCase() ?? "";

      if (!isObjectiveThread || !normalizedTitle) continue;

      const existing = objectiveThreadsByTitle.get(normalizedTitle) ?? [];
      existing.push(thread);
      objectiveThreadsByTitle.set(normalizedTitle, existing);
    }

    for (const [title, groupedThreads] of objectiveThreadsByTitle) {
      objectiveThreadsByTitle.set(
        title,
        [...groupedThreads].sort((left, right) => right.updatedAt - left.updatedAt)
      );
    }

    for (const thread of threads) {
      const metadata =
        thread.metadata && typeof thread.metadata === "object"
          ? (thread.metadata as Record<string, unknown>)
          : null;
      const scope = typeof metadata?.scope === "string" ? metadata.scope : "";
      const objectiveId =
        typeof metadata?.objectiveId === "string" ? metadata.objectiveId.trim() : "";
      const derivedObjectiveId = thread.id.startsWith("objective-chat:")
        ? thread.id.slice("objective-chat:".length).trim()
        : "";
      const resolvedObjectiveId = objectiveId || derivedObjectiveId;
      const isObjectiveThread = scope === "objective" || Boolean(derivedObjectiveId);
      const normalizedTitle = thread.title?.trim().toLowerCase() ?? "";
      const isStaleEmptyThread =
        thread.messages.length === 0 && thread.updatedAt < Date.now() - 5 * 60 * 1000;

      if (!isObjectiveThread) continue;

      const objectiveEntry = resolvedObjectiveId
        ? objectiveIndex.get(resolvedObjectiveId)
        : undefined;

      if (objectiveEntry) {
        if (thread.id !== objectiveEntry.canonicalThreadId && isStaleEmptyThread) {
          const deleteKey = `delete:${thread.id}`;
          if (objectiveThreadMaintenanceRef.current.has(deleteKey)) continue;
          objectiveThreadMaintenanceRef.current.add(deleteKey);
          void Promise.resolve(onDeleteThread(thread.id)).catch((error) => {
            objectiveThreadMaintenanceRef.current.delete(deleteKey);
            console.warn("Failed to delete legacy objective thread", error);
          });
          continue;
        }

        if (!linkedThreadIds.has(thread.id)) {
          const linkKey = `link:${thread.id}`;
          if (objectiveThreadMaintenanceRef.current.has(linkKey)) continue;
          objectiveThreadMaintenanceRef.current.add(linkKey);
          void fetch(`/api/projects/${objectiveEntry.projectId}/threads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId: thread.id }),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
              }
            })
            .catch((error) => {
              objectiveThreadMaintenanceRef.current.delete(linkKey);
              console.warn("Failed to re-link objective thread", error);
            });
        }
        continue;
      }

      if (!isStaleEmptyThread) continue;
      const duplicateTitleGroup = normalizedTitle
        ? objectiveThreadsByTitle.get(normalizedTitle) ?? []
        : [];
      if (duplicateTitleGroup.length < 2 || duplicateTitleGroup[0]?.id === thread.id) {
        continue;
      }

      const deleteKey = `delete:${thread.id}`;
      if (objectiveThreadMaintenanceRef.current.has(deleteKey)) continue;
      objectiveThreadMaintenanceRef.current.add(deleteKey);
      void Promise.resolve(onDeleteThread(thread.id)).catch((error) => {
        objectiveThreadMaintenanceRef.current.delete(deleteKey);
        console.warn("Failed to delete orphan objective thread", error);
      });
    }
  }, [nonDefaultProjects, onDeleteThread, threads]);

  useFocusManagement({
    focusTarget: emptyCtaRef,
    shouldFocus: isVisible && showEmptyState && !isCreating,
  });

  const handleDeleteClick = (workspaceId: string) => {
    const ws = threads.find((t) => t.id === workspaceId);
    setConfirmModal({
      title: "Delete chat",
      message: `Delete "${ws?.title ?? "chat"}"? This cannot be undone.`,
      onConfirm: () => void onDeleteThread(workspaceId),
    });
  };

  const handleRenameClick = (workspaceId: string, currentTitle: string) => {
    setInputModal({
      title: "Rename chat",
      placeholder: "Chat title",
      defaultValue: currentTitle,
      onSubmit: (title) => void onRenameThread(workspaceId, title),
    });
  };

  if (!isVisible) {
    return (
      <aside
        id="workspace-sidebar"
        className="workspace-sidebar workspace-sidebar--collapsed"
        aria-label="Workspace sidebar"
      >
        <div className="workspace-sidebar__brand">
          <button
            type="button"
            onClick={onToggle}
            className="workspace-sidebar__brand-trigger border-none outline-none cursor-pointer"
            aria-label="Show chats"
            title="Show chats"
          >
            <WorkspaceSidebarBrandLogo compact />
          </button>
        </div>
        <div className="mt-auto p-2">
          <a
            href="https://discord.gg/G9afUYKKY3"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white transition-colors"
            style={{ backgroundColor: '#5865F2' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4752C4')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#5865F2')}
            title="Join Discord"
          >
            <svg width="14" height="14" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.8 58.8 0 0017.7 9a.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1 58.6 58.6 0 0017.7-9v-.1c1.4-15.2-2.4-28.4-10-40.1a.2.2 0 00-.1-.1zM23.7 37.3c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.3 0c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z"/>
            </svg>
          </a>
        </div>
      </aside>
    );
  }

  return (
    <aside
      id="workspace-sidebar"
      className="workspace-sidebar"
      aria-label="Workspace sidebar"
      aria-busy={isLoading ? "true" : undefined}
      style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
    >
      <div className="workspace-sidebar__brand">
        <div className="workspace-sidebar__brand-content">
          <WorkspaceSidebarBrandLogo />
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Hide chats"
            title="Hide chats"
            className="workspace-sidebar__brand-toggle ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--app-shell-soft-text)] transition-all hover:bg-[var(--app-shell-subtle)] hover:text-[var(--foreground)]"
          >
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="workspace-sidebar__content">
        {onSearch && (
          <div className="px-3 pt-2 pb-1">
            <button
              type="button"
              onClick={onSearch}
              className="flex h-8 w-full items-center gap-2 rounded-lg border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] px-2.5 text-xs text-[var(--app-shell-soft-text)] transition-all hover:border-[var(--app-shell-border-strong)] hover:text-[var(--app-shell-muted)]"
            >
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span>Search...</span>
              <kbd className="ml-auto rounded border border-[var(--app-shell-border)] bg-[var(--app-shell-subtle)] px-1 py-0.5 font-sans text-[10px] font-medium text-[var(--app-shell-soft-text)]">&#8984;K</kbd>
            </button>
          </div>
        )}

        <nav className="workspace-sidebar__section">
          <div className="workspace-sidebar__section-header group/projects-header">
            <p className="workspace-sidebar__section-label">Projects</p>
            <div className="workspace-sidebar__header-actions">
              <button
                type="button"
                className="workspace-sidebar__action opacity-0 transition-opacity group-hover/projects-header:opacity-100"
                onClick={() => handleCreateProject()}
                aria-label="Create project"
                title="Create project"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          {nonDefaultProjects.map((project) => {
            const projectIsExpanded = expandedProjects.has(project.id);
            const projectThreads = sortedWorkspaces.filter((thread) => project.thread_ids?.includes(thread.id));
            const isActiveProject = project.id === activeProjectId;
            const primaryProjectThreadId =
              project.thread_ids?.find((threadId) => threadById.has(threadId)) ??
              project.thread_ids?.[0] ??
              projectThreads[0]?.id ??
              null;
            const isActiveProjectOverview = isActiveProject && activeProjectView === "overview";
            const isActiveProjectObjectives = isActiveProject && activeProjectView === "objectives";
            const isActiveProjectTeams = isActiveProject && activeProjectView === "teams";
            const isActiveProjectThread = isActiveProject && activeProjectView === "thread" && primaryProjectThreadId === activeThreadId;
            const isActiveProjectAutomations = isActiveProject && activeProjectView === "automations";
            const isActiveProjectLinear = isActiveProject && activeProjectView === "linear";
            const isActiveProjectSettings = isActiveProject && activeProjectView === "settings";

            return (
              <div key={project.id}>
                <div className="workspace-sidebar__workspace-item group">
                  <div className="workspace-sidebar__nav-item workspace-sidebar__workspace-nav-item">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      onClick={() => toggleProjectExpanded(project.id)}
                      aria-label={projectIsExpanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                      title={projectIsExpanded ? "Collapse project" : "Expand project"}
                    >
                      {projectIsExpanded ? (
                        <ChevronDown size={14} className="flex-shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="flex-shrink-0" />
                      )}
                    </button>
                    <Link
                      href={`/projects/${project.slug}`}
                      className="flex items-center gap-1.5 min-w-0 flex-1"
                      onClick={(e) => { e.stopPropagation(); }}
                    >
                      <Folder size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                      <span className="workspace-sidebar__workspace-title">{project.name}</span>
                    </Link>
                  </div>
                  <div className="workspace-sidebar__workspace-actions">
                    <Link
                      href={`/projects/${project.slug}/settings`}
                      className="workspace-sidebar__workspace-action"
                      aria-label={`Settings for ${project.name}`}
                      title="Project settings"
                    >
                      <Settings size={12} />
                    </Link>
                  </div>
                </div>
                {projectIsExpanded && (
                  <div className="ml-4 my-1 flex flex-col gap-0.5 border-l border-[var(--app-shell-border)] pl-3">
                    {/* Overview */}
                    <div className="workspace-sidebar__workspace-item">
                      <Link
                        href={`/projects/${project.slug}`}
                        className={`workspace-sidebar__nav-item ${isActiveProjectOverview ? "workspace-sidebar__nav-item--active" : ""}`}
                        aria-current={isActiveProjectOverview ? "page" : undefined}
                      >
                        <Home size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                        <span className="workspace-sidebar__workspace-title text-xs">Overview</span>
                      </Link>
                    </div>

                    {/* Objectives */}
                    <div className="workspace-sidebar__workspace-item">
                      <Link
                        href={`/projects/${project.slug}/objectives`}
                        className={`workspace-sidebar__nav-item ${isActiveProjectObjectives ? "workspace-sidebar__nav-item--active" : ""}`}
                        aria-current={isActiveProjectObjectives ? "page" : undefined}
                      >
                        <Target size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                        <span className="workspace-sidebar__workspace-title text-xs">Objectives</span>
                      </Link>
                    </div>

                    {/* Linear */}
                    <div className="workspace-sidebar__workspace-item group/linear flex items-center">
                      <Link
                        href={`/projects/${project.slug}/linear`}
                        className={`workspace-sidebar__nav-item flex-1 ${isActiveProjectLinear ? "workspace-sidebar__nav-item--active" : ""}`}
                        aria-current={isActiveProjectLinear ? "page" : undefined}
                      >
                        <ExternalLink size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                        <span className="workspace-sidebar__workspace-title text-xs">Linear</span>
                      </Link>
                      <Link
                        href={`/projects/${project.slug}/linear?settings=true`}
                        className="flex h-5 w-5 items-center justify-center rounded opacity-0 group-hover/linear:opacity-100 hover:bg-[var(--sidebar-hover)] transition-opacity"
                        title="Linear settings"
                      >
                        <Settings size={11} className="text-[var(--muted-foreground)]" />
                      </Link>
                    </div>

                    {/* Automations */}
                    <div className="workspace-sidebar__workspace-item">
                      <Link
                        href={`/projects/${project.slug}/automations`}
                        className={`workspace-sidebar__nav-item ${isActiveProjectAutomations ? "workspace-sidebar__nav-item--active" : ""}`}
                        aria-current={isActiveProjectAutomations ? "page" : undefined}
                      >
                        <Zap size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                        <span className="workspace-sidebar__workspace-title text-xs">Scheduled Tasks</span>
                      </Link>
                    </div>

                    {/* Teams */}
                    <div className="workspace-sidebar__workspace-item">
                      <Link
                        href={`/projects/${project.slug}/teams`}
                        className={`workspace-sidebar__nav-item ${isActiveProjectTeams ? "workspace-sidebar__nav-item--active" : ""}`}
                        aria-current={isActiveProjectTeams ? "page" : undefined}
                      >
                        <Users size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                        <span className="workspace-sidebar__workspace-title text-xs">Teams</span>
                      </Link>
                    </div>

                    {/* Chat */}
                    <div className="workspace-sidebar__workspace-item">
                      {primaryProjectThreadId ? (
                        <button
                          type="button"
                          className={`workspace-sidebar__nav-item ${isActiveProjectThread ? "workspace-sidebar__nav-item--active" : ""}`}
                          onClick={() => onSelectThread(primaryProjectThreadId)}
                          aria-current={isActiveProjectThread ? "page" : undefined}
                        >
                          <MessageSquare size={12} className="flex-shrink-0 text-[var(--muted-foreground)]" />
                          <span className="workspace-sidebar__workspace-title text-xs">Chat</span>
                        </button>
                      ) : null}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </nav>

      </div>

      <div className="mt-auto px-3 pb-3">
        <a
          href="https://discord.gg/G9afUYKKY3"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-white text-sm font-medium transition-colors"
          style={{ backgroundColor: '#5865F2' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4752C4')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#5865F2')}
        >
          <svg width="14" height="14" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.8 58.8 0 0017.7 9a.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1 58.6 58.6 0 0017.7-9v-.1c1.4-15.2-2.4-28.4-10-40.1a.2.2 0 00-.1-.1zM23.7 37.3c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.3 0c-3.5 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z"/>
          </svg>
          Join Discord
        </a>
      </div>

      {/* Agent profiles are now at /agents/[id] */}

      {hasMounted && repoDetail && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            if (!repoDetail.isSaving) setRepoDetail(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  {repoDetail.projectName}
                </p>
                <h3 className="truncate text-base font-semibold text-[var(--foreground)]">
                  {repoDetail.repoId ? (repoDetail.name || "Folder") : "Add Folder"}
                </h3>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--muted-foreground)]"
                onClick={() => {
                  if (!repoDetail.isSaving) setRepoDetail(null);
                }}
                aria-label="Close folder details"
                disabled={repoDetail.isSaving}
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Name</p>
                <input
                  value={repoDetail.name}
                  onChange={(e) => setRepoDetail((current) => current ? { ...current, name: e.target.value, error: null } : current)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-2 text-sm text-[var(--foreground)]"
                  disabled={repoDetail.isSaving}
                  placeholder="e.g. Frontend, API Docs, Design System"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Path</p>
                <div className="flex items-center gap-2">
                  <input
                    value={repoDetail.path}
                    onChange={(e) => setRepoDetail((current) => current ? { ...current, path: e.target.value, error: null } : current)}
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-2 font-mono text-xs text-[var(--foreground)]"
                    disabled={repoDetail.isSaving}
                    placeholder="Local path to folder"
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
                    disabled={repoDetail.isSaving}
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/filesystem/pick-folder", { method: "POST" });
                        const data = await res.json();
                        if (data.path) {
                          setRepoDetail((current) => current ? { ...current, path: data.path, error: null } : current);
                        }
                      } catch {
                        // ignore — user can type manually
                      }
                    }}
                  >
                    Browse
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Notes</p>
                <textarea
                  value={repoDetail.notes}
                  onChange={(e) => setRepoDetail((current) => current ? { ...current, notes: e.target.value, error: null } : current)}
                  className="min-h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-3 text-sm text-[var(--foreground)] whitespace-pre-wrap"
                  disabled={repoDetail.isSaving}
                  placeholder="Coding conventions, deploy steps, doc standards, ownership rules..."
                />
              </div>
              {repoDetail.repoId ? (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Living Note</p>
                  {repoDetail.isLoadingKnowledge ? (
                    <p className="text-sm text-[var(--muted-foreground)]">Loading note…</p>
                  ) : repoDetail.generatedKnowledge.length > 0 ? (
                    <div className="space-y-2">
                      {repoDetail.generatedKnowledge.slice(0, 5).map((item) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-2 text-sm text-[var(--foreground)]">
                          <div>{item.content}</div>
                          {item.created_at ? (
                            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{new Date(item.created_at).toLocaleString()}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--muted-foreground)]">No note yet.</p>
                  )}
                </div>
              ) : null}
              {repoDetail.error ? (
                <p className="text-xs text-red-600">{repoDetail.error}</p>
              ) : null}
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
                  onClick={() => setRepoDetail(null)}
                  disabled={repoDetail.isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--card-bg)] transition-colors hover:bg-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={repoDetail.isSaving || !onUpdateProject}
                  onClick={async () => {
                    const project = projectsProp.find((item) => item.id === repoDetail.projectId);
                    if (!project) {
                      setRepoDetail((current) => current ? { ...current, error: "Project not found." } : current);
                      return;
                    }
                    const trimmedName = repoDetail.name.trim();
                    const trimmedPath = repoDetail.path.trim();
                    if (!trimmedName) {
                      setRepoDetail((current) => current ? { ...current, error: "Folder name is required." } : current);
                      return;
                    }
                    if (!trimmedPath) {
                      setRepoDetail((current) => current ? { ...current, error: "Folder path is required." } : current);
                      return;
                    }

                    setRepoDetail((current) => current ? { ...current, isSaving: true, error: null } : current);
                    try {
                      const nextRepos = repoDetail.repoId
                        ? project.repos.map((repo) =>
                          repo.id === repoDetail.repoId
                            ? {
                              id: repo.id,
                              name: trimmedName,
                              path: trimmedPath,
                              git_url: repoDetail.gitUrl.trim() || undefined,
                              notes: repoDetail.notes.trim() || undefined,
                            }
                            : {
                              id: repo.id,
                              name: repo.name,
                              path: repo.path,
                              git_url: repo.git_url,
                              notes: repo.notes,
                            }
                        )
                        : [
                          ...project.repos.map((repo) => ({
                            id: repo.id,
                            name: repo.name,
                            path: repo.path,
                            git_url: repo.git_url,
                            notes: repo.notes,
                          })),
                          {
                            name: trimmedName,
                            path: trimmedPath,
                            git_url: repoDetail.gitUrl.trim() || undefined,
                            notes: repoDetail.notes.trim() || undefined,
                          },
                        ];
                      await onUpdateProject?.(project.id, {
                        repos: nextRepos,
                      });
                      setRepoDetail(null);
                    } catch (error) {
                      setRepoDetail((current) => current ? {
                        ...current,
                        isSaving: false,
                        error: error instanceof Error ? error.message : "Failed to save folder details.",
                      } : current);
                    }
                  }}
                >
                  {repoDetail.isSaving ? "Saving..." : repoDetail.repoId ? "Save" : "Add Folder"}
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Add Agent to Project modal */}
      {hasMounted && addAgentModal && !creatingNewAgent && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setAddAgentModal(null)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-80 max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                Add to {addAgentModalProject?.name ?? "project"}
              </h3>
              <button
                type="button"
                className="text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)]"
                onClick={() => setAddAgentModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto py-1 flex-1">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] transition-colors border-b border-[var(--border)]"
                onClick={() => setCreatingNewAgent(true)}
              >
                <Plus size={14} className="text-[var(--muted-foreground)]" />
                <span className="text-xs font-medium">Create new agent</span>
              </button>
              {addAgentModalAvailable.length === 0 ? (
                <p className="px-4 py-6 text-xs text-[var(--muted-foreground)] text-center">
                  All agents are already in this project
                </p>
              ) : (
                addAgentModalAvailable.map((p) => {
                  const selected = addAgentSelection.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${selected ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)]"}`}
                      onClick={() => {
                        setAddAgentSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        });
                      }}
                    >
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selected ? "bg-[var(--foreground)] border-[var(--foreground)]" : "border-[var(--border)]"}`}>
                        {selected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </div>
                      <img
                        src={agentAvatarUrl(p.id, 24, p.color)}
                        alt=""
                        className="w-6 h-6 rounded-full flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate font-medium text-xs">{p.name}</div>
                        <div className="truncate text-[11px] text-[var(--muted-foreground)]">{p.model}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {addAgentModalAvailable.length > 0 && (
              <div className="px-4 py-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  onClick={() => setAddAgentModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addAgentSelection.size === 0}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--card-bg)] bg-[var(--foreground)] rounded-lg hover:bg-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  onClick={() => {
                    for (const agentId of addAgentSelection) {
                      void onAddAgentToProject?.(addAgentModal.projectId, agentId);
                    }
                    setAddAgentModal(null);
                  }}
                >
                  Add {addAgentSelection.size > 0 ? `(${addAgentSelection.size})` : ""}
                </button>
              </div>
            )}
          </div>
        </div>
      , document.body)}

      {/* Create New Agent modal (AgentForm) */}
      {hasMounted && creatingNewAgent && createPortal(
        <AgentForm
          title="Create new agent"
          initial={{ name: "", provider: "claude", model: "", identity: "", skills: [], skillBindings: [] }}
          submitLabel="Create & Add"
          projects={projectsProp?.filter((project) => !project.is_default).map((project) => {
            const threadName = (project.thread_ids ?? []).map((threadId) => threads.find((th) => th.id === threadId)?.title?.trim()).filter(Boolean).join(", ") || "No chat";
            return { id: project.id, name: project.name, label: `${threadName} › ${project.name}` };
          })}
          initialProjectIds={addAgentModal ? [addAgentModal.projectId] : []}
          onSubmit={async (data: AgentFormData, projectIds?: string[]) => {
            const colors = ["#D97706", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#DB2777", "#0891B2"];
            const color = colors[participants.length % colors.length];
            const id = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const firstProjectId = projectIds?.[0];
            const res = await fetch("/api/participants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id, name: data.name, provider: data.provider, model: data.model, color: data.color ?? color,
                ...(data.title ? { title: data.title } : {}),
                ...(data.identity ? { identity: data.identity } : {}),
                skills: data.skills ?? [],
                skillBindings: data.skillBindings ?? [],
                ...(firstProjectId ? { projectId: firstProjectId } : {}),
              }),
            });
            if (res.ok) {
              const createdAgent = await res.json().catch(() => ({}));
              const createdAgentId = typeof createdAgent?.id === "string" && createdAgent.id.trim()
                ? createdAgent.id.trim()
                : id;
              // Add to remaining projects
              for (const tid of (projectIds ?? []).slice(1)) {
                void onAddAgentToProject?.(tid, createdAgentId);
              }
              setCreatingNewAgent(false);
              setAddAgentModal(null);
            }
          }}
          onCancel={() => { setCreatingNewAgent(false); }}
        />
      , document.body)}

      {/* Text input modal (create/rename) */}
      {hasMounted && inputModal && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setInputModal(null)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-80 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">{inputModal.title}</h3>
              <button
                type="button"
                className="text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)]"
                onClick={() => setInputModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <form
              className="px-4 py-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const value = (fd.get("value") as string)?.trim();
                if (!value) return;
                inputModal.onSubmit(value);
                setInputModal(null);
              }}
            >
              <input
                ref={inputModalRef}
                name="value"
                type="text"
                defaultValue={inputModal.defaultValue}
                placeholder={inputModal.placeholder}
                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg outline-none focus:border-[var(--border)] focus:ring-1 focus:ring-[var(--border)] transition-all"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  onClick={() => setInputModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium text-[var(--card-bg)] bg-[var(--foreground)] rounded-lg hover:bg-[var(--foreground)] transition-colors"
                >
                  {inputModal.defaultValue ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      , document.body)}

      {/* Confirm modal (delete) */}
      {hasMounted && confirmModal && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-[var(--card-bg)] rounded-xl shadow-xl border border-[var(--border)] w-80 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)]">{confirmModal.title}</h3>
              <button
                type="button"
                className="text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)]"
                onClick={() => setConfirmModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-sm text-[var(--muted-foreground)]">{confirmModal.message}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  onClick={() => setConfirmModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Create Project modal */}
      {hasMounted && (createProjectModal || editingProject) && createPortal(
        <ProjectModal
          isOpen
          onClose={() => {
            projectFormState.resetForm();
            setCreateProjectModal(null);
            setEditingProject(null);
          }}
          onSubmit={() => void handleProjectModalSubmit()}
          editingProject={editingProject}
          form={projectFormState.form}
          repos={projectFormState.repos}
          isSubmitting={projectFormState.isSubmitting}
          formError={projectFormState.formError}
          onFieldChange={(field, value) => projectFormState.setForm((prev) => ({ ...prev, [field]: value }))}
          onRepoChange={projectFormState.handleRepoChange}
          onAddRepo={projectFormState.addRepo}
          onRemoveRepo={projectFormState.removeRepo}
        />
      , document.body)}

      {hasMounted && agentDetailAgent && createPortal((() => {
        const agentProjects = projectsProp.filter((t) => t.agents.some((a) => a.agent_id === agentDetailAgent.id));
        const availableProjects = projectsProp.filter((t) => !t.agents.some((a) => a.agent_id === agentDetailAgent.id));
        return (
          <AgentForm
            title="Edit agent"
            initial={{
              name: agentDetailAgent.name,
              title: agentDetailAgent.title || "",
              provider: agentDetailAgent.provider,
              model: agentDetailAgent.model || "",
              identity: agentDetailAgent.identity || "",
              color: agentDetailAgent.color,
              skills: agentDetailAgent.skills || [],
              skillBindings: agentDetailAgent.skillBindings || [],
            }}
            agentId={agentDetailAgent.id}
            submitLabel="Save"
            projectMemberships={{
              current: agentProjects.map((t) => ({ id: t.id, name: t.name, is_default: !!t.is_default })),
              available: availableProjects.map((t) => ({ id: t.id, name: t.name })),
            }}
            onAddToProject={onAddAgentToProject ? (projectId) => onAddAgentToProject(projectId, agentDetailAgent.id) : undefined}
            onRemoveFromProject={onRemoveAgentFromProject ? (projectId) => onRemoveAgentFromProject(projectId, agentDetailAgent.id) : undefined}
            onSubmit={async (data) => {
              if (onUpdateParticipant) {
                await onUpdateParticipant({
                  ...agentDetailAgent,
                  name: data.name,
                  title: data.title || undefined,
                  provider: data.provider,
                  model: data.model,
                  color: data.color ?? agentDetailAgent.color,
                  ...(data.identity ? { identity: data.identity } : {}),
                  skills: data.skills ?? [],
                  skillBindings: data.skillBindings ?? [],
                });
              }
              setAgentDetailId(null);
            }}
            onCancel={() => setAgentDetailId(null)}
          />
        );
      })(), document.body)}
      {onWidthChange && (
        <div
          className="absolute right-0 top-0 bottom-0 z-20 w-1 cursor-col-resize group"
          onMouseDown={(e) => {
            e.preventDefault();
            resizing.current = true;
            const startX = e.clientX;
            const startWidth = width ?? 368;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            const onMouseMove = (ev: MouseEvent) => {
              const newWidth = Math.max(200, Math.min(600, startWidth + ev.clientX - startX));
              onWidthChange(newWidth);
            };
            const onMouseUp = () => {
              resizing.current = false;
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);
            };
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
          }}
        >
          <div className="absolute inset-y-0 right-0 w-1 transition-colors hover:bg-[var(--primary)]/40 group-hover:bg-[var(--primary)]/40" />
        </div>
      )}
    </aside>
  );
}

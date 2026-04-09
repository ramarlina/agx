"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Layout from "@/components/Layout";
import ProjectCard from "@/components/ProjectCard";
import ProjectModal, { useProjectFormState, createProjectPayload } from "@/components/ProjectModal";
import TaskList from "@/components/TaskList";
import { Task } from "@/components/TaskCard";
import { useTasks } from "@/hooks/useTasks";
import { ProjectWithRepos, useProjects } from "@/hooks/useProjects";

export default function ProjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects, isLoading, error, refetch, createProject, updateProject, deleteProject } = useProjects();
  const modalFormState = useProjectFormState();
  const [editingProject, setEditingProject] = useState<ProjectWithRepos | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [projectForTasks, setProjectForTasks] = useState<ProjectWithRepos | null>(null);

  const {
    form: modalForm,
    repos: modalRepos,
    handleRepoChange: handleModalRepoChange,
    addRepo: addModalRepo,
    removeRepo: removeModalRepo,
    resetForm: resetModalForm,
    hydrateFromProject: hydrateModalForm,
    isSubmitting: modalIsSubmitting,
    setIsSubmitting: setModalIsSubmitting,
    formError: modalModalFormError,
    setFormError: setModalFormError,
    setForm: setModalForm,
  } = modalFormState;

  const openNewProjectModal = () => {
    setEditingProject(null);
    resetModalForm();
    setShowModal(true);
  };

  const openEditProjectModal = (project: ProjectWithRepos) => {
    setEditingProject(project);
    hydrateModalForm(project);
    setShowModal(true);
  };

  useEffect(() => {
    const editProjectId = searchParams.get("edit");
    if (!editProjectId || projects.length === 0 || showModal) return;
    const project = projects.find((item) => item.id === editProjectId);
    if (project) {
      openEditProjectModal(project);
    }
  }, [searchParams, projects, showModal]);

  const handleProjectClick = useCallback((project: ProjectWithRepos) => {
    if (!project.slug) return;
    // Navigate directly to the individual project board.
    router.push(`/projects/${project.slug}`);
  }, [router]);

  const openProjectTasks = useCallback((project: ProjectWithRepos) => {
    setProjectForTasks(project);
  }, []);

  const closeProjectTasks = useCallback(() => {
    setProjectForTasks(null);
  }, []);

  const closeModal = () => {
    resetModalForm();
    setShowModal(false);
    setEditingProject(null);
    if (searchParams.get("edit")) {
      router.replace("/projects");
    }
  };

  const handleSubmit = async () => {
    if (!modalForm.name.trim()) {
      setModalFormError("Project name is required");
      return;
    }

    const invalidRepo = modalRepos.find(r => r.name.trim() && !r.path.trim());
    if (invalidRepo) {
      setModalFormError(`Local path is required for folder "${invalidRepo.name}"`);
      return;
    }

    setModalFormError(null);
    setModalIsSubmitting(true);
    const payload = createProjectPayload(modalForm, modalRepos);

    try {
      if (editingProject) {
        await updateProject(editingProject.id, payload);
      } else {
        await createProject(payload);
      }
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save project";
      setModalFormError(message);
    } finally {
      setModalIsSubmitting(false);
    }
  };

  const handleDelete = async (project: ProjectWithRepos) => {
    const confirmed = window.confirm(`Delete project "${project.name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteProject(project.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto w-full flex flex-col min-h-full">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
            <p className="text-[var(--muted-foreground)] mt-1">
              Manage your projects and their folder contexts.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={refetch}
              className="px-4 py-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--primary)] transition-all text-sm font-medium"
            >
              Refresh
            </button>
            <button
              onClick={openNewProjectModal}
              className="btn-primary px-6 py-2 shadow-lg shadow-[var(--primary)]/20"
            >
              + New Project
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
              <p className="text-sm text-[var(--muted-foreground)] animate-pulse">Loading projects...</p>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 animate-fade-in">
            <div className="w-24 h-24 rounded-3xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center text-4xl mb-6 shadow-xl">
              📂
            </div>
            <h2 className="text-2xl font-bold mb-2">You have no projects</h2>
            <p className="text-[var(--muted-foreground)] text-center max-w-sm mb-8 leading-relaxed">
              Create your first project to start organizing your tasks and connecting your folders.
            </p>
            <button
              onClick={openNewProjectModal}
              className="btn-primary px-8 py-3 text-lg shadow-xl shadow-[var(--primary)]/20"
            >
              Create a Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
            <Link
              href="/projects/orphans"
              className="p-5 rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm space-y-4 transition-all hover:border-[var(--primary)] hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Orphan Tasks</h3>
                  <p className="text-xs text-[var(--muted-foreground)] tracking-wide uppercase">
                    Unassigned
                  </p>
                </div>
              </div>
              <p className="text-sm text-[var(--foreground)]">
                Review tasks with empty project assignment and move them into the correct project.
              </p>
            </Link>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={openEditProjectModal}
                onDelete={handleDelete}
                onManageTasks={openProjectTasks}
                onClick={handleProjectClick}
              />
            ))}
          </div>
        )}

        <ProjectModal
          isOpen={showModal}
          onClose={closeModal}
          onSubmit={handleSubmit}
          editingProject={editingProject}
          form={modalForm}
          repos={modalRepos}
          isSubmitting={modalIsSubmitting}
          formError={modalModalFormError}
          onFieldChange={(field, value) => setModalForm((prev) => ({ ...prev, [field]: value }))}
          onRepoChange={handleModalRepoChange}
          onAddRepo={addModalRepo}
          onRemoveRepo={removeModalRepo}
        />
        {projectForTasks && (
          <ProjectTasksModal project={projectForTasks} onClose={closeProjectTasks} />
        )}
      </div>
    </Layout>
  );
}

interface ProjectTasksModalProps {
  project: ProjectWithRepos;
  onClose: () => void;
}

function ProjectTasksModal({ project, onClose }: ProjectTasksModalProps) {
  const { tasks, isLoading } = useTasks({ project: project.slug });

  return (
    <div className="modal-backdrop p-2 sm:p-4 z-50 overflow-y-auto flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content w-full max-w-5xl mx-2 sm:mx-auto bg-[var(--card-bg)] rounded-3xl border border-[var(--card-border)] shadow-2xl animate-scale-in flex flex-col max-h-[90vh]">
        <div className="px-4 py-4 sm:px-8 sm:py-6 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">
              Tasks for {project.name}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Viewing all tasks associated with this project.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--muted)]/50 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full mb-4" />
              <p className="text-sm text-[var(--muted-foreground)]">Loading project tasks...</p>
            </div>
          ) : (
            <TaskList tasks={tasks} />
          )}
        </div>

        <div className="px-8 py-6 border-t border-[var(--card-border)] flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/50 transition-colors text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState, useCallback } from "react";
import { Search } from "lucide-react";
import Layout from "@/components/Layout";
import KanbanBoard from "@/components/KanbanBoard";
import NowRunningPanel from "@/components/NowRunningPanel";
import { Task } from "@/components/TaskCard";
import { useTasks } from "@/hooks/useTasks";
import { useWorkflows } from "@/hooks/useWorkflows";

export default function OrphanTasksPage() {
  const {
    tasks,
    isLoading: tasksLoading,
    updateTask,
    deleteTask,
    completeTaskStage,
    cancelWorkflow,
    refetch,
    cancellingTaskId,
  } = useTasks({ realtime: true, orphan: true });
  const { workflow, stages, stageConfig, isValidTransition, isLoading: workflowLoading } = useWorkflows();

  const [searchQuery, setSearchQuery] = useState("");

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter((task) =>
      (task.title || "").toLowerCase().includes(query) ||
      (task.content || "").toLowerCase().includes(query)
    );
  }, [tasks, searchQuery]);

  const handleSelectTask = useCallback(
    async (task: Task) => {
      // No-op since TaskDetail is removed
    },
    []
  );

  if (tasksLoading || workflowLoading) {
    return (
      <Layout>
        <div className="h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
            <p className="text-sm text-[var(--muted-foreground)]">Loading orphan tasks...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="h-full flex flex-col p-4">
        <div className="flex-shrink-0 mb-4 space-y-3">
          <div>
            <h1 className="text-xl font-bold">Orphan Tasks</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Tasks without a project assignment. Open a task to attach it to a project.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search orphan tasks"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-all"
            />
          </div>

          <NowRunningPanel
            tasks={filteredTasks}
            onTaskClick={() => {}}
            onStop={async (taskId) => {
              await cancelWorkflow({ taskId });
              await refetch();
            }}
            onRetry={async (taskId) => {
              await completeTaskStage({
                taskId,
                decision: "not_done",
                final_result: "Manual retry requested.",
                explanation: "Manual retry requested.",
              });
            }}
            cancellingTaskId={cancellingTaskId}
            panelId="now-running:orphans"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <KanbanBoard
            tasks={filteredTasks}
            onSelectTask={handleSelectTask}
            onTasksChange={() => {}}
            onTaskUpdate={async (taskId, updates) => { await updateTask(taskId, updates); }}
            stages={stages}
            stageConfig={stageConfig}
            isValidTransition={isValidTransition}
          />
        </div>
      </div>
    </Layout>
  );
}

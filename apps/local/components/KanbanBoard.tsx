"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Task } from "./TaskCard";
import SortableTaskCard from "./SortableTaskCard";
import TaskCardOverlay from "./TaskCardOverlay";
import {
  FALLBACK_STAGES,
  FALLBACK_STAGE_CONFIG,
  type StageConfig
} from "@/hooks/useWorkflows";
import { useInputCapabilities } from "@/hooks/useInputCapabilities";

// Re-export for backward compatibility
export const STAGES = FALLBACK_STAGES;
export type Stage = string;

interface KanbanBoardProps {
  tasks: Task[];
  onTasksChange?: (tasks: Task[]) => void;
  onSelectTask?: (task: Task) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onAddTask?: (title: string, stage: string) => void;
  // New props for dynamic stages
  stages?: readonly string[] | string[];
  stageConfig?: Record<string, StageConfig>;
  isValidTransition?: (fromStage: string, toStage: string) => boolean;
  isCreatingTask?: boolean;
  creatingStage?: string | null;
  /** When provided, tasks are grouped by this function instead of task.stage */
  graphColumnFn?: (task: Task) => string;
}

export default function KanbanBoard({
  tasks,
  onTasksChange,
  onSelectTask,
  onTaskUpdate,
  onAddTask,
  stages: propStages,
  stageConfig: propStageConfig,
  isValidTransition: propIsValidTransition,
  isCreatingTask,
  creatingStage,
  graphColumnFn,
}: KanbanBoardProps) {
  const { isTouchLayout } = useInputCapabilities();
  // Use props or fallbacks
  const stages = propStages || FALLBACK_STAGES;
  const stageConfigMap = propStageConfig || FALLBACK_STAGE_CONFIG;

  // Default transition validator
  const defaultIsValidTransition = (fromStage: string, toStage: string): boolean => {
    if (fromStage === toStage) return true;
    const fromIndex = stages.indexOf(fromStage);
    const toIndex = stages.indexOf(toStage);
    // Allow backward or forward by one
    return toIndex < fromIndex || toIndex === fromIndex + 1;
  };

  const checkTransition = propIsValidTransition || defaultIsValidTransition;

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [localTasks, setLocalTasks] = useState(tasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Array<{ id: string, from: { x: number, y: number }, to: { x: number, y: number }, type: 'blocking' | 'dependent' }>>([]);

  const boardRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const calculateConnections = useCallback(() => {
    if (!selectedTaskId || !boardRef.current) {
      setConnections([]);
      return;
    }

    const newConnections: typeof connections = [];
    const boardRect = boardRef.current.getBoundingClientRect();
    const selectedEl = document.getElementById(`task-${selectedTaskId}`);
    if (!selectedEl) return;

    const selectedRect = selectedEl.getBoundingClientRect();

    localTasks.forEach(task => {
      // Blocking tasks (The ones the selected task depends on)
      if (localTasks.find(t => t.id === selectedTaskId)?.depends_on?.includes(task.id)) {
        const fromEl = document.getElementById(`task-${task.id}`);
        if (fromEl) {
          const fromRect = fromEl.getBoundingClientRect();
          newConnections.push({
            id: `conn-blocking-${task.id}`,
            from: { x: fromRect.right - boardRect.left, y: fromRect.top + fromRect.height / 2 - boardRect.top },
            to: { x: selectedRect.left - boardRect.left, y: selectedRect.top + selectedRect.height / 2 - boardRect.top },
            type: 'blocking'
          });
        }
      }

      // Dependent tasks (The ones that depend on the selected task)
      if (task.depends_on?.includes(selectedTaskId)) {
        const toEl = document.getElementById(`task-${task.id}`);
        if (toEl) {
          const toRect = toEl.getBoundingClientRect();
          newConnections.push({
            id: `conn-dependent-${task.id}`,
            from: { x: selectedRect.right - boardRect.left, y: selectedRect.top + selectedRect.height / 2 - boardRect.top },
            to: { x: toRect.left - boardRect.left, y: toRect.top + toRect.height / 2 - boardRect.top },
            type: 'dependent'
          });
        }
      }
    });

    setConnections(newConnections);
  }, [selectedTaskId, localTasks]);

  useEffect(() => {
    calculateConnections();
    window.addEventListener('resize', calculateConnections);
    return () => window.removeEventListener('resize', calculateConnections);
  }, [calculateConnections]);

  useEffect(() => {
    // Sync with parent tasks when not actively dragging
    // Only run this when tasks prop changes, not when activeTask changes
    if (!activeTask) {
      setLocalTasks(tasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Map any stage string to a board column.
  const LEGACY_TO_COLUMN: Record<string, string> = {
    ideation: "INTAKE", intake: "INTAKE",
    planning: "PROGRESS", coding: "PROGRESS", execution: "PROGRESS",
    qa: "PROGRESS", acceptance: "PROGRESS", verification: "PROGRESS",
    pr: "PROGRESS", smoke_test: "PROGRESS", release: "PROGRESS",
    done: "DONE",
  };

  const getColumn = (task: Task): string => {
    const stage = typeof task.stage === "string" ? task.stage : "";
    const status = typeof task.status === "string" ? task.status.trim().toLowerCase() : "";

    // Direct match (INTAKE, PROGRESS, DONE)
    if (stage && stages.includes(stage)) {
      return stage;
    }

    // Status-based mapping
    if (status === "completed") return "DONE";
    if (status === "in_progress" || status === "blocked" || status === "failed") return "PROGRESS";

    // Legacy stage mapping
    const mapped = LEGACY_TO_COLUMN[stage.trim().toLowerCase()];
    if (mapped) return mapped;

    if (graphColumnFn) {
      return graphColumnFn(task);
    }

    return "INTAKE";
  };
  // Compute dependency depth for indentation (how many levels deep in the dep chain)
  const depthMap = useMemo(() => {
    const depths: Record<string, number> = {};
    const taskById = new Map(localTasks.map((t) => [t.id, t]));

    function getDepth(id: string, visited: Set<string>): number {
      if (depths[id] !== undefined) return depths[id];
      if (visited.has(id)) return 0; // cycle guard
      visited.add(id);
      const task = taskById.get(id);
      if (!task?.depends_on?.length) {
        depths[id] = 0;
        return 0;
      }
      const maxParent = Math.max(
        ...task.depends_on.map((pid) => (taskById.has(pid) ? getDepth(pid, visited) + 1 : 0))
      );
      depths[id] = maxParent;
      return maxParent;
    }

    for (const t of localTasks) getDepth(t.id, new Set());
    return depths;
  }, [localTasks]);

  const grouped = useMemo(() => {
    const result: Record<string, Task[]> = {};
    const taskById = new Map(localTasks.map((t) => [t.id, t]));

    for (const stage of stages) {
      const columnTasks = localTasks.filter((t) => getColumn(t) === stage);

      // Topological sort: dependencies appear before dependents
      const sorted: Task[] = [];
      const placed = new Set<string>();

      function place(task: Task) {
        if (placed.has(task.id)) return;
        // Place dependencies first (if they're in the same column)
        for (const depId of task.depends_on || []) {
          const dep = taskById.get(depId);
          if (dep && getColumn(dep) === stage && !placed.has(depId)) {
            place(dep);
          }
        }
        placed.add(task.id);
        sorted.push(task);
      }

      // Start with roots (no deps in this column), sorted by priority
      const roots = columnTasks
        .filter((t) => !t.depends_on?.some((d) => taskById.has(d) && getColumn(taskById.get(d)!) === stage))
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));

      for (const root of roots) place(root);
      // Place any remaining (cycles, orphans)
      for (const t of columnTasks.sort((a, b) => (a.priority || 0) - (b.priority || 0))) place(t);

      result[stage] = sorted;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTasks, stages, graphColumnFn]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    })
  );

  function handleDragStart(event: DragStartEvent) {
    const task = localTasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  }

  function resolveTargetColumn(overId: string): string | null {
    if (stages.includes(overId)) {
      return overId;
    }
    const overTask = localTasks.find((t) => t.id === overId);
    if (!overTask) {
      return null;
    }
    return getColumn(overTask);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the task being dragged
    const activeTask = localTasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    const activeColumn = getColumn(activeTask);
    const targetStage = resolveTargetColumn(overId);
    if (!targetStage) return;

    // Only update if visible column changed
    if (activeColumn !== targetStage) {
      // Validate transition
      if (!checkTransition(activeColumn || '', targetStage)) {
        return; // Invalid transition, don't update
      }

      setLocalTasks((prev) =>
        prev.map((t) =>
          t.id === activeId
            ? {
              ...t,
              stage: targetStage as Task["stage"],
            }
            : t
        )
      );
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) {
      // Reset to original
      setLocalTasks(tasks);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = localTasks.find((t) => t.id === activeId);
    if (!activeTask) return;
    const originalTask = tasks.find((t) => t.id === activeId);

    // Determine final column and position
    let targetStage: Stage = getColumn(activeTask) as Stage;
    let newPriority = activeTask.priority || 0;

    if (stages.includes(overId)) {
      // Dropped on a column
      targetStage = overId as Stage;
      // Put at end of column
      const columnTasks = grouped[targetStage];
      newPriority = columnTasks.length > 0
        ? Math.max(...columnTasks.map(t => t.priority || 0)) + 1
        : 0;
    } else {
      // Dropped on another task
      const overTask = localTasks.find((t) => t.id === overId);
      if (overTask) {
        targetStage = getColumn(overTask) as Stage;

        // Reorder within column
        const columnTasks = localTasks.filter((t) => getColumn(t) === targetStage);
        const oldIndex = columnTasks.findIndex((t) => t.id === activeId);
        const newIndex = columnTasks.findIndex((t) => t.id === overId);

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(columnTasks, oldIndex, newIndex);
          // Update priorities
          const updatedTasks = localTasks.map((t) => {
            const idx = reordered.findIndex((r) => r.id === t.id);
            if (idx !== -1) {
              return { ...t, priority: idx };
            }
            return t;
          });
          setLocalTasks(updatedTasks);
          onTasksChange?.(updatedTasks);
        }

        newPriority = overTask.priority || 0;
      }
    }

    // Validate transition before API call
    const originalStage = originalTask ? getColumn(originalTask) : activeTask.stage || "";
    if (originalTask && !checkTransition(originalStage || '', targetStage)) {
      // Reset to original
      setLocalTasks(tasks);
      return;
    }

    // Optimistic update already done, now sync with API
    if (
      onTaskUpdate &&
      (
        originalStage !== targetStage ||
        (originalTask?.priority ?? activeTask.priority) !== newPriority
      )
    ) {
      try {
        await onTaskUpdate(activeId, {
          stage: targetStage as Task['stage'],
          priority: newPriority,
        });
        onTasksChange?.(localTasks);
      } catch (error) {
        console.error("Failed to update task:", error);
        // Revert on error
        setLocalTasks(tasks);
      }
    }
  }

  const handleStageMove = useCallback(async (task: Task, targetStage: string) => {
    const originalStage = getColumn(task);
    if (!checkTransition(originalStage || "", targetStage)) {
      return;
    }

    const targetTasks = localTasks.filter((entry) => entry.id !== task.id && getColumn(entry) === targetStage);
    const nextPriority =
      targetTasks.length > 0
        ? Math.max(...targetTasks.map((entry) => entry.priority || 0)) + 1
        : 0;

    const nextTasks = localTasks.map((entry) =>
      entry.id === task.id
        ? {
            ...entry,
            stage: targetStage as Task["stage"],
            priority: nextPriority,
          }
        : entry
    );

    setLocalTasks(nextTasks);
    onTasksChange?.(nextTasks);

    if (!onTaskUpdate) {
      return;
    }

    try {
      await onTaskUpdate(task.id, {
        stage: targetStage as Task["stage"],
        priority: nextPriority,
      });
    } catch (error) {
      console.error("Failed to update task:", error);
      setLocalTasks(tasks);
    }
  }, [checkTransition, localTasks, onTaskUpdate, onTasksChange, tasks]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        className="h-full overflow-hidden relative bg-[var(--background)]"
        ref={scrollContainerRef}
        onScroll={calculateConnections}
        onClick={() => setSelectedTaskId(null)}
      >
        <div className="relative min-w-full h-full flex flex-col" ref={boardRef}>
          {/* SVG Connections Overlay - hidden on mobile */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 hidden xl:block" style={{ overflow: 'visible' }}>
            <style>
              {`
                @keyframes flow {
                  from { stroke-dashoffset: 20; }
                  to { stroke-dashoffset: 0; }
                }
                .conn-path {
                  animation: flow 1s linear infinite;
                }
              `}
            </style>
            {connections.map(conn => {
              const dx = conn.to.x - conn.from.x;
              const controlX1 = conn.from.x + Math.abs(dx) * 0.3 * (dx > 0 ? 1 : -1);
              const controlX2 = conn.to.x - Math.abs(dx) * 0.3 * (dx > 0 ? 1 : -1);

              return (
                <path
                  key={conn.id}
                  d={`M ${conn.from.x} ${conn.from.y} C ${controlX1} ${conn.from.y}, ${controlX2} ${conn.to.y}, ${conn.to.x} ${conn.to.y}`}
                  stroke={conn.type === 'blocking' ? 'var(--status-blocked, #f43f5e)' : 'var(--status-in-progress, #3b82f6)'}
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  fill="none"
                  strokeOpacity="0.4"
                  className="conn-path"
                />
              );
            })}
          </svg>

          {/* Columns */}
          <div className="flex flex-col xl:flex-row gap-4 xl:gap-6 pb-4 px-3 xl:px-6 flex-1 min-h-0 items-stretch justify-center pt-2">
            {stages.map((stage, index) => (
              <StageColumn
                key={stage}
                stage={stage}
                tasks={grouped[stage] || []}
                allTasks={localTasks}
                stages={stages}
                isTouchLayout={isTouchLayout}
                selectedTaskId={selectedTaskId}
                setSelectedTaskId={setSelectedTaskId}
                onSelectTask={onSelectTask}
                onTaskUpdate={onTaskUpdate}
                onStageMove={handleStageMove}
                index={index}
                onAddTask={onAddTask}
                config={stageConfigMap[stage] || { icon: '📌', label: stage, color: 'var(--primary)' }}
                isCreating={Boolean(isCreatingTask && creatingStage === stage)}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={{
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
      }}>
        {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface StageColumnProps {
  stage: string;
  tasks: Task[];
  allTasks: Task[];
  stages: readonly string[];
  isTouchLayout: boolean;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  onSelectTask?: (task: Task) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onStageMove?: (task: Task, targetStage: string) => void | Promise<void>;
  index: number;
  onAddTask?: (title: string, stage: string) => void;
  config: StageConfig;
  isCreating?: boolean;
}

function StageColumn({
  stage,
  tasks,
  allTasks,
  stages,
  isTouchLayout,
  selectedTaskId,
  setSelectedTaskId,
  onSelectTask,
  onTaskUpdate,
  onStageMove,
  index,
  onAddTask,
  config,
  isCreating = false,
}: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      id={stage}
      data-testid={stage}
      className={`
        w-full xl:flex-shrink-0 xl:w-80 flex flex-col min-h-0
        bg-[var(--muted)]/40 rounded-2xl border border-[var(--border)]/50 shadow-inner overflow-hidden
        transition-all duration-200
        ${isOver ? 'ring-2 ring-[var(--primary)] ring-opacity-30 bg-[var(--primary-muted)]/10' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Glassmorphic Column Header */}
      <div className="p-4 flex items-center justify-between bg-[var(--card-bg)]/30 backdrop-blur-sm border-b border-[var(--border)]/20">
        <div className="flex items-center gap-3">
          <span className="text-lg">{config.icon}</span>
          <h3 className="font-bold text-[11px] uppercase tracking-widest text-[var(--muted-foreground)]">
            {config.label}
          </h3>
        </div>
        <span className="text-[10px] font-bold text-[var(--muted-foreground)] bg-[var(--card-bg)] px-2 py-0.5 rounded-full border border-[var(--border)]">
          {tasks.length}
        </span>
      </div>

      {/* Column content - droppable area */}
      <FlatColumnContent
        stage={stage}
        tasks={tasks}
        allTasks={allTasks}
        stages={stages}
        isTouchLayout={isTouchLayout}
        selectedTaskId={selectedTaskId}
        setSelectedTaskId={setSelectedTaskId}
        onSelectTask={onSelectTask}
        onTaskUpdate={onTaskUpdate}
        onStageMove={onStageMove}
        config={config}
        onAddTask={onAddTask}
        isCreating={isCreating}
      />
    </div>
  );
}

interface FlatColumnContentProps {
  stage: string;
  tasks: Task[];
  allTasks: Task[];
  stages: readonly string[];
  isTouchLayout: boolean;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  onSelectTask?: (task: Task) => void;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onStageMove?: (task: Task, targetStage: string) => void | Promise<void>;
  config: StageConfig;
  onAddTask?: (title: string, stage: string) => void;
  isCreating?: boolean;
}

function FlatColumnContent({
  stage,
  tasks,
  allTasks,
  stages,
  isTouchLayout,
  selectedTaskId,
  setSelectedTaskId,
  onSelectTask,
  onTaskUpdate,
  onStageMove,
  config,
  onAddTask,
  isCreating,
}: FlatColumnContentProps) {
  const allIds = useMemo(() => tasks.map(t => t.id), [tasks]);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const getRelationship = (task: Task): 'active' | 'blocking' | 'dependent' | 'dimmed' | 'none' => {
    if (!selectedTaskId) return 'none';
    if (task.id === selectedTaskId) return 'active';
    const selectedTask = allTasks.find(t => t.id === selectedTaskId);
    if (selectedTask?.depends_on?.includes(task.id)) return 'blocking';
    if (task.depends_on?.includes(selectedTaskId)) return 'dependent';
    return 'dimmed';
  };

  const handleAddClick = () => {
    setIsAdding(true);
    setNewTitle('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    const title = newTitle.trim();
    if (title && onAddTask) {
      onAddTask(title, stage);
    }
    setIsAdding(false);
    setNewTitle('');
  };

  const handleCancel = () => {
    setIsAdding(false);
    setNewTitle('');
  };

  return (
    <SortableContext
      items={allIds}
      strategy={verticalListSortingStrategy}
    >
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-2">
        {/* Add Task - at the top */}
        {onAddTask && !isAdding && (
          <button
            onClick={(e) => { e.stopPropagation(); handleAddClick(); }}
            disabled={isCreating}
            className="w-full py-2.5 rounded-xl border border-dashed border-[var(--border)] text-[var(--muted-foreground)] text-[10px] font-bold uppercase tracking-widest hover:bg-[var(--card-bg)] hover:border-indigo-200 hover:text-indigo-400 transition-all flex items-center justify-center gap-2 mb-1"
          >
            {isCreating ? (
              <span className="spinner w-3 h-3 border-2 border-[var(--border)] border-t-indigo-400 rounded-full" />
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Task
              </>
            )}
          </button>
        )}

        {/* Inline editable placeholder */}
        {isAdding && (
          <div className="bg-[var(--card-bg)] border-2 border-indigo-400 rounded-xl p-3 shadow-lg shadow-indigo-50 mb-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
              onBlur={() => {
                if (!newTitle.trim()) handleCancel();
                else handleSave();
              }}
              placeholder="Task title..."
              className="w-full text-sm font-medium text-[var(--foreground)] bg-transparent outline-none placeholder:text-[var(--muted-foreground)]"
            />
            <p className="text-[10px] text-[var(--muted-foreground)] mt-1">Press Enter to create · Esc to cancel</p>
          </div>
        )}

        {/* Task cards */}
        {tasks.map(task => {
          const rel = getRelationship(task);
          return (
            <div
              key={task.id}
              id={`task-${task.id}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
                onSelectTask?.(task);
              }}
            >
              <SortableTaskCard
                task={task}
                onClick={() => onSelectTask?.(task)}
                onStatusChange={onTaskUpdate ? (s) => onTaskUpdate(task.id, { status: s }) : undefined}
                onApprovalModeChange={onTaskUpdate ? (m) => onTaskUpdate(task.id, { approval_mode: m }) : undefined}
                onStageChange={
                  isTouchLayout && onStageMove
                    ? (nextStage) => {
                        if (nextStage) {
                          void onStageMove(task, nextStage);
                        }
                      }
                    : undefined
                }
                stageOptions={isTouchLayout ? stages : undefined}
                currentStage={stage}
                dragDisabled={isTouchLayout}
                allTasks={allTasks}
                relationship={rel}
              />
            </div>
          );
        })}

        {tasks.length === 0 && !isAdding && (
          <div className="flex flex-col items-center justify-center py-12 opacity-10">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-1">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <p className="text-[10px] font-bold uppercase tracking-widest">Available</p>
          </div>
        )}
      </div>
    </SortableContext>
  );
}

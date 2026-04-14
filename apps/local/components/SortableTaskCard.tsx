"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import TaskCard, { Task, TaskStage, TaskStatus } from "./TaskCard";

interface SortableTaskCardProps {
  task: Task;
  onClick?: () => void;
  onStatusChange?: (status: TaskStatus) => void;
  onApprovalModeChange?: (mode: "auto" | "manual") => void;
  onStageChange?: (stage: Task["stage"]) => void;
  stageOptions?: readonly TaskStage[];
  currentStage?: TaskStage;
  dragDisabled?: boolean;
  allTasks?: Task[];
  relationship?: 'active' | 'blocking' | 'dependent' | 'dimmed' | 'none';
}

export default function SortableTaskCard({
  task,
  onClick,
  onStatusChange,
  onApprovalModeChange,
  onStageChange,
  stageOptions,
  currentStage,
  dragDisabled = false,
  allTasks,
  relationship = 'none',
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(isDragging ? { zIndex: 50, position: 'relative' as const } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={`touch-none ${relationship !== 'none' && relationship !== 'dimmed' ? 'z-20 relative' : ''}`}
    >
      <TaskCard
        task={task}
        onClick={onClick}
        onStatusChange={onStatusChange}
        onApprovalModeChange={onApprovalModeChange}
        onStageChange={onStageChange}
        stageOptions={stageOptions}
        currentStage={currentStage}
        allTasks={allTasks}
        relationship={relationship}
      />
    </div>
  );
}

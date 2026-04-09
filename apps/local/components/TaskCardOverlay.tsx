"use client";

import TaskCard, { Task } from "./TaskCard";

interface TaskCardOverlayProps {
  task: Task;
}

export default function TaskCardOverlay({ task }: TaskCardOverlayProps) {
  return (
    <div
      className="w-full sm:w-80 cursor-grabbing
        shadow-lg border border-[var(--primary)]
        rotate-1 scale-[1.02] rounded-lg bg-[var(--card-bg)]"
    >
      <TaskCard task={task} />
    </div>
  );
}

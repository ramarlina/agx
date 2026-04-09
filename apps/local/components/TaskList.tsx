"use client";

import TaskCard, { Task, TaskStatus } from "./TaskCard";

interface TaskListProps {
  tasks: Task[];
  onSelectTask?: (task: Task) => void;
  onStatusChange?: (taskId: string, status: TaskStatus) => void;
}

const sectionConfig = {
  in_progress: { 
    title: "In Progress", 
    icon: "🔄", 
    color: "var(--status-in-progress)",
    description: "Currently being worked on by the daemon"
  },
  blocked: { 
    title: "Blocked", 
    icon: "🚧", 
    color: "var(--status-blocked)",
    description: "Waiting for input or resolution"
  },
  queued: { 
    title: "Queued", 
    icon: "📋", 
    color: "var(--status-queued)",
    description: "Ready to be picked up"
  },
  completed: { 
    title: "Completed", 
    icon: "✅", 
    color: "var(--status-completed)",
    description: "Successfully finished"
  },
};

export default function TaskList({ tasks, onSelectTask, onStatusChange }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] mb-4">
          <span className="text-3xl">📋</span>
        </div>
        <h3 className="text-lg font-semibold mb-2">No tasks yet</h3>
        <p className="text-[var(--muted-foreground)] text-sm max-w-md mx-auto">
          Create your first task to get started. Tasks will appear here organized by status.
        </p>
      </div>
    );
  }

  // Group by status
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const queued = tasks.filter((t) => t.status === "queued");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const completed = tasks.filter((t) => t.status === "completed" || t.status === "failed");

  const renderSection = (status: keyof typeof sectionConfig, items: Task[]) => {
    if (items.length === 0) return null;
    const config = sectionConfig[status];
    
    return (
      <section className="mb-8 animate-fade-in-up">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-4">
          <div 
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: `color-mix(in srgb, ${config.color} 10%, transparent)` }}
          >
            <span className="text-lg">{config.icon}</span>
            <h3 className="text-sm font-semibold" style={{ color: config.color }}>
              {config.title}
            </h3>
            <span 
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ 
                backgroundColor: `color-mix(in srgb, ${config.color} 15%, transparent)`,
                color: config.color
              }}
            >
              {items.length}
            </span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)] hidden sm:block">
            {config.description}
          </p>
        </div>
        
        {/* Task grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((task, index) => (
            <div 
              key={task.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <TaskCard
                task={task}
                onClick={() => onSelectTask?.(task)}
                onStatusChange={onStatusChange ? (s) => onStatusChange(task.id, s) : undefined}
              />
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div>
      {renderSection("in_progress", inProgress)}
      {renderSection("blocked", blocked)}
      {renderSection("queued", queued)}
      {renderSection("completed", completed)}
    </div>
  );
}

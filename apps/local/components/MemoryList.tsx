"use client";

import { useCallback, useEffect, useState } from "react";

export type MemoryType = "outcome" | "decision" | "pattern" | "gotcha";

export interface Memory {
  id: string;
  agent_id: string;
  task_id: string;
  memory_type: MemoryType;
  content: string;
  content_hash: string;
  created_at: number;
}

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  outcome: "Outcome",
  decision: "Decision",
  pattern: "Pattern",
  gotcha: "Gotcha",
};

const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  outcome: "memory-badge--outcome",
  decision: "memory-badge--decision",
  pattern: "memory-badge--pattern",
  gotcha: "memory-badge--gotcha",
};

const MEMORY_TYPE_ORDER: MemoryType[] = ["outcome", "decision", "pattern", "gotcha"];

interface MemoryListProps {
  taskId: string;
}

export default function MemoryList({ taskId }: MemoryListProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/memories?task_id=${encodeURIComponent(taskId)}`, {
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || `Failed to fetch memories (${res.status})`);
      }
      setMemories((payload.memories ?? []) as Memory[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch memories");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void fetchMemories();
  }, [fetchMemories]);

  if (loading) {
    return <div className="memory-list memory-list--loading">Loading memories…</div>;
  }

  if (error) {
    return <div className="memory-list memory-list--error">{error}</div>;
  }

  if (memories.length === 0) {
    return (
      <div className="memory-list memory-list--empty">
        No agent memories recorded for this task yet.
      </div>
    );
  }

  // Group by memory_type in canonical order
  const grouped = MEMORY_TYPE_ORDER.reduce<Record<MemoryType, Memory[]>>(
    (acc, type) => {
      acc[type] = memories.filter((m) => m.memory_type === type);
      return acc;
    },
    { outcome: [], decision: [], pattern: [], gotcha: [] }
  );

  return (
    <div className="memory-list">
      {MEMORY_TYPE_ORDER.filter((type) => grouped[type].length > 0).map((type) => (
        <div key={type} className="memory-group">
          <div className="memory-group__header">
            <span className={`memory-badge ${MEMORY_TYPE_COLORS[type]}`}>
              {MEMORY_TYPE_LABELS[type]}
            </span>
            <span className="memory-group__count">{grouped[type].length}</span>
          </div>
          <ul className="memory-group__list">
            {grouped[type].map((memory) => (
              <li key={memory.id} className="memory-item">
                <p className="memory-item__content">{memory.content}</p>
                <time className="memory-item__time">
                  {new Date(memory.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

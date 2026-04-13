"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, TerminalSquare } from "lucide-react";
import { useLinearConnection } from "@/hooks/useLinearConnection";
import { LinearIcon } from "@/components/linear/LinearIcon";
import { ToolPathCard } from "./ToolPathCard";

interface ThreadEntry {
  id: string;
  threadId: string;
  title: string;
  status: string;
}

interface WorkspaceGroup {
  name: string;
  threads: ThreadEntry[];
}

interface ToolPathsSectionProps {
  projectId: string;
  projectSlug: string;
  primaryThreadId: string | null;
}

export function ToolPathsSection({ projectId, projectSlug, primaryThreadId }: ToolPathsSectionProps) {
  const router = useRouter();
  const { connected, loading: linearLoading } = useLinearConnection();
  const [threads, setThreads] = useState<ThreadEntry[] | null>(null);
  const [threadCount, setThreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threads?projectId=${encodeURIComponent(projectId)}&limit=3&format=json`)
      .then((r) => (r.ok ? r.json() : { threads: {}, total: 0 }))
      .then((data) => {
        if (cancelled) return;
        const groups = Object.values((data.threads ?? {}) as Record<string, WorkspaceGroup>);
        const flat = groups
          .flatMap((g) => g.threads ?? [])
          .slice(0, 3);
        setThreads(flat);
        setThreadCount(typeof data.total === "number" ? data.total : flat.length);
      })
      .catch(() => {
        if (!cancelled) { setThreads([]); setThreadCount(0); }
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const navigateToChat = () => {
    if (primaryThreadId) {
      router.push(`/projects/${projectSlug}/thread/${encodeURIComponent(primaryThreadId)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Chat */}
      <ToolPathCard
        icon={<MessageSquare className="w-4 h-4" />}
        title="Chat"
        accentClass="text-indigo-400"
        onClick={navigateToChat}
        badge={
          threadCount > 0 ? (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {threadCount}
            </span>
          ) : undefined
        }
      >
        {threads === null ? (
          <div className="space-y-1.5">
            {[1, 2].map((i) => <div key={i} className="h-5 rounded bg-zinc-800 animate-pulse" />)}
          </div>
        ) : threads.length === 0 ? (
          <p className="text-zinc-500">No threads yet</p>
        ) : (
          <div className="space-y-1">
            {threads.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-zinc-400 truncate">
                <MessageSquare className="w-3 h-3 text-zinc-600 shrink-0" />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </ToolPathCard>

      {/* Terminal */}
      <ToolPathCard
        icon={<TerminalSquare className="w-4 h-4" />}
        title="Terminal"
        accentClass="text-emerald-400"
        onClick={() => router.push(`/projects/${projectSlug}/terminal`)}
      >
        <p className="text-zinc-500">No sessions yet</p>
      </ToolPathCard>

      {/* Linear */}
      <ToolPathCard
        icon={<LinearIcon className="w-4 h-4" />}
        title="Linear"
        accentClass="text-blue-400"
        onClick={() => router.push(`/projects/${projectSlug}/linear`)}
        badge={
          !linearLoading ? (
            connected ? (
              <span className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
                Connected
              </span>
            ) : (
              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                Connect
              </span>
            )
          ) : undefined
        }
      >
        {!linearLoading && !connected && (
          <p className="text-zinc-500">Connect to see issues</p>
        )}
      </ToolPathCard>
    </div>
  );
}

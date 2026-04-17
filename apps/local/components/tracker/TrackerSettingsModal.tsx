"use client";

import { useState, type ComponentProps } from "react";
import { Bot, Link2, ScrollText, X } from "lucide-react";
import LinearSetup from "@/components/tracking/TrackerSetup";
import TrackerWorkerConfig from "@/components/tracker/TrackerWorkerConfig";
import TrackerWorkerRunLog from "@/components/tracker/TrackerWorkerRunLog";

type TrackerSetupProps = ComponentProps<typeof LinearSetup>;

interface TrackerSettingsModalProps {
  trackerType: string;
  connected: TrackerSetupProps["connected"];
  user: { name: string; email: string } | null;
  clis: { claude: boolean; codex: boolean; gemini: boolean };
  mcpConfigured: Record<string, boolean>;
  onConnect: TrackerSetupProps["onConnect"];
  onConnectWithKey: TrackerSetupProps["onConnectWithKey"];
  onDisconnect: () => Promise<void>;
  onConfigureMcp: (cli: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  projectId?: string;
}

type SettingsTab = "connection" | "worker" | "run-log";

export default function TrackerSettingsModal({
  trackerType,
  connected,
  user,
  clis,
  mcpConfigured,
  onConnect,
  onConnectWithKey,
  onDisconnect,
  onConfigureMcp,
  onClose,
  projectId,
}: TrackerSettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(connected ? "worker" : "connection");
  const [workerJobId, setWorkerJobId] = useState<string | null>(null);

  const workerLabel = trackerType === "jira" ? "Jira Worker" : "Linear Worker";

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { id: "connection", label: "Connection", icon: <Link2 size={14} /> },
    { id: "worker", label: workerLabel, icon: <Bot size={14} />, disabled: !connected },
    { id: "run-log", label: "Run Log", icon: <ScrollText size={14} />, disabled: !connected },
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
      <div className="relative flex w-full max-w-6xl flex-col rounded-lg border border-[var(--card-border)] bg-[var(--background)] shadow-xl">
        {/* Header with tabs */}
        <div className="flex items-center justify-between border-b border-[var(--card-border)] px-6">
          <div className="flex items-center gap-6">
            {tabs.map((t) => {
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => !t.disabled && setTab(t.id)}
                  disabled={t.disabled}
                  className={`relative flex items-center gap-2 py-4 text-sm font-semibold transition-colors ${
                    isActive
                      ? "text-[var(--foreground)]"
                      : t.disabled
                        ? "cursor-not-allowed text-[var(--muted-foreground)]/40"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[var(--foreground)]" />
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 max-h-[80vh] overflow-y-auto p-6">
          {tab === "connection" && (
            <LinearSetup
              trackerType={trackerType}
              projectId={projectId ?? ""}
              connected={connected}
              onConnect={onConnect}
              onConnectWithKey={onConnectWithKey}
              onDisconnect={onDisconnect}
              clis={clis}
              mcpConfigured={mcpConfigured}
              onConfigureMcp={onConfigureMcp}
            />
          )}
          {tab === "worker" && connected && (
            <TrackerWorkerConfig projectId={projectId} onJobLoaded={setWorkerJobId} />
          )}
          {tab === "run-log" && connected && (
            <TrackerWorkerRunLog jobId={workerJobId} />
          )}
        </div>
      </div>
    </div>
  );
}

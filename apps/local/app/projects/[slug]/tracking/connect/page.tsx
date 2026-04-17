"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LogOut } from "lucide-react";
import TrackerSetup from "@/components/tracking/TrackerSetup";
import { TrackerIcon } from "@/components/tracking/TrackerIcon";
import { useProjects } from "@/hooks/useProjects";
import { useTrackerConnection } from "@/hooks/useTrackerConnection";
import { useTrackerConnections } from "@/hooks/useTrackerConnections";

const TRACKER_TYPES = [
  { type: "linear", label: "Linear" },
  { type: "jira", label: "Jira Cloud" },
] as const;

function PickerSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-8 p-8 -mt-7 animate-pulse">
      <div className="space-y-3 text-center flex flex-col items-center">
        <div className="h-7 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-80 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center gap-4 p-8 rounded-xl border border-border">
            <div className="h-16 w-16 rounded-xl bg-muted" />
            <div className="flex flex-col items-center gap-2">
              <div className="h-4 w-20 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupSkeleton() {
  return (
    <div className="flex flex-col items-center gap-6 p-8 animate-pulse">
      <div className="h-16 w-16 rounded-xl bg-muted" />
      <div className="flex flex-col items-center gap-2 w-full max-w-sm">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="h-3 w-72 rounded bg-muted" />
        <div className="h-3 w-56 rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs pt-2">
        <div className="h-10 w-full rounded-lg bg-muted" />
        <div className="h-8 w-full rounded-lg bg-muted/60" />
      </div>
    </div>
  );
}

export default function TrackingConnectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects } = useProjects();
  const project = projects.find((p) => p.slug === slug);
  const projectId = project?.id ?? "";

  const { connections, loading: connectionsLoading, removeConnection } = useTrackerConnections(projectId);
  const connectedTypes = new Set(connections.filter((c) => c.connected).map((c) => c.type));

  const [selected, setSelected] = useState<string | null>(null);

  const {
    connected: singleConnected,
    loading: singleLoading,
    connect,
    connectWithKey,
    disconnect,
    clis,
    mcpConfigured,
    configureMcp,
  } = useTrackerConnection(selected ?? "linear", projectId);

  return (
    <div className="flex flex-col h-full bg-background">
      <main className="flex-1 overflow-auto">
        {selected ? (
          <div className="flex flex-col items-center px-6 py-12">
            <div className="w-full max-w-2xl">
              <button
                onClick={() => setSelected(null)}
                className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
              >
                <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
                Back to tracker picker
              </button>

              <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 pt-8 pb-1 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    Connect {TRACKER_TYPES.find((t) => t.type === selected)?.label ?? selected}
                  </h2>
                </div>
                {singleLoading ? (
                  <SetupSkeleton />
                ) : (
                  <TrackerSetup
                    projectId={projectId}
                    trackerType={selected}
                    connected={singleConnected}
                    loading={false}
                    onConnect={connect}
                    onConnectWithKey={connectWithKey}
                    onDisconnect={() => { disconnect(); setSelected(null); }}
                    clis={clis}
                    mcpConfigured={mcpConfigured}
                    onConfigureMcp={configureMcp}
                  />
                )}
              </div>
            </div>
          </div>
        ) : connectionsLoading ? (
          <PickerSkeleton />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] gap-8 p-8 -mt-7">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold tracking-tight">Connect Issue Tracker</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Choose an issue tracker to connect to this project to enable issue tracking and agent workflows.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
              {TRACKER_TYPES.map((tracker) => {
                const isAlreadyConnected = connectedTypes.has(tracker.type);
                return (
                  <div
                    key={tracker.type}
                    className={
                      "relative flex flex-col items-center gap-4 p-8 rounded-xl border transition-all duration-200 group " +
                      (isAlreadyConnected
                        ? "border-green-500/20 bg-green-500/5"
                        : "border-border hover:border-primary/50 hover:bg-accent/50 hover:shadow-md cursor-pointer active:scale-[0.98]")
                    }
                    onClick={() => !isAlreadyConnected && setSelected(tracker.type)}
                  >
                    <div className="relative">
                      <TrackerIcon trackerType={tracker.type} className="h-16 w-16 transition-transform group-hover:scale-105" />
                      {isAlreadyConnected && (
                        <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-green-500 border-2 border-background flex items-center justify-center text-white shadow-sm">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-base font-semibold">{tracker.label}</span>
                      {isAlreadyConnected ? (
                        <span className="text-xs font-medium text-green-600">Connected</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Click to connect</span>
                      )}
                    </div>
                    {isAlreadyConnected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeConnection(tracker.type); }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Disconnect
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

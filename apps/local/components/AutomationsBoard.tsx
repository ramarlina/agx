"use client";

import React, { useState } from "react";
import {
  Play,
  Trash2,
  X,
  Check,
  Clock,
  Calendar as CalIcon,
  Plus,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useAutomations, type AutomationItem } from "@/hooks/useAutomations";
import type { GraphSchedule } from "@/src/graph/types";
import { cronToHuman } from "@/src/graph/nl-schedule";

const CRON_LABELS = ["min", "hour", "day", "mon", "wkday"];

function formatCadence(schedule: GraphSchedule): string {
  if (schedule.cronExpr) {
    const human = cronToHuman(schedule.cronExpr);
    if (human) return human;
  }
  if (schedule.cadence) return schedule.cadence;
  const ms = schedule.intervalMs;
  if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)}h`;
  return `Every ${Math.round(ms / 86_400_000)}d`;
}

function isScheduleOverdue(schedule: GraphSchedule): boolean {
  if (schedule.state !== "active" || schedule.tickInProgress) return false;
  // Case 1: next tick is in the past and hasn't run yet
  if (schedule.nextTickAt) {
    if (schedule.nextTickAt - Date.now() >= 0) return false;
    if (schedule.lastTickAt && schedule.lastTickAt >= schedule.nextTickAt) {
      // Task ran, but check if it ran late vs previous scheduled time
      if (schedule.prevScheduledAt && schedule.lastTickAt > schedule.prevScheduledAt + 5 * 60_000) {
        return true;
      }
      return false;
    }
    return true;
  }
  // Case 2: interval-based — check if overdue
  if (schedule.lastTickAt) return schedule.lastTickAt + schedule.intervalMs - Date.now() < 0;
  return false;
}

function formatNextRun(schedule: GraphSchedule): string {
  if (schedule.state === "paused") return "Paused";
  if (schedule.state === "stopped") return "Stopped";
  if (schedule.nextTickAt) {
    const diff = schedule.nextTickAt - Date.now();
    if (diff < 0) return "Overdue";
    if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
    if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
    if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
    return `in ${Math.round(diff / 86_400_000)}d`;
  }
  if (schedule.lastTickAt) {
    const nextDue = schedule.lastTickAt + schedule.intervalMs;
    const diff = nextDue - Date.now();
    if (diff < 0) return "Overdue";
    if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
    if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
    return `in ${Math.round(diff / 3_600_000)}h`;
  }
  return "Pending";
}

function Toggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[var(--muted-foreground)] ${
        on ? "bg-green-600" : "bg-[var(--muted)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-4 h-4 bg-[var(--card-bg)] rounded-full transition-transform duration-200 shadow-sm ${
          on ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function AutomationsBoard() {
  const {
    automations,
    loading,
    refresh,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    runNow,
  } = useAutomations();

  const [tab, setTab] = useState<"rules" | "timeline">("rules");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const activeRules = automations.filter(
    (a) => a.schedule.state === "active"
  ).length;
  const filteredRules = automations.filter(
    (a) => filter === "all" || a.schedule.state === filter
  );
  const selected = automations.find((a) => a.taskId === selectedId);

  const handleToggle = async (item: AutomationItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const action =
      item.schedule.state === "active" ? pauseSchedule : resumeSchedule;
    const ok = await action(item.taskId);
    if (ok) {
      showToast(
        `${item.schedule.name || item.taskId} ${
          item.schedule.state === "active" ? "paused" : "resumed"
        }`
      );
    }
  };

  const handleRun = async (taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (busy[taskId]) return;
    setBusy((prev) => ({ ...prev, [taskId]: true }));
    showToast("Running...");
    const result = await runNow(taskId);
    setBusy((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
    if (result.ok) {
      showToast("Run triggered successfully");
    } else if (result.skipReason === 'max_concurrency_reached') {
      showToast("Maximum concurrent runs reached");
    }
  };

  const handleDelete = async (taskId: string) => {
    const ok = await deleteSchedule(taskId);
    if (ok) {
      if (selectedId === taskId) setSelectedId(null);
      showToast("Schedule deleted");
    }
  };

  const totalRuns = automations.reduce(
    (a, item) => a + item.schedule.runCount,
    0
  );
  const failingCount = automations.filter(
    (a) => (a.schedule.consecutiveFailures ?? 0) > 0
  ).length;

  return (
    <div className="h-full flex flex-col text-[var(--foreground)] selection:bg-[var(--primary-muted)]">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 text-sm font-medium">
            <Check size={16} className="text-green-600" />
            {toast}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 md:px-10 pt-6 pb-0">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">
              Automations
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {activeRules} active rule{activeRules !== 1 ? "s" : ""} &middot;{" "}
              {totalRuns.toLocaleString()} lifetime runs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              className="p-2 rounded-lg border border-[var(--card-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--card-hover-border)] transition-colors"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => showToast("Create new schedule via API or chat")}
              className="bg-[var(--foreground)] text-[var(--background)] px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Plus size={16} /> New rule
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--card-border)] flex gap-6">
          {(["rules", "timeline"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setSelectedId(null);
              }}
              className={`pb-3 text-sm capitalize transition-colors relative ${
                tab === t
                  ? "text-[var(--foreground)] font-semibold"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium"
              }`}
            >
              {t}
              {tab === t && (
                <span className="absolute bottom-0 left-0 w-full h-[2px] bg-[var(--foreground)] rounded-t-sm" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 px-6 md:px-10 py-6 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
          {/* Left Column */}
          <div className="min-w-0">
            {loading && automations.length === 0 ? (
              <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
                Loading automations...
              </div>
            ) : tab === "rules" ? (
              <div>
                {/* Filter Pills */}
                <div className="flex gap-4 mb-5">
                  {["all", "active", "paused", "stopped"].map((f) => {
                    const count =
                      f === "all"
                        ? automations.length
                        : automations.filter((a) => a.schedule.state === f)
                            .length;
                    return (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`text-xs font-medium pb-1 transition-colors border-b-2 ${
                          filter === f
                            ? "border-[var(--foreground)] text-[var(--foreground)]"
                            : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <span className="capitalize">{f}</span>
                        <span className="ml-1.5 text-[10px] text-[var(--muted-foreground)] font-mono">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Rule Cards */}
                <div className="flex flex-col gap-3">
                  {filteredRules.map((item) => {
                    const isSelected = selectedId === item.taskId;
                    const hasFails =
                      (item.schedule.consecutiveFailures ?? 0) > 0;
                    const overdue = isScheduleOverdue(item.schedule);
                    const isRunning = busy[item.taskId] || (item.schedule.currentConcurrency ?? 0) >= (item.schedule.maxConcurrency ?? 5);

                    return (
                      <div
                        key={item.taskId}
                        onClick={() => setSelectedId(item.taskId)}
                        className={`p-5 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? "border-[var(--foreground)] shadow-sm"
                            : hasFails
                            ? "border-red-200 bg-red-50/30 hover:border-red-300"
                            : overdue
                            ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                            : "border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--card-hover-border)]"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5 mb-1">
                              <h3 className="text-base font-semibold truncate">
                                {item.schedule.name ||
                                  item.schedule.rootMessageId ||
                                  item.taskId}
                              </h3>
                              {hasFails && (
                                <span className="shrink-0 text-[11px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-md border border-red-100 flex items-center gap-1">
                                  <AlertTriangle size={10} />
                                  {item.schedule.consecutiveFailures} fail
                                  {(item.schedule.consecutiveFailures ?? 0) > 1
                                    ? "s"
                                    : ""}
                                </span>
                              )}
                              {item.schedule.state === "paused" && (
                                <span className="shrink-0 text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                                  paused
                                </span>
                              )}
                              {overdue && (
                                <span className="shrink-0 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 flex items-center gap-1">
                                  <Clock size={10} />
                                  overdue
                                </span>
                              )}
                            </div>
                            {item.schedule.description && (
                              <p className="text-[13px] text-[var(--muted-foreground)] leading-relaxed truncate">
                                {item.schedule.description}
                              </p>
                            )}
                          </div>
                          {/* Actions */}
                          <div
                            className="flex items-center gap-3 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => handleRun(item.taskId, e)}
                              disabled={isRunning}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                isRunning
                                  ? "border-[var(--card-border)] text-[var(--muted-foreground)] bg-[var(--muted)] cursor-wait"
                                  : "border-[var(--card-border)] text-[var(--muted-foreground)] bg-[var(--card-bg)] hover:bg-[var(--muted)] hover:border-[var(--card-hover-border)]"
                              }`}
                            >
                              <Play
                                size={12}
                                className={
                                  isRunning ? "animate-pulse" : "fill-current"
                                }
                              />
                              {isRunning ? "Running" : "Run"}
                            </button>
                            <Toggle
                              on={item.schedule.state === "active"}
                              onToggle={() => handleToggle(item)}
                            />
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-[var(--card-border)]/50 flex items-center gap-5 text-[11px] text-[var(--muted-foreground)]">
                          <span className="flex items-center gap-1.5">
                            <Clock size={12} />{" "}
                            {formatCadence(item.schedule)}
                          </span>
                          <span className={`flex items-center gap-1.5 ${overdue ? "text-amber-400 font-medium" : ""}`}>
                            <CalIcon size={12} />{" "}
                            {formatNextRun(item.schedule)}
                          </span>
                          <span className="ml-auto font-mono text-[var(--muted-foreground)]">
                            {item.schedule.runCount.toLocaleString()} runs
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {filteredRules.length === 0 && (
                    <div className="text-center py-12 text-[var(--muted-foreground)] text-sm border border-dashed border-[var(--card-border)] rounded-xl">
                      {automations.length === 0
                        ? "No automations yet. Create one via the API or chat."
                        : "No matching rules found."}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Timeline tab - placeholder for now */
              <div className="text-center py-12 text-[var(--muted-foreground)] text-sm border border-dashed border-[var(--card-border)] rounded-xl">
                Timeline view coming soon. Scheduled ticks will appear here
                chronologically.
              </div>
            )}
          </div>

          {/* Right Column - Inspector */}
          <div className="lg:sticky lg:top-0">
            {selected ? (
              <ScheduleInspector
                item={selected}
                onRun={(e) => handleRun(selected.taskId, e)}
                onToggle={() => handleToggle(selected)}
                onDelete={() => handleDelete(selected.taskId)}
                onClose={() => setSelectedId(null)}
                isRunning={busy[selected.taskId] || selected.schedule.tickInProgress || selected.executionState === 'running'}
              />
            ) : (
              <div className="space-y-4">
                {/* System Health Panel */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-5 shadow-sm">
                  <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-4">
                    System Health
                  </label>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-4xl font-bold leading-none">
                      {automations.length > 0
                        ? Math.round(
                            ((automations.length - failingCount) /
                              automations.length) *
                              100
                          )
                        : 100}
                      <span className="text-xl text-[var(--muted-foreground)]">
                        %
                      </span>
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-md mb-1 ${
                        failingCount === 0
                          ? "text-green-600 bg-green-50"
                          : "text-red-600 bg-red-50"
                      }`}
                    >
                      {failingCount === 0 ? "Healthy" : `${failingCount} failing`}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--muted)] rounded-full overflow-hidden mb-6">
                    <div
                      className="h-full bg-[var(--foreground)] rounded-full transition-all"
                      style={{
                        width: `${
                          automations.length > 0
                            ? Math.round(
                                ((automations.length - failingCount) /
                                  automations.length) *
                                  100
                              )
                            : 100
                        }%`,
                      }}
                    />
                  </div>

                  <div className="space-y-3">
                    {[
                      { l: "Active schedules", v: String(activeRules) },
                      {
                        l: "Currently failing",
                        v: String(failingCount),
                      },
                      {
                        l: "Total lifetime runs",
                        v: totalRuns.toLocaleString(),
                      },
                    ].map((stat, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center text-[13px]"
                      >
                        <span className="text-[var(--muted-foreground)]">
                          {stat.l}
                        </span>
                        <span className="font-mono font-medium">
                          {stat.v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Help Panel */}
                <div className="bg-[var(--muted)]/50 border border-[var(--card-border)] rounded-2xl p-5">
                  <p className="text-[13px] text-[var(--muted-foreground)] leading-relaxed mb-4">
                    Select a rule from the list to inspect its schedule, stats,
                    and policies.
                  </p>
                  {tab !== "timeline" && (
                    <button
                      onClick={() => setTab("timeline")}
                      className="text-[12px] font-medium flex items-center gap-1.5 hover:text-[var(--muted-foreground)] transition-colors"
                    >
                      View upcoming timeline <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleInspector({
  item,
  onRun,
  onToggle,
  onDelete,
  onClose,
  isRunning,
}: {
  item: AutomationItem;
  onRun: (e?: React.MouseEvent) => void;
  onToggle: () => void;
  onDelete: () => void;
  onClose: () => void;
  isRunning: boolean;
}) {
  const schedule = item.schedule;
  const cronParts = schedule.cronExpr?.split(" ");

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-tight mb-1 truncate">
            {schedule.name || schedule.rootMessageId || item.taskId}
          </h3>
          <span className="font-mono text-[11px] text-[var(--muted-foreground)] block truncate">
            {item.taskId}
          </span>
        </div>
        <div className="flex gap-1 -mt-1 -mr-1 shrink-0">
          <button
            onClick={onDelete}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] rounded-md transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Cron Visualizer */}
      {cronParts && cronParts.length === 5 && (
        <div className="mb-6">
          <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
            Schedule
          </label>
          <div className="bg-[var(--muted)] border border-[var(--card-border)] rounded-xl p-3.5">
            <div className="flex justify-between gap-2 mb-3">
              {cronParts.map((part, i) => (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div className="font-mono text-sm font-semibold text-[var(--primary)] bg-[var(--primary-muted)] w-full py-1 rounded text-center mb-1.5">
                    {part}
                  </div>
                  <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-wider">
                    {CRON_LABELS[i]}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] pt-3 border-t border-[var(--card-border)]/60">
              <Clock size={12} /> {formatCadence(schedule)}
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="mb-6">
        <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
          Performance
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-[var(--muted)] border border-[var(--card-border)] rounded-xl p-3 flex flex-col items-center justify-center">
            <div className="font-mono text-lg font-semibold mb-0.5">
              {schedule.runCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)]">
              total runs
            </div>
          </div>
          <div className={`rounded-xl p-3 flex flex-col items-center justify-center border ${
            isScheduleOverdue(schedule)
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-[var(--muted)] border-[var(--card-border)]"
          }`}>
            <div className={`font-mono text-lg font-semibold mb-0.5 ${isScheduleOverdue(schedule) ? "text-amber-400" : ""}`}>
              {formatNextRun(schedule)}
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)]">
              next run
            </div>
          </div>
        </div>
      </div>

      {/* Config */}
      <div className="mb-6">
        <label className="block text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-2">
          Configuration
        </label>
        <div className="space-y-2.5">
          {[
            { l: "State", v: schedule.state },
            { l: "Cadence", v: formatCadence(schedule) },
            {
              l: "Max runs",
              v: schedule.maxRuns?.toString() ?? "Unlimited",
            },
            {
              l: "Fail limit",
              v: schedule.maxConsecutiveFailures?.toString() ?? "None",
            },
            {
              l: "Reset nodes",
              v: String(schedule.resetNodeIds.length),
            },
          ].map((p, i) => (
            <div
              key={i}
              className="flex justify-between items-center text-[13px] border-b border-[var(--card-border)]/50 pb-2 last:border-0 last:pb-0"
            >
              <span className="text-[var(--muted-foreground)]">{p.l}</span>
              <span className="font-mono font-medium">{p.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--card-border)]">
        <button
          onClick={onRun}
          disabled={isRunning}
          className="flex-1 bg-[var(--foreground)] text-[var(--background)] py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Play
            size={14}
            className={isRunning ? "animate-pulse" : "fill-current"}
          />
          {isRunning ? "Running..." : "Run now"}
        </button>
        <div className="px-2">
          <Toggle
            on={schedule.state === "active"}
            onToggle={onToggle}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState, useCallback, useEffect, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { useProjects } from "@/hooks/useProjects";
import { DEFAULT_WORKFLOW_ID, useWorkflows } from "@/hooks/useWorkflows";
import KanbanBoard from "@/components/KanbanBoard";
import { Task } from "@/components/TaskCard";
import NowRunningPanel from "@/components/NowRunningPanel";
import { getCachedGraphSummary, prefetchGraphSummaries } from "@/hooks/useTaskGraphSummary";
import DaemonBar from "@/components/DaemonBar";
import { useProcessPolling } from "@/hooks/useProcessPolling";
import type { Participant } from "@/lib/types";

const EMPTY_DEPARTMENT_KEY = "__no_department__";
const EMPTY_ASSIGNEE_KEY = "__unassigned__";

interface FilterOption {
    value: string;
    label: string;
    count: number;
}

interface TaskFilterMeta {
    departments: string[];
    assignees: string[];
}

function fallbackV2Column(task: Task): "INTAKE" | "PROGRESS" | "DONE" {
    if (task.stage === "done" || task.status === "completed") {
        return "DONE";
    }
    if (task.stage === "INTAKE" || task.stage === "ideation" || task.status === "queued") {
        return "INTAKE";
    }
    return "PROGRESS";
}

function parseTaskFrontmatter(markdown: string): Record<string, string> {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return {};

    const frontmatter: Record<string, string> = {};
    for (const rawLine of match[1].split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const colonIndex = line.indexOf(":");
        if (colonIndex <= 0) continue;

        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (!key || !value) continue;
        frontmatter[key] = value;
    }

    return frontmatter;
}

function splitFrontmatterValue(value: string | undefined): string[] {
    if (!value) return [];

    const normalized = value.trim();
    if (!normalized) return [];

    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        return normalized
            .slice(1, -1)
            .split(",")
            .map((part) => part.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
    }

    return normalized
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}

function titleCaseLabel(value: string): string {
    return value
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTaskFilterMeta(task: Task, participantMap: Map<string, Participant>): TaskFilterMeta {
    const frontmatter = parseTaskFrontmatter(task.content || "");

    const departments = [
        ...splitFrontmatterValue(frontmatter.department),
        ...splitFrontmatterValue(frontmatter.team),
        ...splitFrontmatterValue(frontmatter.area),
    ];

    const assigneeTokens = [
        ...splitFrontmatterValue(frontmatter.assignee),
        ...splitFrontmatterValue(frontmatter.assigned_agent),
        ...splitFrontmatterValue(frontmatter.assignedAgent),
        ...splitFrontmatterValue(frontmatter.agent),
        ...splitFrontmatterValue(frontmatter.agent_id),
        ...splitFrontmatterValue(frontmatter.owner),
    ];

    const uniqueDepartments = Array.from(new Set(departments.map((value) => value.trim()).filter(Boolean)));
    const uniqueAssignees = Array.from(
        new Set(
            assigneeTokens
                .map((value) => {
                    const trimmed = value.trim();
                    if (!trimmed) return "";
                    const participant = participantMap.get(trimmed);
                    return participant?.name?.trim() || trimmed;
                })
                .filter(Boolean)
        )
    );

    return {
        departments: uniqueDepartments.length > 0 ? uniqueDepartments : [EMPTY_DEPARTMENT_KEY],
        assignees: uniqueAssignees.length > 0 ? uniqueAssignees : [EMPTY_ASSIGNEE_KEY],
    };
}

function buildFilterOptions(
    tasks: Task[],
    getValues: (task: Task) => string[],
    emptyKey: string,
    emptyLabel: string
): FilterOption[] {
    const counts = new Map<string, number>();

    for (const task of tasks) {
        const values = getValues(task);
        for (const value of values.length > 0 ? values : [emptyKey]) {
            counts.set(value, (counts.get(value) || 0) + 1);
        }
    }

    return Array.from(counts.entries())
        .map(([value, count]) => ({
            value,
            label: value === emptyKey ? emptyLabel : titleCaseLabel(value),
            count,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export default function ProjectBoardPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = use(params);
    const router = useRouter();

    const {
        tasks,
        isLoading: tasksLoading,
        createTask,
        updateTask,
        completeTaskStage,
        cancelWorkflow,
        refetch,
        cancellingTaskId,
    } = useTasks({ realtime: true, project: slug });

    const { projects } = useProjects();
    const { stages, stageConfig, isValidTransition, isLoading: workflowLoading } = useWorkflows();

    const [participants, setParticipants] = useState<Participant[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
    const currentProject = projects.find((project) => project.slug === slug);

    useEffect(() => {
        let cancelled = false;

        void fetch("/api/participants")
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) {
                    setParticipants(Array.isArray(data) ? data : []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setParticipants([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const participantMap = useMemo(
        () => new Map(participants.map((participant) => [participant.id, participant])),
        [participants]
    );

    const taskFilterMeta = useMemo(() => {
        const entries = new Map<string, TaskFilterMeta>();
        for (const task of tasks) {
            entries.set(task.id, getTaskFilterMeta(task, participantMap));
        }
        return entries;
    }, [tasks, participantMap]);

    const departmentOptions = useMemo(
        () =>
            buildFilterOptions(
                tasks,
                (task) => taskFilterMeta.get(task.id)?.departments || [EMPTY_DEPARTMENT_KEY],
                EMPTY_DEPARTMENT_KEY,
                "No department"
            ),
        [tasks, taskFilterMeta]
    );

    const assigneeOptions = useMemo(
        () =>
            buildFilterOptions(
                tasks,
                (task) => taskFilterMeta.get(task.id)?.assignees || [EMPTY_ASSIGNEE_KEY],
                EMPTY_ASSIGNEE_KEY,
                "Unassigned"
            ),
        [tasks, taskFilterMeta]
    );

    const { processes: activeProcesses } = useProcessPolling(
        currentProject ? { workspaceId: currentProject.id } : null,
        { intervalMs: 3000 }
    );

    const filteredTasks = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const departmentSet = new Set(selectedDepartments);
        const assigneeSet = new Set(selectedAssignees);

        return tasks.filter((task) => {
            const meta = taskFilterMeta.get(task.id) || {
                departments: [EMPTY_DEPARTMENT_KEY],
                assignees: [EMPTY_ASSIGNEE_KEY],
            };

            const matchesDepartment =
                departmentSet.size === 0 || meta.departments.some((value) => departmentSet.has(value));
            const matchesAssignee =
                assigneeSet.size === 0 || meta.assignees.some((value) => assigneeSet.has(value));
            const matchesSearch =
                !query ||
                (task.title || "").toLowerCase().includes(query) ||
                (task.content || "").toLowerCase().includes(query);

            return matchesDepartment && matchesAssignee && matchesSearch;
        });
    }, [tasks, searchQuery, selectedDepartments, selectedAssignees, taskFilterMeta]);

    const projectHasV2Graphs = useMemo(() => tasks.some((task) => Boolean((task as { graph_id?: string }).graph_id)), [tasks]);

    const v2TaskIds = useMemo(
        () => tasks.filter((task) => (task as { graph_id?: string }).graph_id).map((task) => task.id),
        [tasks],
    );

    useEffect(() => {
        if (v2TaskIds.length === 0) {
            return;
        }

        void prefetchGraphSummaries(v2TaskIds);
    }, [v2TaskIds]);

    const graphColumnFn = useCallback((task: Task): string => {
        const summary = getCachedGraphSummary(task.id);
        if (!summary) return fallbackV2Column(task);
        return summary.derivedStatus;
    }, []);

    const handleSelectTask = useCallback(
        (task: Task) => {
            router.push(`/projects/${slug}/graph/${task.id}`);
        },
        [router, slug]
    );

    const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
        await updateTask(taskId, updates);
    }, [updateTask]);

    const handleQuickAddTask = async (title: string, stage: string) => {
        const frontmatter = [
            `status: ${stage === "INTAKE" ? "queued" : "in_progress"}`,
            `stage: ${stage}`,
        ];

        if (currentProject) {
            frontmatter.push(`project: ${currentProject.slug}`);
            frontmatter.push(`project_id: ${currentProject.id}`);
            frontmatter.push(`workflow_id: ${currentProject.workflow_id || DEFAULT_WORKFLOW_ID}`);
        }

        const content = `---\n${frontmatter.join("\n")}\n---\n\n# ${title}\n`;
        await createTask(content, null);
    };

    if (tasksLoading || workflowLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <span className="spinner w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full" />
                    <p className="text-sm text-[var(--muted-foreground)]">Loading board...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col animate-slide-in-right">
            <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--card-bg)] backdrop-blur-md px-3 sm:px-6 py-3 flex flex-col gap-3">
                <div className="flex items-center gap-3 text-sm text-[var(--app-shell-soft-text)]">
                    <span className="font-semibold text-[var(--foreground)] truncate">{currentProject?.name || slug}</span>
                </div>

                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--app-shell-soft-text)]">
                            Filter by
                        </span>
                        <BoardFilterMultiSelect
                            label="Department"
                            options={departmentOptions}
                            selectedValues={selectedDepartments}
                            onChange={setSelectedDepartments}
                        />
                        <BoardFilterMultiSelect
                            label="Assignee"
                            options={assigneeOptions}
                            selectedValues={selectedAssignees}
                            onChange={setSelectedAssignees}
                        />
                    </div>

                    <div className="relative w-full lg:max-w-sm group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-shell-soft-text)] group-focus-within:text-indigo-500 transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Search tasks"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className="w-full bg-[var(--secondary)] border border-[var(--border)] rounded-full py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-shrink-0 px-3 sm:px-6">
                <DaemonBar />
            </div>

            <NowRunningPanel
                tasks={filteredTasks}
                processes={activeProcesses}
                onTaskClick={(task) => router.push(`/projects/${slug}/graph/${task.id}`)}
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
                panelId={`now-running:${slug}`}
            />

            <div className="flex-1 min-h-0 relative">
                <div className="absolute inset-0 overflow-hidden">
                    <KanbanBoard
                        tasks={filteredTasks}
                        onSelectTask={handleSelectTask}
                        onTasksChange={() => { }}
                        onTaskUpdate={handleTaskUpdate}
                        onAddTask={(title: string, stage: string) => handleQuickAddTask(title, stage)}
                        stages={stages}
                        stageConfig={stageConfig}
                        isValidTransition={projectHasV2Graphs ? undefined : isValidTransition}
                        graphColumnFn={projectHasV2Graphs ? graphColumnFn : undefined}
                    />
                </div>
            </div>
        </div>
    );
}

interface BoardFilterMultiSelectProps {
    label: string;
    options: FilterOption[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
}

function BoardFilterMultiSelect({
    label,
    options,
    selectedValues,
    onChange,
}: BoardFilterMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    const filteredOptions = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return options;
        return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
    }, [options, query]);

    const buttonLabel = selectedValues.length === 0 ? label : `${label} (${selectedValues.length})`;

    const toggleValue = (value: string) => {
        if (selectedSet.has(value)) {
            onChange(selectedValues.filter((entry) => entry !== value));
            return;
        }
        onChange([...selectedValues, value]);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        selectedValues.length > 0
                            ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-600"
                            : "border-[var(--border)] bg-[var(--secondary)] text-[var(--foreground)]"
                    }`}
                >
                    <span>{buttonLabel}</span>
                    <ChevronDown size={14} />
                </button>
                {selectedValues.length > 0 && (
                    <button
                        type="button"
                        onClick={() => onChange([])}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                        aria-label={`Clear ${label} filters`}
                    >
                        <X size={12} />
                    </button>
                )}
            </div>

            {open && (
                <div className="absolute left-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl shadow-black/10 backdrop-blur-xl">
                    <div className="border-b border-[var(--border)] p-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-shell-soft-text)]" size={14} />
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={`Search ${label.toLowerCase()}`}
                                className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto p-2">
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                                No matches
                            </div>
                        ) : (
                            filteredOptions.map((option) => {
                                const selected = selectedSet.has(option.value);
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => toggleValue(option.value)}
                                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                                            selected
                                                ? "bg-indigo-500/10 text-[var(--foreground)]"
                                                : "text-[var(--foreground)] hover:bg-[var(--secondary)]"
                                        }`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                                                selected
                                                    ? "border-indigo-500 bg-indigo-500 text-white"
                                                    : "border-[var(--border)] bg-[var(--card-bg)] text-transparent"
                                            }`}>
                                                <Check size={11} />
                                            </span>
                                            <span>{option.label}</span>
                                        </span>
                                        <span className="text-[10px] text-[var(--muted-foreground)]">{option.count}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

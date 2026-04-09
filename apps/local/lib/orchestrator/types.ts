/**
 * Orchestrator type definitions - migrated from Temporal workflow types
 */

import type { TaskStage } from "@/lib/db-adapter.interface";
import type { StageDecision } from "@/lib/orchestration/stage-machine";

export interface TaskWorkflowInput {
    taskId: string;
    userId: string;
    stage: TaskStage;
    ticketType: "task" | "spike";
}

export interface AgentDecisionSignalPayload {
    decision: StageDecision;
    explanation: string;
    final_result: string;
    comments?: string[];
    comment?: string;
    log?: string;
}

export interface HumanInputSignalPayload {
    content: string;
    authorType?: "user" | "agent";
}

export interface DaemonStepSignalPayload {
    kind?: string;
    task_id?: string;
    provider?: string | null;
    model?: string | null;
    role?: string;
    iteration?: number;
    providers?: string[];

    id?: string;
    phase?: "start" | "exit" | "timeout" | "error" | string;
    label?: string;
    args?: string[];
    pid?: number | null;
    timeout_ms?: number;
    started_at?: string;
    finished_at?: string;
    duration_ms?: number;
    exit_code?: number | null;
    stdout_tail?: string;
    stderr_tail?: string;
    error?: string;
}

export interface WorkflowStatus {
    taskId: string;
    stage: TaskStage;
    attempts: number;
    blocked: boolean;
    cancelled: boolean;
    cancelReason?: string;
    lastDecision: StageDecision | null;
    updatedAt: string;
}

export type TaskSignal = "start" | "agentResult" | "humanInput" | "daemonStep" | "cancel";

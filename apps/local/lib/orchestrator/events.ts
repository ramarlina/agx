/**
 * Workflow event logging - Temporal-independent version
 */

import { createAdminDbClient } from "@/lib/db-adapter";

export interface WorkflowEventInput {
    taskId: string;
    userId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    jobId?: string;
}

/**
 * Append an event to the workflow_events table
 */
export async function appendWorkflowEvent(input: WorkflowEventInput): Promise<void> {
    const db = createAdminDbClient();
    await db.from("workflow_events").insert({
        task_id: input.taskId,
        user_id: input.userId,
        event_type: input.eventType,
        payload: input.payload || {},
        job_id: input.jobId || null,
        created_at: new Date().toISOString(),
    });
}

import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import type { GraphSchedule } from "@/src/graph/types";
import { normalizeLegacyConditionSchedule } from "@/src/prompt-scheduler/cron";
import type { PromptJob, RunStatus } from "@/src/prompt-scheduler/types";
import {
  AutomationRepository,
  graphAutomationToDefinition,
  graphAutomationToRuntimeState,
  promptJobToAutomationDefinition,
  promptJobToAutomationRuntimeState,
} from "@/src/automations";

interface PromptJobRow {
  id: string;
  name: string;
  prompt: string;
  cli: string;
  agent_id: string | null;
  project_id: string | null;
  provider: string;
  model: string;
  cli_args: string;
  cron_expr: string;
  cadence: string;
  state: string;
  overlap_policy: string;
  catch_up_policy: string;
  cancel_check_sec: number;
  trigger_type: string;
  condition: string;
  check_every_ms: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_outcome: string | null;
  created_at: string;
  updated_at: string;
}

interface GraphAutomationRow {
  graphId: string;
  taskId: string;
  schedule: string;
  executionState: string;
  createdAt: string;
  updatedAt: string;
}

function rowToPromptJob(row: PromptJobRow): PromptJob {
  const legacySchedule = row.trigger_type === "condition"
    ? normalizeLegacyConditionSchedule(row.check_every_ms || 300000)
    : null;

  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentId: row.agent_id || "",
    projectId: row.project_id || "",
    provider: row.provider || row.cli || "claude",
    model: row.model || "",
    cliArgs: row.cli_args || "",
    cronExpr: row.cron_expr || legacySchedule?.cronExpr || "",
    cadence: row.cadence || legacySchedule?.cadence || row.cron_expr || "",
    state: row.state as PromptJob["state"],
    overlapPolicy: row.overlap_policy as PromptJob["overlapPolicy"],
    catchUpPolicy: row.catch_up_policy as PromptJob["catchUpPolicy"],
    cancelCheckSec: row.cancel_check_sec,
    condition: row.condition || "",
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastOutcome: row.last_outcome as RunStatus | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function main(): void {
  const db = getSQLiteDb();
  const repository = new AutomationRepository();

  const promptRows = db.prepare(`
    SELECT *
    FROM prompt_jobs
    ORDER BY created_at ASC
  `).all() as PromptJobRow[];

  const graphRows = db.prepare(`
    SELECT
      id AS graphId,
      task_id AS taskId,
      schedule,
      execution_state AS executionState,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM execution_graphs
    WHERE schedule IS NOT NULL
    ORDER BY created_at ASC
  `).all() as GraphAutomationRow[];

  for (const row of promptRows) {
    const job = rowToPromptJob(row);
    repository.upsertAutomation(promptJobToAutomationDefinition(job));
    const runtimeState = promptJobToAutomationRuntimeState(job);
    repository.updateAutomationState(job.id, {
      nextRunAt: runtimeState.nextRunAt,
      lastRunAt: runtimeState.lastRunAt,
      lastOutcome: runtimeState.lastOutcome,
      lastError: runtimeState.lastError,
      updatedAt: runtimeState.updatedAt,
    });
  }

  for (const row of graphRows) {
    const schedule = JSON.parse(row.schedule) as GraphSchedule;
    repository.upsertAutomation(graphAutomationToDefinition({
      graphId: row.graphId,
      taskId: row.taskId,
      schedule,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      executionState: row.executionState,
    }));
    const runtimeState = graphAutomationToRuntimeState({
      graphId: row.graphId,
      taskId: row.taskId,
      schedule,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      executionState: row.executionState,
    });
    repository.updateAutomationState(row.graphId, {
      nextRunAt: runtimeState.nextRunAt,
      lastRunAt: runtimeState.lastRunAt,
      updatedAt: runtimeState.updatedAt,
      runCount: runtimeState.runCount,
      consecutiveFailures: runtimeState.consecutiveFailures,
      tickInProgress: runtimeState.tickInProgress,
    });
  }

  process.stdout.write(`${JSON.stringify({
    rootDir: repository.rootDir,
    promptJobsBackfilled: promptRows.length,
    graphAutomationsBackfilled: graphRows.length,
  }, null, 2)}\n`);
}

main();

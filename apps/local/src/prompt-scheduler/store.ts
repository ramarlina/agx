import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { basename } from "path";
import { promisify } from "util";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

const execFileAsync = promisify(execFile);

import {
  automationRecordToPromptJob,
  getAutomationRepository,
  isAutomationDualReadEnabled,
  isAutomationFrontmatterEnabled,
  promptJobToAutomationDefinition,
  promptJobToAutomationRuntimeState,
  type AutomationRecord,
  type AutomationStatePatch,
  type AutomationUpdatePatch,
} from "@/src/automations";
import { computeNextTickFromCron } from "../graph/scheduler";
import type {
  CreatePromptJobInput,
  PromptJob,
  PromptJobState,
  PromptRun,
  RunStatus,
  UpdatePromptJobInput,
} from "./types";

/**
 * Extract the basename of the first token (the binary) from a command string.
 * e.g. "/usr/local/bin/claude -p foo" → "claude"
 *      "claude -p foo"               → "claude"
 */
function commandBasename(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0] ?? "";
  return basename(firstToken);
}

/**
 * Batch-check which PIDs are still alive and running matching commands.
 * Runs a single `ps` call for all PIDs (async, non-blocking).
 *
 * Returns a Set of PIDs that are alive AND whose running command's basename
 * matches the expected command's basename (guards against PID recycling).
 */
async function getAlivePids(
  entries: Array<{ pid: number; expectedCommand: string }>,
): Promise<Set<number>> {
  const alive = new Set<number>();
  if (entries.length === 0) return alive;

  // Fast pre-filter: drop PIDs where the OS says the process doesn't exist
  const candidates = entries.filter(({ pid }) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) return alive;

  // One batched ps call for all surviving PIDs
  const pidList = candidates.map((c) => c.pid).join(",");
  try {
    const { stdout } = await execFileAsync("ps", ["-p", pidList, "-o", "pid=,command="], {
      timeout: 5000,
    });

    // Build a map: pid → running command basename
    const runningMap = new Map<number, string>();
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: "  1234 /usr/local/bin/claude -p ..."
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (match) {
        runningMap.set(Number(match[1]), commandBasename(match[2]));
      }
    }

    // Compare basenames
    for (const { pid, expectedCommand } of candidates) {
      const runningBasename = runningMap.get(pid);
      if (runningBasename && runningBasename === commandBasename(expectedCommand)) {
        alive.add(pid);
      }
    }
  } catch {
    // ps failed entirely — treat all candidates as dead
  }

  return alive;
}

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

interface PromptRunRow {
  id: string;
  job_id: string;
  status: string;
  output: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  host_pid: number | null;
  host_command: string | null;
  created_at: string;
}

function rowToJob(row: PromptJobRow): PromptJob {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentId: row.agent_id || "",
    projectId: row.project_id || "",
    provider: row.provider || row.cli || "claude",
    model: row.model || "",
    cliArgs: row.cli_args || "",
    cronExpr: row.cron_expr,
    cadence: row.cadence,
    state: row.state as PromptJobState,
    overlapPolicy: row.overlap_policy as PromptJob["overlapPolicy"],
    catchUpPolicy: (row.catch_up_policy || "fire_once") as PromptJob["catchUpPolicy"],
    cancelCheckSec: row.cancel_check_sec,
    triggerType: (row.trigger_type || "scheduled") as PromptJob["triggerType"],
    condition: row.condition || "",
    checkEveryMs: row.check_every_ms || 300000,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastOutcome: row.last_outcome as RunStatus | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: PromptRunRow): PromptRun {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status as RunStatus,
    output: row.output,
    error: row.error,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    hostPid: row.host_pid,
    hostCommand: row.host_command,
    createdAt: row.created_at,
  };
}

function sortJobsByCreatedAt(jobs: PromptJob[]): PromptJob[] {
  return [...jobs].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  });
}

function hasAnyValue(values: Record<string, unknown>): boolean {
  return Object.values(values).some((value) => value !== undefined);
}

export class PromptJobStore {
  private automationRepository?: ReturnType<typeof getAutomationRepository>;

  constructor(
    private readonly db: DatabaseSync,
    automationRepository?: ReturnType<typeof getAutomationRepository>,
  ) {
    this.automationRepository = automationRepository;
  }

  private getAutomationRepo() {
    this.automationRepository ??= getAutomationRepository();
    return this.automationRepository;
  }

  createJob(input: CreatePromptJobInput): PromptJob {
    if (!isAutomationFrontmatterEnabled()) {
      return this.createLegacyJob(input);
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const record = this.getAutomationRepo().createAutomation({
      id,
      name: input.name,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      state: "active",
      trigger: (input.triggerType ?? "scheduled") === "condition"
        ? {
          type: "condition",
          condition: input.condition ?? "",
          checkEveryMs: input.checkEveryMs ?? 300000,
        }
        : {
          type: "scheduled",
          ...(input.cadence ? { cadence: input.cadence } : {}),
          ...(input.cronExpr ? { cronExpr: input.cronExpr } : {}),
        },
      execution: {
        overlapPolicy: input.overlapPolicy,
        catchUpPolicy: input.catchUpPolicy,
        cancelCheckSec: input.cancelCheckSec,
      },
      target: {
        type: "prompt_job",
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.cliArgs !== undefined ? { cliArgs: input.cliArgs } : {}),
      },
      createdAt,
      body: input.prompt,
    });

    const job = automationRecordToPromptJob(record);
    this.upsertLegacyJobRow(job);
    return job;
  }

  getJob(id: string): PromptJob | null {
    if (!isAutomationFrontmatterEnabled()) {
      return this.getLegacyJob(id);
    }

    const record = this.getAutomationRepo().getAutomation(id);
    if (record?.definition.target.type === "prompt_job") {
      const job = automationRecordToPromptJob(record);
      this.ensureLegacyJobRow(job);
      return job;
    }

    return isAutomationDualReadEnabled() ? this.getLegacyJob(id) : null;
  }

  listJobs(filter?: { state?: PromptJobState; projectId?: string }): PromptJob[] {
    if (!isAutomationFrontmatterEnabled()) {
      return this.listLegacyJobs(filter);
    }

    const jobsById = new Map<string, PromptJob>();
    for (const record of this.getAutomationRepo().listVisibleAutomations({
      targetType: "prompt_job",
      ...(filter?.state ? { state: filter.state } : {}),
      ...(filter?.projectId ? { projectId: filter.projectId } : {}),
    })) {
      const job = automationRecordToPromptJob(record);
      jobsById.set(job.id, job);
      this.ensureLegacyJobRow(job);
    }

    if (isAutomationDualReadEnabled()) {
      for (const job of this.listLegacyJobs(filter)) {
        if (!jobsById.has(job.id)) {
          jobsById.set(job.id, job);
        }
      }
    }

    return sortJobsByCreatedAt([...jobsById.values()]);
  }

  updateJob(id: string, updates: UpdatePromptJobInput): PromptJob | null {
    if (!isAutomationFrontmatterEnabled()) {
      return this.updateLegacyJob(id, updates);
    }

    const existingRecord = this.getAutomationRepo().getAutomation(id);
    if (!existingRecord) {
      return isAutomationDualReadEnabled() ? this.updateLegacyJob(id, updates) : null;
    }

    if (existingRecord.definition.target.type !== "prompt_job") {
      return null;
    }

    let record = existingRecord;

    const definitionPatch = this.buildDefinitionPatch(record, updates);
    if (hasAnyValue(definitionPatch as Record<string, unknown>)) {
      const updatedRecord = this.getAutomationRepo().updateAutomation(id, definitionPatch);
      if (!updatedRecord) {
        return null;
      }
      record = updatedRecord;
    }

    const statePatch = this.buildStatePatch(updates);
    if (hasAnyValue(statePatch as Record<string, unknown>)) {
      const updatedStateRecord = this.getAutomationRepo().updateAutomationState(id, statePatch);
      if (!updatedStateRecord) {
        return null;
      }
      record = updatedStateRecord;
    }

    const job = automationRecordToPromptJob(record);
    this.upsertLegacyJobRow(job);
    return job;
  }

  deleteJob(id: string): void {
    if (isAutomationFrontmatterEnabled()) {
      this.getAutomationRepo().deleteAutomation(id);
    }
    this.db.prepare("DELETE FROM prompt_jobs WHERE id = ?").run(id);
  }

  getDueJobs(now: number = Date.now()): PromptJob[] {
    if (!isAutomationFrontmatterEnabled()) {
      return this.getLegacyDueJobs(now);
    }

    const jobsById = new Map<string, PromptJob>();
    for (const record of this.getAutomationRepo().listDueAutomations(now, {
      targetType: "prompt_job",
    })) {
      const job = automationRecordToPromptJob(record);
      jobsById.set(job.id, job);
      this.ensureLegacyJobRow(job);
    }

    if (isAutomationDualReadEnabled()) {
      for (const job of this.getLegacyDueJobs(now)) {
        if (!jobsById.has(job.id)) {
          jobsById.set(job.id, job);
        }
      }
    }

    return [...jobsById.values()].sort((left, right) => {
      const leftNext = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const rightNext = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      return leftNext - rightNext;
    });
  }

  createRun(jobId: string): PromptRun {
    this.ensureLegacyJobRowById(jobId);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO prompt_runs (id, job_id) VALUES (?, ?)")
      .run(id, jobId);
    return this.getRun(id) as PromptRun;
  }

  getRun(id: string): PromptRun | null {
    const row = this.db
      .prepare("SELECT * FROM prompt_runs WHERE id = ?")
      .get(id) as PromptRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  listRuns(jobId: string, limit = 50): PromptRun[] {
    const rows = this.db
      .prepare("SELECT * FROM prompt_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(jobId, limit) as unknown as PromptRunRow[];
    return rows.map(rowToRun);
  }

  updateRun(id: string, updates: Partial<Omit<PromptRun, "id" | "jobId" | "createdAt">>): PromptRun | null {
    const fieldMap: Record<string, string> = {
      status: "status",
      output: "output",
      error: "error",
      durationMs: "duration_ms",
      startedAt: "started_at",
      finishedAt: "finished_at",
      cancelledAt: "cancelled_at",
      hostPid: "host_pid",
      hostCommand: "host_command",
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const column = fieldMap[key];
      if (!column) {
        continue;
      }
      setClauses.push(`${column} = ?`);
      values.push(value ?? null);
    }

    if (setClauses.length === 0) {
      return this.getRun(id);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE prompt_runs SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values.map((value) => value as SQLInputValue));

    return this.getRun(id);
  }

  hasRunningRun(jobId: string): boolean {
    const row = this.db
      .prepare("SELECT id FROM prompt_runs WHERE job_id = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(jobId);
    return row !== undefined;
  }

  /**
   * Reap runs whose host process is no longer alive.
   *
   * For runs that recorded a host_pid + host_command: check whether the PID
   * is still running with the same command.  If not, the process crashed or
   * was killed and the run will never complete — mark it failed.
   *
   * For runs without a host_pid (legacy): fall back to a time-based cutoff
   * so they don't block the overlap-skip forever.
   */
  async reapStaleRuns(maxAgeMs: number = 30 * 60 * 1000): Promise<number> {
    const runs = this.db
      .prepare(
        `SELECT id, job_id, host_pid, host_command, started_at, created_at
         FROM prompt_runs
         WHERE status IN ('queued', 'running')`,
      )
      .all() as unknown as Array<{
        id: string;
        job_id: string;
        host_pid: number | null;
        host_command: string | null;
        started_at: string | null;
        created_at: string;
      }>;

    const now = Date.now();

    // Batch-check all PID-tracked runs in one async ps call
    const pidEntries = runs
      .filter((r): r is typeof r & { host_pid: number; host_command: string } =>
        r.host_pid != null && r.host_command != null)
      .map((r) => ({ pid: r.host_pid, expectedCommand: r.host_command }));
    const alivePids = await getAlivePids(pidEntries);

    let reaped = 0;

    for (const run of runs) {
      const startedAt = run.started_at || run.created_at;
      const ageMs = now - new Date(startedAt).getTime();

      let shouldReap = false;
      let reason: string;

      if (run.host_pid != null && run.host_command) {
        if (!alivePids.has(run.host_pid)) {
          shouldReap = true;
          reason = `Host process (pid ${run.host_pid}) is no longer running`;
        } else {
          reason = '';
        }
      } else {
        // Legacy run without PID tracking — fall back to time-based cutoff
        if (ageMs > maxAgeMs) {
          shouldReap = true;
          reason = `No host PID recorded; stuck for ${Math.round(ageMs / 60000)} minutes`;
        } else {
          reason = '';
        }
      }

      if (shouldReap) {
        this.db
          .prepare(
            `UPDATE prompt_runs
             SET status = 'failed',
                 error = ?,
                 duration_ms = ?,
                 finished_at = ?
             WHERE id = ?`,
          )
          .run(`Reaped: ${reason!}`, ageMs, new Date().toISOString(), run.id);
        reaped++;
      }
    }

    return reaped;
  }

  isRunCancelled(runId: string): boolean {
    const row = this.db
      .prepare("SELECT status FROM prompt_runs WHERE id = ?")
      .get(runId) as { status: string } | undefined;
    return row?.status === "cancelled";
  }

  private getPromptJobRecord(id: string, materializeLegacy: boolean): AutomationRecord | null {
    const record = this.getAutomationRepo().getAutomation(id);
    if (record?.definition.target.type === "prompt_job") {
      return record;
    }

    if (!materializeLegacy || !isAutomationDualReadEnabled()) {
      return null;
    }

    const legacyJob = this.getLegacyJob(id);
    if (!legacyJob) {
      return null;
    }

    return this.materializeLegacyJob(legacyJob);
  }

  private materializeLegacyJob(job: PromptJob): AutomationRecord {
    const definition = promptJobToAutomationDefinition(job);
    const runtimeState = promptJobToAutomationRuntimeState(job);
    const record = this.getAutomationRepo().upsertAutomation(definition);
    return this.getAutomationRepo().updateAutomationState(job.id, {
      nextRunAt: runtimeState.nextRunAt,
      lastRunAt: runtimeState.lastRunAt,
      lastOutcome: runtimeState.lastOutcome,
      lastError: runtimeState.lastError,
      updatedAt: runtimeState.updatedAt,
    }) ?? record;
  }

  private buildDefinitionPatch(
    record: AutomationRecord,
    updates: UpdatePromptJobInput,
  ): AutomationUpdatePatch {
    const patch: Record<string, unknown> = {};
    const triggerPatch: Record<string, unknown> = {};
    const executionPatch: Record<string, unknown> = {};
    const targetPatch: Record<string, unknown> = {};

    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.projectId !== undefined) patch.projectId = updates.projectId || null;
    if (updates.state !== undefined) patch.state = updates.state;
    if (updates.prompt !== undefined) patch.body = updates.prompt;

    if (
      updates.triggerType !== undefined
      || updates.cadence !== undefined
      || updates.cronExpr !== undefined
      || updates.condition !== undefined
      || updates.checkEveryMs !== undefined
    ) {
      const currentTrigger = record.definition.trigger;
      const triggerType = updates.triggerType ?? currentTrigger.type;
      triggerPatch.type = triggerType;

      if (triggerType === "condition") {
        triggerPatch.condition = updates.condition
          ?? (currentTrigger.type === "condition" ? currentTrigger.condition : "");
        triggerPatch.checkEveryMs = updates.checkEveryMs
          ?? (currentTrigger.type === "condition" ? currentTrigger.checkEveryMs : 300000);
      } else {
        triggerPatch.cadence = updates.cadence === ""
          ? undefined
          : updates.cadence ?? (currentTrigger.type === "scheduled" ? currentTrigger.cadence : undefined);
        triggerPatch.cronExpr = updates.cronExpr !== undefined
          ? updates.cronExpr
          : updates.cadence !== undefined && updates.cadence !== ""
            ? undefined
            : (currentTrigger.type === "scheduled" ? currentTrigger.cronExpr : undefined);
        triggerPatch.intervalMs = currentTrigger.type === "scheduled" ? currentTrigger.intervalMs : undefined;
      }
    }

    if (updates.overlapPolicy !== undefined) executionPatch.overlapPolicy = updates.overlapPolicy;
    if (updates.catchUpPolicy !== undefined) executionPatch.catchUpPolicy = updates.catchUpPolicy;
    if (updates.cancelCheckSec !== undefined) executionPatch.cancelCheckSec = updates.cancelCheckSec;

    if (updates.agentId !== undefined) targetPatch.agentId = updates.agentId || undefined;
    if (updates.provider !== undefined) targetPatch.provider = updates.provider || undefined;
    if (updates.model !== undefined) targetPatch.model = updates.model || undefined;
    if (updates.cliArgs !== undefined) targetPatch.cliArgs = updates.cliArgs;

    return {
      ...(Object.keys(patch).length > 0 ? patch : {}),
      ...(Object.keys(triggerPatch).length > 0 ? { trigger: triggerPatch } : {}),
      ...(Object.keys(executionPatch).length > 0 ? { execution: executionPatch } : {}),
      ...(Object.keys(targetPatch).length > 0 ? { target: targetPatch } : {}),
    };
  }

  private buildStatePatch(updates: UpdatePromptJobInput): AutomationStatePatch {
    const patch: AutomationStatePatch = {};
    if (updates.nextRunAt !== undefined) patch.nextRunAt = updates.nextRunAt;
    if (updates.lastRunAt !== undefined) patch.lastRunAt = updates.lastRunAt;
    if (updates.lastOutcome !== undefined) patch.lastOutcome = updates.lastOutcome;
    return patch;
  }

  private ensureLegacyJobRowById(jobId: string): void {
    if (this.legacyJobRowExists(jobId)) {
      return;
    }
    const job = this.getJob(jobId);
    if (job) {
      this.upsertLegacyJobRow(job);
    }
  }

  private ensureLegacyJobRow(job: PromptJob): void {
    if (!this.legacyJobRowExists(job.id)) {
      this.upsertLegacyJobRow(job);
    }
  }

  private legacyJobRowExists(jobId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM prompt_jobs WHERE id = ?")
      .get(jobId);
    return row !== undefined;
  }

  private upsertLegacyJobRow(job: PromptJob): void {
    this.db
      .prepare(
        `INSERT INTO prompt_jobs (
          id, name, prompt, cli, agent_id, project_id, provider, model, cli_args,
          cron_expr, cadence, state, overlap_policy, catch_up_policy, cancel_check_sec,
          trigger_type, condition, check_every_ms, next_run_at, last_run_at, last_outcome,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          prompt = excluded.prompt,
          cli = excluded.cli,
          agent_id = excluded.agent_id,
          project_id = excluded.project_id,
          provider = excluded.provider,
          model = excluded.model,
          cli_args = excluded.cli_args,
          cron_expr = excluded.cron_expr,
          cadence = excluded.cadence,
          state = excluded.state,
          overlap_policy = excluded.overlap_policy,
          catch_up_policy = excluded.catch_up_policy,
          cancel_check_sec = excluded.cancel_check_sec,
          trigger_type = excluded.trigger_type,
          condition = excluded.condition,
          check_every_ms = excluded.check_every_ms,
          next_run_at = excluded.next_run_at,
          last_run_at = excluded.last_run_at,
          last_outcome = excluded.last_outcome,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        job.id,
        job.name,
        job.prompt,
        job.provider || "claude",
        job.agentId || null,
        job.projectId || null,
        job.provider || "claude",
        job.model || "",
        job.cliArgs || "",
        job.cronExpr || "",
        job.cadence || "",
        job.state,
        job.overlapPolicy,
        job.catchUpPolicy,
        job.cancelCheckSec,
        job.triggerType,
        job.condition || "",
        job.checkEveryMs,
        job.nextRunAt ?? null,
        job.lastRunAt ?? null,
        job.lastOutcome ?? null,
        job.createdAt,
        job.updatedAt,
      );
  }

  private createLegacyJob(input: CreatePromptJobInput): PromptJob {
    const id = randomUUID();
    const cadence = input.cadence;
    const cronExpr = input.cronExpr || cadence;
    const triggerType = input.triggerType ?? "scheduled";
    const provider = input.provider ?? "claude";

    let nextRunAt: number | null;
    if (triggerType === "condition") {
      nextRunAt = Date.now() + (input.checkEveryMs ?? 300000);
    } else {
      nextRunAt = computeNextTickFromCron(cronExpr) ?? null;
    }

    this.db
      .prepare(
        `INSERT INTO prompt_jobs (
          id, name, prompt, cli, agent_id, project_id, provider, model, cli_args,
          cron_expr, cadence, overlap_policy, catch_up_policy, cancel_check_sec,
          trigger_type, condition, check_every_ms, next_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.prompt,
        provider,
        input.agentId || null,
        input.projectId || null,
        provider,
        input.model ?? "",
        input.cliArgs ?? "",
        cronExpr,
        cadence,
        input.overlapPolicy ?? "skip",
        input.catchUpPolicy ?? "fire_once",
        input.cancelCheckSec ?? 5,
        triggerType,
        input.condition ?? "",
        input.checkEveryMs ?? 300000,
        nextRunAt,
      );

    return this.getLegacyJob(id) as PromptJob;
  }

  private getLegacyJob(id: string): PromptJob | null {
    const row = this.db
      .prepare("SELECT * FROM prompt_jobs WHERE id = ?")
      .get(id) as PromptJobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  private listLegacyJobs(filter?: { state?: PromptJobState; projectId?: string }): PromptJob[] {
    let sql = "SELECT * FROM prompt_jobs";
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter?.state) {
      conditions.push("state = ?");
      params.push(filter.state);
    }
    if (filter?.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY created_at DESC";

    const rows = this.db.prepare(sql).all(...params) as unknown as PromptJobRow[];
    return rows.map(rowToJob);
  }

  private updateLegacyJob(id: string, updates: UpdatePromptJobInput): PromptJob | null {
    const fieldMap: Record<string, string> = {
      name: "name",
      prompt: "prompt",
      cli: "cli",
      agentId: "agent_id",
      projectId: "project_id",
      provider: "provider",
      cronExpr: "cron_expr",
      model: "model",
      cliArgs: "cli_args",
      cadence: "cadence",
      state: "state",
      overlapPolicy: "overlap_policy",
      catchUpPolicy: "catch_up_policy",
      cancelCheckSec: "cancel_check_sec",
      triggerType: "trigger_type",
      condition: "condition",
      checkEveryMs: "check_every_ms",
      nextRunAt: "next_run_at",
      lastRunAt: "last_run_at",
      lastOutcome: "last_outcome",
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const column = fieldMap[key];
      if (!column || value === undefined) {
        continue;
      }

      setClauses.push(`${column} = ?`);
      values.push(value);

      if (key === "cadence" && typeof value === "string" && updates.cronExpr === undefined) {
        setClauses.push("cron_expr = ?");
        values.push(value);
        setClauses.push("next_run_at = ?");
        values.push(computeNextTickFromCron(value) ?? null);
      }
    }

    if (setClauses.length === 0) {
      return this.getLegacyJob(id);
    }

    setClauses.push("updated_at = datetime('now')");
    values.push(id);

    this.db
      .prepare(`UPDATE prompt_jobs SET ${setClauses.join(", ")} WHERE id = ?`)
      .run(...values.map((value) => value as SQLInputValue));

    return this.getLegacyJob(id);
  }

  private getLegacyDueJobs(now: number): PromptJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM prompt_jobs
         WHERE state = 'active'
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as unknown as PromptJobRow[];
    return rows.map(rowToJob);
  }
}

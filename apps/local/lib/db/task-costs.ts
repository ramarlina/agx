import { createAdminDbClient } from "../db-adapter";

export interface TaskCostEntry {
  id: string;
  task_id: string;
  stage: string;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: string | null;
  created_at: string;
}

export interface TaskCostStageSummary {
  stage: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  entries: number;
}

export interface TaskCostSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  per_stage: TaskCostStageSummary[];
}

function normalizeTokenCount(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeCostValue(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export async function addTaskCostEntry(input: {
  taskId: string;
  stage: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}): Promise<TaskCostEntry> {
  const db = createAdminDbClient();

  const payload = {
    task_id: input.taskId,
    stage: input.stage,
    provider: input.provider ?? null,
    model: input.model ?? null,
    input_tokens: normalizeTokenCount(input.inputTokens),
    output_tokens: normalizeTokenCount(input.outputTokens),
    estimated_cost: normalizeCostValue(input.estimatedCost),
  };

  const { data, error } = await db
    .from("task_costs")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getTaskCostEntries(taskId: string): Promise<TaskCostEntry[]> {
  const db = createAdminDbClient();

  const { data, error } = await db
    .from("task_costs")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export function summarizeTaskCosts(entries: TaskCostEntry[]): TaskCostSummary {
  const stageMap: Record<string, TaskCostStageSummary> = {};
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const entry of entries) {
    const stageKey = entry.stage || "unknown";
    const input = normalizeTokenCount(entry.input_tokens);
    const output = normalizeTokenCount(entry.output_tokens);
    const cost = normalizeCostValue(entry.estimated_cost ?? 0);

    totalInput += input;
    totalOutput += output;
    totalCost += cost;

    const existing = stageMap[stageKey] || {
      stage: stageKey,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost: 0,
      entries: 0,
    };

    existing.input_tokens += input;
    existing.output_tokens += output;
    existing.estimated_cost += cost;
    existing.entries += 1;
    stageMap[stageKey] = existing;
  }

  const perStage = Object.values(stageMap).sort((a, b) => a.stage.localeCompare(b.stage));

  return {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cost: totalCost,
    per_stage: perStage,
  };
}

export async function getTaskCostSummary(taskId: string): Promise<TaskCostSummary> {
  const entries = await getTaskCostEntries(taskId);
  return summarizeTaskCosts(entries);
}


import { createAdminDbClient } from "../db-adapter";
import type {
  SwarmModel,
  TaskStage,
  Workflow,
  WorkflowNode,
  WorkflowTransition,
  WorkflowWithGraph,
} from "./types";
import { isMissingRelationError } from "./shared";

const DEFAULT_SDLC_WORKFLOW_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

const DEFAULT_WORKFLOW_NODE_SEED = [
  {
    id: "00000000-0000-0000-0001-000000000001",
    name: "INTAKE",
    label: "Intake",
    prompt: "New task. Triage, scope, and prepare for work.",
    position: 0,
    node_type: "step" as const,
  },
  {
    id: "00000000-0000-0000-0001-000000000002",
    name: "PROGRESS",
    label: "Progress",
    prompt: "Task is actively being worked on.",
    position: 1,
    node_type: "step" as const,
  },
  {
    id: "00000000-0000-0000-0001-000000000003",
    name: "DONE",
    label: "Done",
    prompt: "Task completed.",
    position: 2,
    node_type: "terminal" as const,
  },
];

const DEFAULT_WORKFLOW_NODE_SEED_BY_ID = new Map(
  DEFAULT_WORKFLOW_NODE_SEED.map((node) => [node.id, node])
);

async function ensureDefaultWorkflowGraphExists(userId: string): Promise<void> {
  const db = createAdminDbClient();
  const ownerId = userId || DEFAULT_SYSTEM_USER_ID;

  const { error: workflowError } = await db
    .from("workflows")
    .upsert(
      {
        id: DEFAULT_SDLC_WORKFLOW_ID,
        user_id: ownerId,
        name: "Default Workflow",
        definition: {},
      },
      { onConflict: "id" }
    );
  if (workflowError) throw workflowError;

  const { error: nodeError } = await db
    .from("workflow_nodes")
    .upsert(
      DEFAULT_WORKFLOW_NODE_SEED.map((node) => ({
        ...node,
        workflow_id: DEFAULT_SDLC_WORKFLOW_ID,
        metadata: {},
      })),
      { onConflict: "id" }
    );
  if (nodeError) throw nodeError;

  const { error: transitionError } = await db
    .from("workflow_transitions")
    .upsert(
      [
        {
          workflow_id: DEFAULT_SDLC_WORKFLOW_ID,
          from_node_id: "00000000-0000-0000-0001-000000000001",
          to_node_id: "00000000-0000-0000-0001-000000000002",
          condition: "done",
          priority: 0,
          metadata: {},
        },
        {
          workflow_id: DEFAULT_SDLC_WORKFLOW_ID,
          from_node_id: "00000000-0000-0000-0001-000000000002",
          to_node_id: "00000000-0000-0000-0001-000000000003",
          condition: "done",
          priority: 0,
          metadata: {},
        },
      ],
      { onConflict: "workflow_id,from_node_id,condition" }
    );
  if (transitionError) throw transitionError;
}

export async function getWorkflows(userId: string): Promise<Workflow[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workflows")
    .select("*")
    .or(`user_id.eq.${userId},user_id.eq.00000000-0000-0000-0000-000000000000`)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingRelationError(error, "workflows")) return [];
    throw error;
  }
  return data || [];
}

export async function getWorkflow(id: string, userId?: string): Promise<Workflow | null> {
  const db = createAdminDbClient();
  let query = db.from("workflows").select("*").eq("id", id);
  void userId;

  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isMissingRelationError(error, "workflows")) return null;
    throw error;
  }
  return data;
}

export async function updateWorkflow(
  id: string,
  userId: string,
  updates: { definition?: Record<string, unknown>; name?: string; description?: string }
): Promise<Workflow | null> {
  const db = createAdminDbClient();
  void userId;

  const payload: any = { updated_at: new Date().toISOString() };
  if (updates.definition !== undefined) payload.definition = updates.definition;
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;

  const { data, error } = await db
    .from("workflows")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getWorkflowNodes(workflowId: string): Promise<WorkflowNode[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workflow_nodes")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "workflow_nodes")) return [];
    throw error;
  }
  return data || [];
}

export async function updateWorkflowNodes(
  workflowId: string,
  userId: string,
  updates: Array<{
    id: string;
    prompt?: string;
    provider?: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }>
): Promise<WorkflowNode[]> {
  const db = createAdminDbClient();

  if (workflowId === DEFAULT_SDLC_WORKFLOW_ID) {
    await ensureDefaultWorkflowGraphExists(userId);
  }

  const wf = await getWorkflow(workflowId, userId);
  if (!wf) throw new Error("Workflow not found");

  if (workflowId === DEFAULT_SDLC_WORKFLOW_ID) {
    const seedAwareRows = updates.map((node) => {
      const seed = DEFAULT_WORKFLOW_NODE_SEED_BY_ID.get(node.id);
      if (!seed) return null;
      return {
        id: node.id,
        workflow_id: workflowId,
        name: seed.name,
        label: seed.label,
        position: seed.position,
        node_type: seed.node_type,
        prompt: node.prompt ?? seed.prompt,
        provider: node.provider ?? null,
        model: node.model ?? null,
        metadata: node.metadata ?? {},
      };
    }).filter((node): node is NonNullable<typeof node> => Boolean(node));

    if (seedAwareRows.length > 0) {
      const { error } = await db
        .from("workflow_nodes")
        .upsert(seedAwareRows, { onConflict: "id" });
      if (error) throw error;
    }

    return getWorkflowNodes(workflowId);
  }

  await Promise.all(
    updates.map(async (node) => {
      const payload: any = {};
      if (node.prompt !== undefined) payload.prompt = node.prompt;
      if (node.provider !== undefined) payload.provider = node.provider;
      if (node.model !== undefined) payload.model = node.model;
      if (node.metadata !== undefined) payload.metadata = node.metadata;

      if (Object.keys(payload).length === 0) return;

      const { error } = await db
        .from("workflow_nodes")
        .update(payload)
        .eq("workflow_id", workflowId)
        .eq("id", node.id);
      if (error) throw error;
    })
  );

  return getWorkflowNodes(workflowId);
}

export async function getWorkflowNodeByName(
  workflowId: string,
  name: string
): Promise<WorkflowNode | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workflow_nodes")
    .select("*")
    .eq("workflow_id", workflowId)
    .eq("name", name)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error, "workflow_nodes")) return null;
    throw error;
  }
  return data;
}

export async function getWorkflowTransitions(workflowId: string): Promise<WorkflowTransition[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workflow_transitions")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("priority", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "workflow_transitions")) return [];
    throw error;
  }
  return data || [];
}

export async function getWorkflowTransitionsFromNode(
  workflowId: string,
  fromNodeId: string
): Promise<WorkflowTransition[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from("workflow_transitions")
    .select("*")
    .eq("workflow_id", workflowId)
    .eq("from_node_id", fromNodeId)
    .order("priority", { ascending: true });

  if (error) {
    if (isMissingRelationError(error, "workflow_transitions")) return [];
    throw error;
  }
  return data || [];
}

export async function getWorkflowWithGraph(
  id: string,
  userId?: string
): Promise<WorkflowWithGraph | null> {
  const workflow = await getWorkflow(id, userId);
  if (!workflow) return null;

  const [nodes, transitions] = await Promise.all([
    getWorkflowNodes(id),
    getWorkflowTransitions(id),
  ]);

  return { ...workflow, nodes, transitions };
}

export function getDefaultWorkflowId(): string {
  return DEFAULT_SDLC_WORKFLOW_ID;
}

export interface StagePrompt {
  id: string;
  user_id?: string;
  stage: TaskStage;
  prompt: string;
  outputs?: string[];
  is_default: boolean;
  created_at: string;
  swarm?: boolean;
  provider?: string;
  model?: string;
  swarm_models?: SwarmModel[];
}

export const defaultStagePrompts: Record<string, { prompt: string; outputs: string[]; swarm?: boolean; provider?: string; model?: string; swarm_models?: SwarmModel[] }> = {
  INTAKE: {
    prompt: "New task. Triage, scope, and prepare for work.",
    outputs: [],
    swarm: false,
  },
  PROGRESS: {
    prompt: "Task is actively being worked on.",
    outputs: [],
    swarm: false,
  },
  DONE: {
    prompt: "Task completed.",
    outputs: [],
    swarm: false,
  },
};

export const DEFAULT_WORKFLOW_ID = "00000000-0000-0000-0000-000000000001";

export async function getStagePrompts(userId: string | undefined, workflowId: string): Promise<StagePrompt[]> {
  const db = createAdminDbClient();

  let query = db
    .from("stage_prompts")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("stage", { ascending: true });

  if (userId) {
    query = query.or(`user_id.eq.${userId},is_default.eq.true`);
  } else {
    query = query.eq("is_default", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getStagePrompt(stage: TaskStage, userId: string | undefined, workflowId: string): Promise<StagePrompt | null> {
  const db = createAdminDbClient();

  if (userId) {
    const { data: userPrompt } = await db
      .from("stage_prompts")
      .select("*")
      .eq("workflow_id", workflowId)
      .eq("stage", stage)
      .eq("user_id", userId)
      .single();

    if (userPrompt) return userPrompt;
  }

  const { data: defaultPrompt } = await db
    .from("stage_prompts")
    .select("*")
    .eq("workflow_id", workflowId)
    .eq("stage", stage)
    .eq("is_default", true)
    .single();

  return defaultPrompt || null;
}

export async function upsertStagePrompt(
  stage: TaskStage,
  prompt: string,
  outputs: string[] = [],
  userId: string | undefined,
  modelConfig: {
    swarm?: boolean;
    provider?: string;
    model?: string;
    swarm_models?: SwarmModel[];
  } | undefined,
  workflowId: string
): Promise<StagePrompt> {
  const db = createAdminDbClient();

  const payload: any = {
    stage,
    prompt,
    outputs,
    user_id: userId,
    is_default: !userId,
    workflow_id: workflowId,
  };

  if (modelConfig) {
    if (modelConfig.swarm !== undefined) payload.swarm = modelConfig.swarm;
    if (modelConfig.provider !== undefined) payload.provider = modelConfig.provider;
    if (modelConfig.model !== undefined) payload.model = modelConfig.model;
    if (modelConfig.swarm_models !== undefined) payload.swarm_models = modelConfig.swarm_models;
  }

  const { data, error } = await db
    .from("stage_prompts")
    .upsert(payload, {
      onConflict: userId ? "workflow_id,stage,user_id" : "workflow_id,stage,is_default",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteStagePrompt(id: string, userId?: string): Promise<void> {
  const db = createAdminDbClient();
  let query = db.from("stage_prompts").delete().eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw error;
}

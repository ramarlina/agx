import { getProjectMemory, getProjectSkills, getProjectVariables } from "./projects";
import type {
  ExecutionProvenance,
  MemoryProvenance,
  ProjectMemory,
  ProjectSkill,
  SkillProvenance,
} from "./types";

export function resolveSkills(
  agentSkills: Array<{ file: string; condition?: string }>,
  projectSkills: ProjectSkill[]
): SkillProvenance[] {
  const result: SkillProvenance[] = [];
  const agentFileNames = new Set<string>();

  for (const skill of agentSkills) {
    const basename = skill.file.split("/").pop() || skill.file;
    agentFileNames.add(basename);
    result.push({ file: skill.file, condition: skill.condition, source: "agent" });
  }

  for (const skill of projectSkills) {
    const basename = skill.file.split("/").pop() || skill.file;
    if (!agentFileNames.has(basename)) {
      result.push({ file: skill.file, condition: skill.condition ?? undefined, source: "project" });
    }
  }

  return result;
}

export function resolveMemory(
  agentMemory: Array<{ content: string; id?: string }>,
  projectMemory: ProjectMemory[]
): MemoryProvenance[] {
  const result: MemoryProvenance[] = [];

  for (const mem of projectMemory) {
    result.push({ content: mem.content, source: "project", id: mem.id });
  }

  for (const mem of agentMemory) {
    result.push({ content: mem.content, source: "agent", id: mem.id });
  }

  return result;
}

export async function resolveVariables(
  projectId: string
): Promise<Array<{ key: string; value: string; source: "project" }>> {
  const vars = await getProjectVariables(projectId);
  return vars.map((v) => ({ key: v.key, value: v.value, source: "project" as const }));
}

export async function buildExecutionProvenance(
  agentId: string,
  projectId: string,
  agentSkills: Array<{ file: string; condition?: string }>,
  agentMemoryEntries: Array<{ content: string; id?: string }>
): Promise<ExecutionProvenance> {
  void agentId;
  const projectSkills = await getProjectSkills(projectId);
  const projectMem = await getProjectMemory(projectId);
  const variables = await resolveVariables(projectId);

  return {
    skills: resolveSkills(agentSkills, projectSkills),
    memory: resolveMemory(agentMemoryEntries, projectMem),
    variables,
  };
}


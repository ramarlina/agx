import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { dump, load } from "js-yaml";
import { getSQLiteDb } from "./sqlite-query-adapter";
import type {
  Learning,
  LearningScope,
  Project,
  ProjectAgent,
  ProjectInput,
  ProjectMemory,
  ProjectRepo,
  ProjectRepoInput,
  ProjectSkill,
  ProjectThread,
  ProjectUpdatePayload,
  ProjectVariable,
  ProjectWithRepos,
} from "./db";

export type VaultKnowledgeScope = "global" | "agent" | "project" | "repo";
export type VaultKnowledgeSourceType = "reflection" | "thread_transition" | "task_completion" | "manual";
export type VaultKnowledgeKind =
  | "outcome"
  | "decision"
  | "pattern"
  | "gotcha"
  | "preference"
  | "constraint"
  | "convention"
  | "lesson";

export interface VaultKnowledgeEvidence {
  id?: string;
  note: string;
}

export interface VaultKnowledgeEntry {
  id: string;
  scope: VaultKnowledgeScope;
  subjectId: string;
  sourceType: VaultKnowledgeSourceType;
  sourceId: string;
  kind: VaultKnowledgeKind;
  title: string;
  body: string;
  confidence: number | null;
  durability: number | null;
  tags: string[];
  evidence: VaultKnowledgeEvidence[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VaultKnowledgeDraft {
  scope: VaultKnowledgeScope;
  subjectId: string;
  sourceType: VaultKnowledgeSourceType;
  sourceId: string;
  kind: VaultKnowledgeKind;
  title: string;
  body: string;
  confidence?: number | null;
  durability?: number | null;
  tags?: string[];
  evidence?: VaultKnowledgeEvidence[];
  metadata?: Record<string, unknown>;
}

export interface VaultKnowledgeNote {
  id: string;
  scope: VaultKnowledgeScope;
  subjectId: string;
  content: string;
  changeSummary: string | null;
  sourceType: VaultKnowledgeSourceType;
  sourceId: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultKnowledgeNoteInput {
  scope: VaultKnowledgeScope;
  subjectId: string;
  content: string;
  changeSummary?: string | null;
  sourceType: VaultKnowledgeSourceType;
  sourceId: string;
  metadata?: Record<string, unknown>;
}

interface RegistryRepoEntry {
  id: string;
  slug: string;
  name: string;
  path: string | null;
  git_url: string | null;
}

interface RegistryProjectEntry {
  id: string;
  slug: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  repos: RegistryRepoEntry[];
}

interface RegistryAgentEntry {
  id: string;
  slug: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

interface VaultRegistry {
  version: 1;
  updatedAt: string;
  projects: RegistryProjectEntry[];
  agents: RegistryAgentEntry[];
}

interface ManifestRepoEntry extends ProjectRepo {
  slug: string;
}

interface ProjectManifest {
  version: 1;
  updatedAt: string;
  project: Project;
  repos: ManifestRepoEntry[];
  agents: ProjectAgent[];
  threads: ProjectThread[];
}

interface MarkdownFile<TFrontmatter extends object> {
  frontmatter: TFrontmatter;
  body: string;
}

interface ProjectContextFrontmatter {
  id: string;
  type: "knowledge-note";
  scope: "project";
  subject_id: string;
  project_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_type?: VaultKnowledgeSourceType;
  source_id?: string;
  change_summary?: string | null;
  version?: number;
  metadata?: Record<string, unknown>;
}

interface RepoKnowledgeFrontmatter {
  id: string;
  type: "knowledge-note";
  scope: "repo";
  subject_id: string;
  project_id: string;
  repo_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_type?: VaultKnowledgeSourceType;
  source_id?: string;
  change_summary?: string | null;
  version?: number;
  metadata?: Record<string, unknown>;
}

interface AgentKnowledgeFrontmatter {
  id: string;
  type: "knowledge-note";
  scope: "agent";
  subject_id: string;
  agent_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_type?: VaultKnowledgeSourceType;
  source_id?: string;
  change_summary?: string | null;
  version?: number;
  metadata?: Record<string, unknown>;
}

interface GlobalPlaybookFrontmatter {
  id: string;
  type: "knowledge-note";
  scope: "global";
  subject_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_type?: VaultKnowledgeSourceType;
  source_id?: string;
  change_summary?: string | null;
  version?: number;
  metadata?: Record<string, unknown>;
}

interface ProjectAgentsIndexFrontmatter {
  id: string;
  type: "project-agents";
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  agents: ProjectAgent[];
}

interface ProjectSkillFrontmatter {
  id: string;
  type: "project-skill";
  project_id: string;
  title: string;
  file: string;
  condition?: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectVariableFrontmatter {
  id: string;
  type: "project-variable";
  project_id: string;
  title: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

interface ProjectThreadFrontmatter {
  id: string;
  type: "project-thread";
  project_id: string;
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ImportedArtifactFrontmatter {
  id: string;
  type: "imported-artifact";
  source_table: string;
  source_row_id?: string;
  scope?: string;
  project_id?: string;
  repo_id?: string;
  agent_id?: string;
  producer?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface EvidenceFrontmatter {
  id: string;
  type: "knowledge-evidence";
  scope: VaultKnowledgeScope;
  subject_id: string;
  source_type: VaultKnowledgeSourceType;
  source_id: string;
  kind: VaultKnowledgeKind;
  title: string;
  confidence?: number | null;
  durability?: number | null;
  tags?: string[];
  evidence?: VaultKnowledgeEvidence[];
  metadata?: Record<string, unknown>;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_VAULT_ROOT = process.env.AGX_VAULT_ROOT || path.join(process.env.AGX_DATA_DIR || path.join(os.homedir(), ".agx"), "vault");

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string, fallback = "item"): string {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function clampUnit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirIfExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function atomicWriteText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMarkdownBody(content: string): string {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

function writeMarkdownFile(filePath: string, frontmatter: Record<string, unknown>, body: string): void {
  const yaml = dump(frontmatter, { lineWidth: 120, noRefs: true, sortKeys: true }).trimEnd();
  const normalizedBody = normalizeMarkdownBody(body);
  const content = normalizedBody
    ? `---\n${yaml}\n---\n${normalizedBody}\n`
    : `---\n${yaml}\n---\n`;
  atomicWriteText(filePath, content);
}

function readMarkdownFile<TFrontmatter extends object>(filePath: string): MarkdownFile<TFrontmatter> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: {} as TFrontmatter,
      body: normalizeMarkdownBody(raw),
    };
  }
  const parsed = load(match[1]);
  return {
    frontmatter: (isPlainObject(parsed) ? parsed : {}) as TFrontmatter,
    body: normalizeMarkdownBody(match[2] ?? ""),
  };
}

function listMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeTags(tags?: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags ?? []) {
    const trimmed = String(tag ?? "").trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeEvidence(evidence?: VaultKnowledgeEvidence[]): VaultKnowledgeEvidence[] {
  const result: VaultKnowledgeEvidence[] = [];
  for (const item of evidence ?? []) {
    const note = String(item?.note ?? "").trim();
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!note) continue;
    result.push(id ? { id, note } : { note });
  }
  return result;
}

function contentHash(scope: VaultKnowledgeScope, subjectId: string, body: string): string {
  return createHash("sha256").update(`${scope}\n${subjectId}\n${body}`).digest("hex");
}

function sortByTimestampDesc<T extends { updatedAt?: string; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aKey = a.updatedAt || a.createdAt || "";
    const bKey = b.updatedAt || b.createdAt || "";
    return bKey.localeCompare(aKey);
  });
}

export class VaultStore {
  readonly rootDir: string;

  constructor(rootDir = DEFAULT_VAULT_ROOT) {
    this.rootDir = rootDir;
  }

  getRootDir(): string {
    this.ensureRoot();
    return this.rootDir;
  }

  private registryPath(): string {
    return path.join(this.rootDir, ".agx", "registry.json");
  }

  private globalDir(): string {
    return path.join(this.rootDir, "_global");
  }

  private globalAgentsDir(): string {
    return path.join(this.globalDir(), "Agents");
  }

  private globalImportedLearningsDir(): string {
    return path.join(this.globalDir(), "_generated", "imported", "learnings");
  }

  private globalEvidenceDir(scope: "agent" | "global"): string {
    return path.join(this.globalDir(), "_generated", "evidence", scope);
  }

  private globalPlaybookPath(): string {
    return path.join(this.globalDir(), "Playbook.md");
  }

  private projectDir(slug: string): string {
    return path.join(this.rootDir, slug);
  }

  private projectManifestPath(slug: string): string {
    return path.join(this.projectDir(slug), ".agx", "manifest.json");
  }

  private projectContextPath(slug: string): string {
    return path.join(this.projectDir(slug), "Context", "Project.md");
  }

  private projectSkillsDir(slug: string): string {
    return path.join(this.projectDir(slug), "Context", "Skills");
  }

  private projectVariablesDir(slug: string): string {
    return path.join(this.projectDir(slug), "Context", "Variables");
  }

  private projectAgentsIndexPath(slug: string): string {
    return path.join(this.projectDir(slug), "Context", "Agents", "_index.md");
  }

  private projectThreadsDir(slug: string): string {
    return path.join(this.projectDir(slug), "Threads");
  }

  private repoDir(projectSlug: string, repoSlug: string): string {
    return path.join(this.projectDir(projectSlug), "Repos", repoSlug);
  }

  private repoKnowledgePath(projectSlug: string, repoSlug: string): string {
    return path.join(this.repoDir(projectSlug, repoSlug), "Knowledge.md");
  }

  private projectImportedDir(projectSlug: string, kind: string): string {
    return path.join(this.projectDir(projectSlug), "_generated", "imported", kind);
  }

  private projectEvidenceDir(projectSlug: string, scope: "project" | "repo" | "agent"): string {
    return path.join(this.projectDir(projectSlug), "_generated", "evidence", scope);
  }

  private ensureRoot(): void {
    ensureDir(path.join(this.rootDir, ".agx"));
    ensureDir(this.globalDir());
    ensureDir(this.globalAgentsDir());
    ensureDir(this.globalImportedLearningsDir());
    ensureDir(this.globalEvidenceDir("agent"));
    ensureDir(this.globalEvidenceDir("global"));
    if (!fs.existsSync(this.registryPath())) {
      this.writeRegistry({ version: 1, updatedAt: nowIso(), projects: [], agents: [] });
    }
    if (!fs.existsSync(path.join(this.globalDir(), "_Index.md"))) {
      atomicWriteText(
        path.join(this.globalDir(), "_Index.md"),
        "# Global Knowledge\n\n- [[Playbook]]\n- [[Agents]]\n",
      );
    }
    if (!fs.existsSync(this.globalPlaybookPath())) {
      writeMarkdownFile(
        this.globalPlaybookPath(),
        {
          id: "global-playbook",
          type: "knowledge-note",
          scope: "global",
          subject_id: "playbook",
          slug: "playbook",
          title: "Playbook",
          created_at: nowIso(),
          updated_at: nowIso(),
          version: 1,
        } satisfies GlobalPlaybookFrontmatter,
        "",
      );
    }
  }

  private readRegistry(): VaultRegistry {
    this.ensureRoot();
    const fallback: VaultRegistry = { version: 1, updatedAt: nowIso(), projects: [], agents: [] };
    const registry = readJsonFile<VaultRegistry>(this.registryPath(), fallback);
    if (!Array.isArray(registry.projects)) registry.projects = [];
    if (!Array.isArray(registry.agents)) registry.agents = [];
    registry.version = 1;
    return registry;
  }

  private writeRegistry(registry: VaultRegistry): void {
    ensureDir(path.join(this.rootDir, ".agx"));
    atomicWriteJson(this.registryPath(), {
      version: 1,
      updatedAt: nowIso(),
      projects: [...registry.projects].sort((a, b) => a.slug.localeCompare(b.slug)),
      agents: [...registry.agents].sort((a, b) => a.slug.localeCompare(b.slug)),
    });
  }

  private readManifest(projectSlug: string): ProjectManifest | null {
    return readJsonFile<ProjectManifest | null>(this.projectManifestPath(projectSlug), null);
  }

  private writeManifest(projectSlug: string, manifest: ProjectManifest): void {
    atomicWriteJson(this.projectManifestPath(projectSlug), {
      ...manifest,
      version: 1,
      updatedAt: nowIso(),
      repos: [...manifest.repos].sort((a, b) => a.slug.localeCompare(b.slug)),
      agents: [...manifest.agents].sort((a, b) => a.routing_order - b.routing_order),
      threads: [...manifest.threads].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    });
  }

  private findProjectRegistryEntry(projectIdOrSlug: string): RegistryProjectEntry | null {
    const normalized = projectIdOrSlug.trim();
    if (!normalized) return null;
    const registry = this.readRegistry();
    return registry.projects.find((project) => project.id === normalized || project.slug === normalized) ?? null;
  }

  private findProjectRegistryEntryById(projectId: string): RegistryProjectEntry | null {
    const normalized = projectId.trim();
    if (!normalized) return null;
    const registry = this.readRegistry();
    return registry.projects.find((project) => project.id === normalized) ?? null;
  }

  private findRepoEntry(repoId: string): { project: RegistryProjectEntry; repo: RegistryRepoEntry } | null {
    const normalized = repoId.trim();
    if (!normalized) return null;
    const registry = this.readRegistry();
    for (const project of registry.projects) {
      const repo = project.repos.find((entry) => entry.id === normalized);
      if (repo) return { project, repo };
    }
    return null;
  }

  private findAgentEntry(agentId: string): RegistryAgentEntry | null {
    const normalized = agentId.trim();
    if (!normalized) return null;
    const registry = this.readRegistry();
    return registry.agents.find((agent) => agent.id === normalized || agent.slug === normalized) ?? null;
  }

  private nextProjectSlug(base: string, excludeProjectId?: string): string {
    const registry = this.readRegistry();
    const baseSlug = slugify(base, "project");
    let candidate = baseSlug;
    let index = 1;
    while (
      registry.projects.some((project) => project.slug === candidate && project.id !== excludeProjectId)
    ) {
      index += 1;
      candidate = `${baseSlug}-${index}`;
    }
    return candidate;
  }

  private nextRepoSlug(projectSlug: string, base: string, excludeRepoId?: string): string {
    const manifest = this.readManifest(projectSlug);
    const baseSlug = slugify(base, "repo");
    let candidate = baseSlug;
    let index = 1;
    while (
      manifest?.repos.some((repo) => repo.slug === candidate && repo.id !== excludeRepoId)
    ) {
      index += 1;
      candidate = `${baseSlug}-${index}`;
    }
    return candidate;
  }

  private ensureProjectScaffold(project: Project, repos: Array<ManifestRepoEntry>): void {
    const projectRoot = this.projectDir(project.slug);
    ensureDir(projectRoot);
    ensureDir(path.join(projectRoot, ".agx"));
    ensureDir(path.join(projectRoot, "Context"));
    ensureDir(this.projectSkillsDir(project.slug));
    ensureDir(this.projectVariablesDir(project.slug));
    ensureDir(path.dirname(this.projectAgentsIndexPath(project.slug)));
    ensureDir(this.projectThreadsDir(project.slug));
    ensureDir(path.join(projectRoot, "Repos"));
    ensureDir(this.projectImportedDir(project.slug, "project-memory"));
    ensureDir(this.projectImportedDir(project.slug, "learnings"));
    ensureDir(this.projectEvidenceDir(project.slug, "project"));
    ensureDir(this.projectEvidenceDir(project.slug, "repo"));
    ensureDir(this.projectEvidenceDir(project.slug, "agent"));

    for (const repo of repos) {
      ensureDir(this.repoDir(project.slug, repo.slug));
      ensureDir(this.projectImportedDir(project.slug, path.join("repo-knowledge", repo.slug)));
      if (!fs.existsSync(path.join(this.repoDir(project.slug, repo.slug), "_index.md"))) {
        atomicWriteText(
          path.join(this.repoDir(project.slug, repo.slug), "_index.md"),
          `# ${repo.name}\n\n- [[Knowledge]]\n`,
        );
      }
      if (!fs.existsSync(this.repoKnowledgePath(project.slug, repo.slug))) {
        writeMarkdownFile(
          this.repoKnowledgePath(project.slug, repo.slug),
          {
            id: repo.id,
            type: "knowledge-note",
            scope: "repo",
            subject_id: repo.id,
            project_id: project.id,
            repo_id: repo.id,
            slug: repo.slug,
            title: repo.name,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            version: 1,
          } satisfies RepoKnowledgeFrontmatter,
          repo.notes ?? "",
        );
      }
    }

    if (!fs.existsSync(path.join(projectRoot, "_Index.md"))) {
      atomicWriteText(
        path.join(projectRoot, "_Index.md"),
        `# ${project.name}\n\n- [[Overview]]\n- [[Architecture]]\n- [[Active Development]]\n- [[Design Decisions]]\n`,
      );
    }
    if (!fs.existsSync(path.join(projectRoot, "Overview.md"))) {
      atomicWriteText(path.join(projectRoot, "Overview.md"), `# Overview\n\n${project.description?.trim() || ""}\n`);
    }
    if (!fs.existsSync(path.join(projectRoot, "Architecture.md"))) {
      atomicWriteText(path.join(projectRoot, "Architecture.md"), "# Architecture\n");
    }
    if (!fs.existsSync(path.join(projectRoot, "Active Development.md"))) {
      atomicWriteText(path.join(projectRoot, "Active Development.md"), "# Active Development\n");
    }
    if (!fs.existsSync(path.join(projectRoot, "Design Decisions.md"))) {
      atomicWriteText(path.join(projectRoot, "Design Decisions.md"), "# Design Decisions\n");
    }
    if (!fs.existsSync(this.projectContextPath(project.slug))) {
      writeMarkdownFile(
        this.projectContextPath(project.slug),
        {
          id: project.id,
          type: "knowledge-note",
          scope: "project",
          subject_id: project.id,
          project_id: project.id,
          slug: project.slug,
          title: project.name,
          created_at: project.created_at,
          updated_at: project.updated_at,
          version: 1,
        } satisfies ProjectContextFrontmatter,
        project.description?.trim() || "",
      );
    }
    if (!fs.existsSync(this.projectAgentsIndexPath(project.slug))) {
      writeMarkdownFile(
        this.projectAgentsIndexPath(project.slug),
        {
          id: `project-agents:${project.id}`,
          type: "project-agents",
          project_id: project.id,
          title: `${project.name} Agents`,
          created_at: project.created_at,
          updated_at: project.updated_at,
          agents: [],
        } satisfies ProjectAgentsIndexFrontmatter,
        "# Project Agents\n",
      );
    }
  }

  private toRegistryRepos(repos: ManifestRepoEntry[]): RegistryRepoEntry[] {
    return repos.map((repo) => ({
      id: repo.id,
      slug: repo.slug,
      name: repo.name,
      path: repo.path ?? null,
      git_url: repo.git_url ?? null,
    }));
  }

  private updateProjectRegistryEntry(project: Project, repos: ManifestRepoEntry[]): void {
    const registry = this.readRegistry();
    const nextEntry: RegistryProjectEntry = {
      id: project.id,
      slug: project.slug,
      name: project.name,
      path: this.projectDir(project.slug),
      created_at: project.created_at,
      updated_at: project.updated_at,
      repos: this.toRegistryRepos(repos),
    };
    const nextProjects = registry.projects.filter((entry) => entry.id !== project.id);
    nextProjects.push(nextEntry);
    this.writeRegistry({ ...registry, projects: nextProjects });
  }

  private removeProjectRegistryEntry(projectId: string): void {
    const registry = this.readRegistry();
    this.writeRegistry({ ...registry, projects: registry.projects.filter((project) => project.id !== projectId) });
  }

  private ensureAgentRegistryEntry(agentId: string, name?: string): RegistryAgentEntry {
    const registry = this.readRegistry();
    const existing = registry.agents.find((agent) => agent.id === agentId);
    if (existing) return existing;
    const slug = slugify(name || agentId, "agent");
    const createdAt = nowIso();
    const entry: RegistryAgentEntry = {
      id: agentId,
      slug,
      name: name || agentId,
      path: path.join(this.globalAgentsDir(), `${slug}.md`),
      created_at: createdAt,
      updated_at: createdAt,
    };
    this.writeRegistry({ ...registry, agents: [...registry.agents, entry] });
    return entry;
  }

  private updateAgentRegistryEntry(agentId: string, name: string): RegistryAgentEntry {
    const registry = this.readRegistry();
    const existing = registry.agents.find((agent) => agent.id === agentId);
    if (!existing) return this.ensureAgentRegistryEntry(agentId, name);
    const nextEntry: RegistryAgentEntry = {
      ...existing,
      name,
      updated_at: nowIso(),
    };
    this.writeRegistry({
      ...registry,
      agents: [...registry.agents.filter((agent) => agent.id !== agentId), nextEntry],
    });
    return nextEntry;
  }

  listProjects(userId?: string, includeArchived = false): ProjectWithRepos[] {
    const registry = this.readRegistry();
    return registry.projects
      .filter((entry) => includeArchived || !entry.archived_at)
      .map((entry) => this.getProjectWithRepos(entry.id, userId))
      .filter((project): project is ProjectWithRepos => Boolean(project));
  }

  getProjectBySlug(slug: string, userId?: string): Project | null {
    const project = this.getProjectWithRepos(slug, userId);
    return project ? { ...project, repos: undefined } as Project : null;
  }

  getProjectRepos(projectId: string): ProjectRepo[] {
    const project = this.getProjectWithRepos(projectId);
    return project?.repos ?? [];
  }

  getProjectWithRepos(projectIdOrSlug: string, userId?: string): ProjectWithRepos | null {
    const entry = this.findProjectRegistryEntry(projectIdOrSlug);
    if (!entry) return null;
    const manifest = this.readManifest(entry.slug);
    if (!manifest) return null;
    if (userId && manifest.project.user_id && manifest.project.user_id !== userId) {
      return null;
    }
    const repos = manifest.repos.map((repo) => ({
      id: repo.id,
      project_id: repo.project_id,
      name: repo.name,
      path: repo.path ?? "",
      git_url: repo.git_url ?? undefined,
      notes: this.getKnowledgeNote("repo", repo.id)?.content || "",
      created_at: repo.created_at,
      updated_at: repo.updated_at,
    }));
    return {
      ...manifest.project,
      archived_at: entry.archived_at ?? null,
      repos,
    };
  }

  createProject(userId: string, input: ProjectInput): ProjectWithRepos {
    const timestamp = nowIso();
    const slug = this.nextProjectSlug(input.name || "project");
    const project: Project = {
      id: randomUUID(),
      user_id: userId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || "",
      metadata: {},
      workflow_id: input.workflow_id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const repos: ManifestRepoEntry[] = (input.repos ?? []).map((repo) => {
      const repoSlug = this.nextRepoSlug(project.slug, repo.name || repo.path || "repo");
      const repoId = repo.id?.trim() || randomUUID();
      return {
        id: repoId,
        project_id: project.id,
        name: repo.name.trim(),
        path: repo.path ?? "",
        git_url: repo.git_url ?? undefined,
        notes: repo.notes ?? "",
        created_at: timestamp,
        updated_at: timestamp,
        slug: repoSlug,
      };
    });
    this.ensureProjectScaffold(project, repos);
    this.writeManifest(project.slug, {
      version: 1,
      updatedAt: timestamp,
      project,
      repos,
      agents: [],
      threads: [],
    });
    this.updateProjectRegistryEntry(project, repos);
    for (const repo of repos) {
      if (repo.notes?.trim()) {
        this.upsertKnowledgeNote({
          scope: "repo",
          subjectId: repo.id,
          content: repo.notes,
          changeSummary: "Initial repo note",
          sourceType: "manual",
          sourceId: "project-create",
          metadata: { project_id: project.id },
        });
      }
    }
    return this.getProjectWithRepos(project.id, userId)!;
  }

  updateProject(projectIdOrSlug: string, userId: string, updates: ProjectUpdatePayload): ProjectWithRepos | null {
    const current = this.getProjectWithRepos(projectIdOrSlug, userId);
    if (!current) return null;
    const currentManifest = this.readManifest(current.slug);
    if (!currentManifest) return null;

    const nextSlug = updates.slug?.trim()
      ? this.nextProjectSlug(updates.slug.trim(), current.id)
      : current.slug;
    const nextUpdatedAt = nowIso();
    const nextProject: Project = {
      ...currentManifest.project,
      name: typeof updates.name === "string" && updates.name.trim() ? updates.name.trim() : currentManifest.project.name,
      slug: nextSlug,
      description: updates.description !== undefined ? (updates.description ?? "") : (currentManifest.project.description ?? ""),
      metadata: updates.metadata !== undefined ? (updates.metadata ?? {}) : (currentManifest.project.metadata ?? {}),
      ci_cd_info: updates.ci_cd_info !== undefined ? (updates.ci_cd_info ?? undefined) : currentManifest.project.ci_cd_info,
      workflow_id: updates.workflow_id !== undefined ? (updates.workflow_id ?? null) : currentManifest.project.workflow_id,
      updated_at: nextUpdatedAt,
    };

    let manifestRepos = currentManifest.repos;
    if (updates.repos) {
      const updatedRepos: ManifestRepoEntry[] = [];
      const byId = new Map(currentManifest.repos.map((repo) => [repo.id, repo]));
      for (const inputRepo of updates.repos) {
        const existing = inputRepo.id ? byId.get(inputRepo.id) : undefined;
        const repoId = existing?.id || inputRepo.id?.trim() || randomUUID();
        const repoSlug = existing?.slug || this.nextRepoSlug(nextProject.slug, inputRepo.name || inputRepo.path || "repo", repoId);
        updatedRepos.push({
          id: repoId,
          project_id: current.id,
          name: inputRepo.name.trim(),
          path: inputRepo.path ?? "",
          git_url: inputRepo.git_url ?? undefined,
          notes: inputRepo.notes ?? "",
          created_at: existing?.created_at || nextUpdatedAt,
          updated_at: nextUpdatedAt,
          slug: repoSlug,
        });
      }

      for (const repo of currentManifest.repos) {
        if (updatedRepos.some((candidate) => candidate.id === repo.id)) continue;
        removeDirIfExists(this.repoDir(current.slug, repo.slug));
      }
      manifestRepos = updatedRepos;
    }

    if (nextSlug !== current.slug) {
      removeDirIfExists(this.projectDir(nextSlug));
      fs.renameSync(this.projectDir(current.slug), this.projectDir(nextSlug));
    }
    this.ensureProjectScaffold(nextProject, manifestRepos);

    this.writeManifest(nextProject.slug, {
      version: 1,
      updatedAt: nextUpdatedAt,
      project: nextProject,
      repos: manifestRepos,
      agents: currentManifest.agents,
      threads: currentManifest.threads,
    });
    this.updateProjectRegistryEntry(nextProject, manifestRepos);
    for (const repo of manifestRepos) {
      const noteContent = updates.repos?.find((item) => (item.id || repo.id) === repo.id)?.notes;
      if (typeof noteContent === "string") {
        this.upsertKnowledgeNote({
          scope: "repo",
          subjectId: repo.id,
          content: noteContent,
          changeSummary: "Repo note updated",
          sourceType: "manual",
          sourceId: "project-update",
          metadata: { project_id: nextProject.id },
        });
      }
    }
    return this.getProjectWithRepos(nextProject.id, userId);
  }

  deleteProject(projectId: string, userId?: string): void {
    const entry = this.findProjectRegistryEntryById(projectId);
    if (!entry) return;
    const registry = this.readRegistry();
    const nextProjects = registry.projects.map((p) =>
      p.id === projectId ? { ...p, archived_at: nowIso(), updated_at: nowIso() } : p,
    );
    this.writeRegistry({ ...registry, projects: nextProjects });
  }

  getProjectAgents(projectId: string): ProjectAgent[] {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return [];
    const indexFile = readMarkdownFile<ProjectAgentsIndexFrontmatter>(this.projectAgentsIndexPath(project.slug));
    const agents = Array.isArray(indexFile?.frontmatter?.agents) ? indexFile!.frontmatter.agents : [];
    return [...agents].sort((a, b) => a.routing_order - b.routing_order);
  }

  addProjectAgent(projectId: string, agentId: string, routingOrder?: number): ProjectAgent {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const current = this.getProjectAgents(projectId).filter((entry) => entry.agent_id !== agentId);
    const nextOrder = routingOrder ?? current.length;
    const timestamp = nowIso();
    current.push({
      project_id: projectId,
      agent_id: agentId,
      routing_order: nextOrder,
      created_at: timestamp,
    });
    const normalized = current
      .sort((a, b) => a.routing_order - b.routing_order)
      .map((entry, index) => ({ ...entry, routing_order: index }));
    this.writeProjectAgents(project.slug, projectId, normalized);
    return normalized.find((entry) => entry.agent_id === agentId)!;
  }

  removeProjectAgent(projectId: string, agentId: string): void {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return;
    const remaining = this.getProjectAgents(projectId)
      .filter((entry) => entry.agent_id !== agentId)
      .map((entry, index) => ({ ...entry, routing_order: index }));
    this.writeProjectAgents(project.slug, projectId, remaining);
  }

  reorderProjectAgents(projectId: string, orderedAgentIds: string[]): ProjectAgent[] {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return [];
    const current = this.getProjectAgents(projectId);
    const byId = new Map(current.map((entry) => [entry.agent_id, entry]));
    const next = orderedAgentIds
      .map((agentId, index) => {
        const entry = byId.get(agentId);
        if (!entry) return null;
        return { ...entry, routing_order: index };
      })
      .filter((entry): entry is ProjectAgent => Boolean(entry));
    this.writeProjectAgents(project.slug, projectId, next);
    return next;
  }

  private writeProjectAgents(projectSlug: string, projectId: string, agents: ProjectAgent[]): void {
    const indexPath = this.projectAgentsIndexPath(projectSlug);
    const existing = readMarkdownFile<ProjectAgentsIndexFrontmatter>(indexPath);
    const createdAt = existing?.frontmatter?.created_at || nowIso();
    writeMarkdownFile(
      indexPath,
      {
        id: existing?.frontmatter?.id || `project-agents:${projectId}`,
        type: "project-agents",
        project_id: projectId,
        title: "Project Agents",
        created_at: createdAt,
        updated_at: nowIso(),
        agents,
      } satisfies ProjectAgentsIndexFrontmatter,
      "# Project Agents\n",
    );
    const manifest = this.readManifest(projectSlug);
    if (manifest) {
      this.writeManifest(projectSlug, { ...manifest, agents });
    }
  }

  getProjectSkills(projectId: string): ProjectSkill[] {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return [];
    const skills: Array<ProjectSkill & { updatedAt: string; createdAt: string }> = [];
    for (const filePath of listMarkdownFiles(this.projectSkillsDir(project.slug))) {
      const markdown = readMarkdownFile<ProjectSkillFrontmatter>(filePath);
      if (!markdown) continue;
      const id = String(markdown.frontmatter.id || "").trim();
      const file = String(markdown.frontmatter.file || "").trim();
      const createdAt = String(markdown.frontmatter.created_at || "");
      if (!id || !file) continue;
      skills.push({
        id,
        project_id: String(markdown.frontmatter.project_id || projectId),
        file,
        condition: typeof markdown.frontmatter.condition === "string" ? markdown.frontmatter.condition : undefined,
        created_at: createdAt,
        updatedAt: createdAt,
        createdAt,
      });
    }
    return sortByTimestampDesc(skills).map(({ updatedAt: _updatedAt, createdAt: _createdAt, ...entry }) => entry);
  }

  addProjectSkill(projectId: string, file: string, condition?: string): ProjectSkill {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) throw new Error("Project not found");
    const timestamp = nowIso();
    const id = randomUUID();
    const fileSlug = slugify(path.basename(file) || id, "skill");
    writeMarkdownFile(
      path.join(this.projectSkillsDir(project.slug), `${fileSlug}-${id.slice(0, 8)}.md`),
      {
        id,
        type: "project-skill",
        project_id: projectId,
        title: path.basename(file) || file,
        file,
        condition: condition ?? null,
        created_at: timestamp,
        updated_at: timestamp,
      } satisfies ProjectSkillFrontmatter,
      `# ${path.basename(file) || file}\n`,
    );
    return {
      id,
      project_id: projectId,
      file,
      condition,
      created_at: timestamp,
    };
  }

  removeProjectSkill(skillId: string): void {
    const registry = this.readRegistry();
    for (const project of registry.projects) {
      for (const filePath of listMarkdownFiles(this.projectSkillsDir(project.slug))) {
        const markdown = readMarkdownFile<ProjectSkillFrontmatter>(filePath);
        if (markdown?.frontmatter?.id === skillId) {
          fs.unlinkSync(filePath);
          return;
        }
      }
    }
  }

  getProjectVariables(projectId: string): ProjectVariable[] {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return [];
    return listMarkdownFiles(this.projectVariablesDir(project.slug))
      .map((filePath) => {
        const markdown = readMarkdownFile<ProjectVariableFrontmatter>(filePath);
        if (!markdown) return null;
        return {
          project_id: String(markdown.frontmatter.project_id || projectId),
          key: String(markdown.frontmatter.key || ""),
          value: String(markdown.frontmatter.value || ""),
        } satisfies ProjectVariable;
      })
      .filter((entry): entry is ProjectVariable => Boolean(entry?.key));
  }

  setProjectVariable(projectId: string, key: string, value: string): ProjectVariable {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) throw new Error("Project not found");
    const existingPath = path.join(this.projectVariablesDir(project.slug), `${slugify(key, "var")}.md`);
    const existing = readMarkdownFile<ProjectVariableFrontmatter>(existingPath);
    const timestamp = nowIso();
    writeMarkdownFile(
      existingPath,
      {
        id: existing?.frontmatter?.id || `project-variable:${projectId}:${key}`,
        type: "project-variable",
        project_id: projectId,
        title: key,
        key,
        value,
        created_at: existing?.frontmatter?.created_at || timestamp,
        updated_at: timestamp,
      } satisfies ProjectVariableFrontmatter,
      "",
    );
    return { project_id: projectId, key, value };
  }

  deleteProjectVariable(projectId: string, key: string): void {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return;
    const filePath = path.join(this.projectVariablesDir(project.slug), `${slugify(key, "var")}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  getProjectMemory(projectId: string): ProjectMemory[] {
    const note = this.getKnowledgeNote("project", projectId);
    if (!note?.content.trim()) return [];
    return [{
      id: note.id,
      project_id: projectId,
      content: note.content,
      source: note.sourceType || "vault",
      producer: "human",
      created_at: note.updatedAt,
    }];
  }

  addProjectMemory(projectId: string, content: string, source?: string, producer: "human" | "system" = "human"): ProjectMemory {
    const existing = this.getKnowledgeNote("project", projectId)?.content ?? "";
    const nextContent = existing.trim() ? `${existing.trim()}\n\n- ${content.trim().replace(/^\-\s*/, "")}` : content.trim();
    const { note } = this.upsertKnowledgeNote({
      scope: "project",
      subjectId: projectId,
      content: nextContent,
      changeSummary: source || "Project memory updated",
      sourceType: producer === "system" ? "task_completion" : "manual",
      sourceId: source || "manual-project-memory",
      metadata: { producer },
    });
    return {
      id: note.id,
      project_id: projectId,
      content: note.content,
      source: note.changeSummary || undefined,
      producer,
      created_at: note.updatedAt,
    };
  }

  deleteProjectMemory(projectId: string): void {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return;
    const notePath = this.projectContextPath(project.slug);
    const markdown = readMarkdownFile<ProjectContextFrontmatter>(notePath);
    if (!markdown) return;
    writeMarkdownFile(notePath, { ...markdown.frontmatter, updated_at: nowIso() }, "");
  }

  getProjectThreads(projectId: string): ProjectThread[] {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return [];
    const manifest = this.readManifest(project.slug);
    return manifest?.threads ?? [];
  }

  addProjectThread(projectId: string, threadId: string): ProjectThread {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) throw new Error("Project not found");
    const manifest = this.readManifest(project.slug);
    if (!manifest) throw new Error("Project manifest missing");
    const existing = manifest.threads.find((thread) => thread.thread_id === threadId);
    if (existing) return existing;
    const timestamp = nowIso();
    const thread: ProjectThread = {
      project_id: projectId,
      thread_id: threadId,
      created_at: timestamp,
    };
    writeMarkdownFile(
      path.join(this.projectThreadsDir(project.slug), `${encodeURIComponent(threadId)}.md`),
      {
        id: `project-thread:${projectId}:${threadId}`,
        type: "project-thread",
        project_id: projectId,
        thread_id: threadId,
        title: threadId,
        created_at: timestamp,
        updated_at: timestamp,
      } satisfies ProjectThreadFrontmatter,
      `# Thread ${threadId}\n`,
    );
    this.writeManifest(project.slug, { ...manifest, threads: [...manifest.threads, thread] });
    return thread;
  }

  removeProjectThread(projectId: string, threadId: string): void {
    const project = this.findProjectRegistryEntryById(projectId);
    if (!project) return;
    const manifest = this.readManifest(project.slug);
    if (!manifest) return;
    const filePath = path.join(this.projectThreadsDir(project.slug), `${encodeURIComponent(threadId)}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.writeManifest(project.slug, {
      ...manifest,
      threads: manifest.threads.filter((thread) => thread.thread_id !== threadId),
    });
  }

  getProjectForThread(threadId: string): string | null {
    const registry = this.readRegistry();
    for (const project of registry.projects) {
      const manifest = this.readManifest(project.slug);
      if (manifest?.threads.some((thread) => thread.thread_id === threadId)) {
        return manifest.project.id;
      }
    }
    return null;
  }

  getKnowledgeNote(scope: VaultKnowledgeScope, subjectId: string): VaultKnowledgeNote | null {
    const resolved = this.resolveKnowledgeNotePath(scope, subjectId);
    if (!resolved) return null;
    const markdown = readMarkdownFile<Record<string, unknown>>(resolved.path);
    if (!markdown) return null;
    const frontmatter = markdown.frontmatter;
    return {
      id: String(frontmatter.id || subjectId),
      scope,
      subjectId,
      content: markdown.body,
      changeSummary: typeof frontmatter.change_summary === "string" ? frontmatter.change_summary : null,
      sourceType: (typeof frontmatter.source_type === "string" ? frontmatter.source_type : "manual") as VaultKnowledgeSourceType,
      sourceId: typeof frontmatter.source_id === "string" ? frontmatter.source_id : "vault",
      metadata: isPlainObject(frontmatter.metadata) ? frontmatter.metadata : {},
      version: typeof frontmatter.version === "number" ? frontmatter.version : 1,
      createdAt: typeof frontmatter.created_at === "string" ? frontmatter.created_at : nowIso(),
      updatedAt: typeof frontmatter.updated_at === "string" ? frontmatter.updated_at : nowIso(),
    };
  }

  upsertKnowledgeNote(input: VaultKnowledgeNoteInput): { note: VaultKnowledgeNote; changed: boolean } {
    const resolved = this.resolveKnowledgeNotePath(input.scope, input.subjectId, { createIfMissing: true });
    if (!resolved) {
      throw new Error(`Cannot resolve knowledge note for ${input.scope}:${input.subjectId}`);
    }
    const existing = this.getKnowledgeNote(input.scope, input.subjectId);
    const normalized = normalizeMarkdownBody(input.content);
    if (existing && normalizeMarkdownBody(existing.content) === normalized) {
      return { note: existing, changed: false };
    }
    const createdAt = existing?.createdAt || nowIso();
    const version = (existing?.version || 0) + 1;
    const frontmatter = {
      ...resolved.frontmatter,
      updated_at: nowIso(),
      created_at: createdAt,
      source_type: input.sourceType,
      source_id: input.sourceId,
      change_summary: input.changeSummary ?? null,
      version,
      metadata: input.metadata ?? {},
    };
    writeMarkdownFile(resolved.path, frontmatter, normalized);
    const note = this.getKnowledgeNote(input.scope, input.subjectId);
    if (!note) throw new Error("Failed to read knowledge note after write");
    return { note, changed: true };
  }

  private resolveKnowledgeNotePath(
    scope: VaultKnowledgeScope,
    subjectId: string,
    options?: { createIfMissing?: boolean },
  ): { path: string; frontmatter: Record<string, unknown> } | null {
    if (scope === "global") {
      const timestamp = nowIso();
      this.ensureRoot();
      return {
        path: this.globalPlaybookPath(),
        frontmatter: {
          id: "global-playbook",
          type: "knowledge-note",
          scope: "global",
          subject_id: subjectId || "playbook",
          slug: "playbook",
          title: "Playbook",
          created_at: timestamp,
          updated_at: timestamp,
        } satisfies GlobalPlaybookFrontmatter,
      };
    }

    if (scope === "project") {
      const project = this.findProjectRegistryEntryById(subjectId);
      if (!project) return null;
      const timestamp = nowIso();
      return {
        path: this.projectContextPath(project.slug),
        frontmatter: {
          id: subjectId,
          type: "knowledge-note",
          scope: "project",
          subject_id: subjectId,
          project_id: subjectId,
          slug: project.slug,
          title: project.name,
          created_at: timestamp,
          updated_at: timestamp,
        } satisfies ProjectContextFrontmatter,
      };
    }

    if (scope === "repo") {
      const located = this.findRepoEntry(subjectId);
      if (!located) return null;
      const timestamp = nowIso();
      return {
        path: this.repoKnowledgePath(located.project.slug, located.repo.slug),
        frontmatter: {
          id: subjectId,
          type: "knowledge-note",
          scope: "repo",
          subject_id: subjectId,
          project_id: located.project.id,
          repo_id: subjectId,
          slug: located.repo.slug,
          title: located.repo.name,
          created_at: timestamp,
          updated_at: timestamp,
        } satisfies RepoKnowledgeFrontmatter,
      };
    }

    const agent = this.findAgentEntry(subjectId) ?? (options?.createIfMissing ? this.ensureAgentRegistryEntry(subjectId, subjectId) : null);
    if (!agent) return null;
    const timestamp = nowIso();
    return {
      path: agent.path,
      frontmatter: {
        id: subjectId,
        type: "knowledge-note",
        scope: "agent",
        subject_id: subjectId,
        agent_id: subjectId,
        slug: agent.slug,
        title: agent.name,
        created_at: timestamp,
        updated_at: timestamp,
      } satisfies AgentKnowledgeFrontmatter,
    };
  }

  listKnowledgeEntries(input: { scope: VaultKnowledgeScope; subjectId: string; limit?: number }): VaultKnowledgeEntry[] {
    const files = this.knowledgeEntryFilesForScope(input.scope, input.subjectId);
    const entries = files
      .map((filePath) => {
        const markdown = readMarkdownFile<EvidenceFrontmatter>(filePath);
        if (!markdown) return null;
        return {
          id: String(markdown.frontmatter.id || ""),
          scope: markdown.frontmatter.scope,
          subjectId: String(markdown.frontmatter.subject_id || input.subjectId),
          sourceType: markdown.frontmatter.source_type,
          sourceId: String(markdown.frontmatter.source_id || ""),
          kind: markdown.frontmatter.kind,
          title: String(markdown.frontmatter.title || ""),
          body: markdown.body,
          confidence: clampUnit(markdown.frontmatter.confidence),
          durability: clampUnit(markdown.frontmatter.durability),
          tags: normalizeTags(markdown.frontmatter.tags),
          evidence: normalizeEvidence(markdown.frontmatter.evidence),
          metadata: isPlainObject(markdown.frontmatter.metadata) ? markdown.frontmatter.metadata : {},
          createdAt: String(markdown.frontmatter.created_at || ""),
          updatedAt: String(markdown.frontmatter.updated_at || ""),
        } satisfies VaultKnowledgeEntry;
      })
      .filter((entry): entry is VaultKnowledgeEntry => Boolean(entry?.id && entry.body));
    return sortByTimestampDesc(entries).slice(0, input.limit ?? 50);
  }

  storeKnowledgeEntries(drafts: VaultKnowledgeDraft[]): number {
    let inserted = 0;
    for (const draft of drafts) {
      const subjectId = draft.subjectId.trim();
      const title = draft.title.trim();
      const body = draft.body.trim();
      const sourceId = draft.sourceId.trim();
      if (!subjectId || !title || !body || !sourceId) continue;
      const hash = contentHash(draft.scope, subjectId, body);
      const existing = this.listKnowledgeEntries({ scope: draft.scope, subjectId, limit: 500 })
        .find((entry) => (entry.metadata?.content_hash as string | undefined) === hash);
      if (existing) continue;
      const filePath = this.nextKnowledgeEntryPath(draft.scope, subjectId, title);
      const timestamp = nowIso();
      writeMarkdownFile(
        filePath,
        {
          id: randomUUID(),
          type: "knowledge-evidence",
          scope: draft.scope,
          subject_id: subjectId,
          source_type: draft.sourceType,
          source_id: sourceId,
          kind: draft.kind,
          title,
          confidence: clampUnit(draft.confidence),
          durability: clampUnit(draft.durability),
          tags: normalizeTags(draft.tags),
          evidence: normalizeEvidence(draft.evidence),
          metadata: {
            ...(draft.metadata ?? {}),
            content_hash: hash,
          },
          content_hash: hash,
          created_at: timestamp,
          updated_at: timestamp,
        } satisfies EvidenceFrontmatter,
        body,
      );
      inserted += 1;
    }
    return inserted;
  }

  private knowledgeEntryFilesForScope(scope: VaultKnowledgeScope, subjectId: string): string[] {
    if (scope === "global") {
      return listMarkdownFiles(this.globalEvidenceDir("global"));
    }
    if (scope === "agent") {
      return listMarkdownFiles(this.globalEvidenceDir("agent")).filter((filePath) => {
        const markdown = readMarkdownFile<EvidenceFrontmatter>(filePath);
        return markdown?.frontmatter?.subject_id === subjectId;
      });
    }
    if (scope === "project") {
      const project = this.findProjectRegistryEntryById(subjectId);
      if (!project) return [];
      return listMarkdownFiles(this.projectEvidenceDir(project.slug, "project"));
    }
    const located = this.findRepoEntry(subjectId);
    if (!located) return [];
    return listMarkdownFiles(this.projectEvidenceDir(located.project.slug, "repo")).filter((filePath) => {
      const markdown = readMarkdownFile<EvidenceFrontmatter>(filePath);
      return markdown?.frontmatter?.subject_id === subjectId;
    });
  }

  private nextKnowledgeEntryPath(scope: VaultKnowledgeScope, subjectId: string, title: string): string {
    const id = randomUUID();
    const fileName = `${slugify(title, "entry")}-${id.slice(0, 8)}.md`;
    if (scope === "global") {
      return path.join(this.globalEvidenceDir("global"), fileName);
    }
    if (scope === "agent") {
      return path.join(this.globalEvidenceDir("agent"), fileName);
    }
    if (scope === "project") {
      const project = this.findProjectRegistryEntryById(subjectId);
      if (!project) throw new Error("Project not found for knowledge entry");
      return path.join(this.projectEvidenceDir(project.slug, "project"), fileName);
    }
    const located = this.findRepoEntry(subjectId);
    if (!located) throw new Error("Repo not found for knowledge entry");
    return path.join(this.projectEvidenceDir(located.project.slug, "repo"), fileName);
  }

  getLearnings(scope: LearningScope, scopeId?: string): Learning[] {
    if (scope === "task") return [];
    if (scope === "global") {
      const note = this.getKnowledgeNote("global", "playbook");
      if (!note?.content.trim()) return [];
      return [{
        id: note.id,
        scope: "global",
        scope_id: undefined,
        content: note.content,
        created_at: note.updatedAt,
      }];
    }
    if (!scopeId) return [];
    const note = this.getKnowledgeNote("project", scopeId);
    if (!note?.content.trim()) return [];
    return [{
      id: note.id,
      scope: "project",
      scope_id: scopeId,
      content: note.content,
      created_at: note.updatedAt,
    }];
  }

  addLearning(scope: LearningScope, content: string, scopeId?: string): Learning {
    if (scope === "task") {
      throw new Error("Task learnings are not handled by VaultStore");
    }
    const targetScope: VaultKnowledgeScope = scope === "global" ? "global" : "project";
    const subjectId = scope === "global" ? "playbook" : String(scopeId || "").trim();
    if (!subjectId) {
      throw new Error("scopeId is required for project learnings");
    }
    const existing = this.getKnowledgeNote(targetScope, subjectId)?.content ?? "";
    const addition = `- ${content.trim().replace(/^\-\s*/, "")}`;
    const nextContent = existing.trim() ? `${existing.trim()}\n${addition}` : addition;
    const { note } = this.upsertKnowledgeNote({
      scope: targetScope,
      subjectId,
      content: nextContent,
      changeSummary: "Learning added",
      sourceType: "manual",
      sourceId: "manual-learning",
      metadata: { scope },
    });
    return {
      id: note.id,
      scope,
      scope_id: scopeId,
      content: note.content,
      created_at: note.updatedAt,
    };
  }

  deleteLearning(id: string, scope: LearningScope, scopeId?: string): void {
    if (scope === "task") return;
    const subjectId = scope === "global" ? "playbook" : String(scopeId || "").trim();
    if (!subjectId) return;
    const note = this.getKnowledgeNote(scope === "global" ? "global" : "project", subjectId);
    if (!note || note.id !== id) return;
    this.upsertKnowledgeNote({
      scope: scope === "global" ? "global" : "project",
      subjectId,
      content: "",
      changeSummary: "Learning cleared",
      sourceType: "manual",
      sourceId: "manual-learning-delete",
      metadata: { scope },
    });
  }

  migrateFromLegacyDb(): {
    projects: number;
    repos: number;
    agents: number;
    importedArtifacts: number;
    evidenceFiles: number;
  } {
    this.ensureRoot();
    const sqlite = getSQLiteDb();
    const now = nowIso();

    const hasTable = (table: string) => {
      const row = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1").get(table);
      return Boolean(row);
    };

    const readAll = <TRow>(table: string) => {
      if (!hasTable(table)) return [] as TRow[];
      return sqlite.prepare(`SELECT * FROM ${table}`).all() as TRow[];
    };

    const projects = readAll<Project>("projects");
    const repos = readAll<ProjectRepo>("project_repos");
    const projectAgents = readAll<ProjectAgent>("project_agents");
    const projectSkills = readAll<ProjectSkill>("project_skills");
    const projectVariables = readAll<ProjectVariable>("project_variables");
    const projectThreads = readAll<ProjectThread>("project_threads");
    const projectMemoryRows = readAll<ProjectMemory>("project_memory");
    const repoKnowledgeRows = hasTable("repo_knowledge")
      ? (sqlite.prepare("SELECT id, repo_id, content, producer, created_at FROM repo_knowledge").all() as Array<{
          id: string;
          repo_id: string;
          content: string;
          producer: "human" | "system";
          created_at: string;
        }>)
      : [];
    const knowledgeNoteRows = hasTable("knowledge_notes")
      ? (sqlite.prepare("SELECT * FROM knowledge_notes").all() as Array<{
          id: string;
          scope: VaultKnowledgeScope;
          subject_id: string;
          content: string;
          change_summary: string | null;
          source_type: VaultKnowledgeSourceType;
          source_id: string;
          metadata: string | null;
          version: number;
          created_at: string;
          updated_at: string;
        }>)
      : [];
    const knowledgeEntries = hasTable("knowledge_entries")
      ? (sqlite.prepare("SELECT * FROM knowledge_entries").all() as Array<{
          id: string;
          scope: VaultKnowledgeScope;
          subject_id: string;
          source_type: VaultKnowledgeSourceType;
          source_id: string;
          kind: VaultKnowledgeKind;
          title: string;
          body: string;
          confidence: number | null;
          durability: number | null;
          tags: string | null;
          evidence: string | null;
          metadata: string | null;
          content_hash?: string | null;
          created_at: string;
          updated_at: string;
        }>)
      : [];
    const learnings = readAll<Learning>("learnings");
    const agents = readAll<{ id: string; name: string; description?: string; created_at?: string; updated_at?: string }>("agents");
    const agentMemoryRows = hasTable("agent_memory")
      ? (sqlite.prepare("SELECT * FROM agent_memory").all() as Array<{
          id: string;
          agent_id: string;
          content: string;
          created_at: string;
        }>)
      : [];

    removeDirIfExists(this.rootDir);
    this.ensureRoot();

    const globalLearnings = learnings.filter((learning) => learning.scope === "global");
    const playbookContent = globalLearnings.map((learning) => `- ${learning.content.trim().replace(/^\-\s*/, "")}`).join("\n");
    this.upsertKnowledgeNote({
      scope: "global",
      subjectId: "playbook",
      content: playbookContent,
      changeSummary: "Imported from legacy learnings",
      sourceType: "task_completion",
      sourceId: "vault-import",
      metadata: { imported_at: now },
    });

    let importedArtifacts = 0;
    let evidenceFiles = 0;

    for (const learning of globalLearnings) {
      writeMarkdownFile(
        path.join(this.globalImportedLearningsDir(), `${slugify(learning.id, "learning")}.md`),
        {
          id: learning.id,
          type: "imported-artifact",
          source_table: "learnings",
          scope: learning.scope,
          created_at: learning.created_at || now,
          updated_at: learning.created_at || now,
          metadata: { scope_id: learning.scope_id, user_id: learning.user_id },
        } satisfies ImportedArtifactFrontmatter,
        learning.content,
      );
      importedArtifacts += 1;
    }

    for (const agent of agents) {
      const noteRow = knowledgeNoteRows.find((row) => row.scope === "agent" && row.subject_id === agent.id);
      const synthesized = noteRow?.content?.trim() || this.synthesizeAgentNote(agent.id, agentMemoryRows, knowledgeEntries);
      const entry = this.updateAgentRegistryEntry(agent.id, agent.name);
      writeMarkdownFile(
        entry.path,
        {
          id: agent.id,
          type: "knowledge-note",
          scope: "agent",
          subject_id: agent.id,
          agent_id: agent.id,
          slug: entry.slug,
          title: agent.name,
          created_at: noteRow?.created_at || agent.created_at || now,
          updated_at: noteRow?.updated_at || agent.updated_at || now,
          source_type: noteRow?.source_type || "task_completion",
          source_id: noteRow?.source_id || "vault-import",
          change_summary: noteRow?.change_summary || "Imported from legacy agent knowledge",
          version: noteRow?.version || 1,
          metadata: noteRow?.metadata ? JSON.parse(noteRow.metadata) : {},
        } satisfies AgentKnowledgeFrontmatter,
        this.composeAgentNoteBody(agent.name, agent.description, synthesized),
      );
    }

    for (const legacyProject of projects) {
      const project: Project = {
        id: legacyProject.id,
        user_id: legacyProject.user_id,
        name: legacyProject.name,
        slug: legacyProject.slug || this.nextProjectSlug(legacyProject.name || legacyProject.id, legacyProject.id),
        description: legacyProject.description ?? "",
        metadata: legacyProject.metadata ?? {},
        ci_cd_info: legacyProject.ci_cd_info ?? undefined,
        workflow_id: legacyProject.workflow_id ?? null,
        created_at: legacyProject.created_at || now,
        updated_at: legacyProject.updated_at || now,
      };
      const projectRepos = repos
        .filter((repo) => repo.project_id === legacyProject.id)
        .map((repo) => ({
          ...repo,
          slug: this.nextRepoSlug(project.slug, repo.name || repo.path || repo.id, repo.id),
        }));
      this.ensureProjectScaffold(project, projectRepos);
      this.writeManifest(project.slug, {
        version: 1,
        updatedAt: now,
        project,
        repos: projectRepos,
        agents: projectAgents.filter((entry) => entry.project_id === project.id).sort((a, b) => a.routing_order - b.routing_order),
        threads: projectThreads.filter((entry) => entry.project_id === project.id),
      });
      this.updateProjectRegistryEntry(project, projectRepos);

      const projectNoteRow = knowledgeNoteRows.find((row) => row.scope === "project" && row.subject_id === project.id);
      const projectNoteContent = projectNoteRow?.content?.trim() || this.synthesizeProjectNote(project.id, projectMemoryRows, knowledgeEntries);
      this.upsertKnowledgeNote({
        scope: "project",
        subjectId: project.id,
        content: projectNoteContent,
        changeSummary: projectNoteRow?.change_summary || "Imported from legacy project knowledge",
        sourceType: projectNoteRow?.source_type || "task_completion",
        sourceId: projectNoteRow?.source_id || "vault-import",
        metadata: projectNoteRow?.metadata ? JSON.parse(projectNoteRow.metadata) : { imported_at: now },
      });

      writeMarkdownFile(
        this.projectContextPath(project.slug),
        {
          id: project.id,
          type: "knowledge-note",
          scope: "project",
          subject_id: project.id,
          project_id: project.id,
          slug: project.slug,
          title: project.name,
          created_at: projectNoteRow?.created_at || project.created_at,
          updated_at: projectNoteRow?.updated_at || project.updated_at,
          source_type: projectNoteRow?.source_type || "task_completion",
          source_id: projectNoteRow?.source_id || "vault-import",
          change_summary: projectNoteRow?.change_summary || "Imported from legacy project knowledge",
          version: projectNoteRow?.version || 1,
          metadata: projectNoteRow?.metadata ? JSON.parse(projectNoteRow.metadata) : {},
        } satisfies ProjectContextFrontmatter,
        projectNoteContent,
      );

      const projectLearningRows = learnings.filter((learning) => learning.scope === "project" && learning.scope_id === project.id);
      for (const learning of projectLearningRows) {
        writeMarkdownFile(
          path.join(this.projectImportedDir(project.slug, "learnings"), `${slugify(learning.id, "learning")}.md`),
          {
            id: learning.id,
            type: "imported-artifact",
            source_table: "learnings",
            scope: learning.scope,
            project_id: project.id,
            created_at: learning.created_at || now,
            updated_at: learning.created_at || now,
            metadata: { scope_id: learning.scope_id, user_id: learning.user_id },
          } satisfies ImportedArtifactFrontmatter,
          learning.content,
        );
        importedArtifacts += 1;
      }

      for (const memoryRow of projectMemoryRows.filter((row) => row.project_id === project.id)) {
        writeMarkdownFile(
          path.join(this.projectImportedDir(project.slug, "project-memory"), `${slugify(memoryRow.id, "memory")}.md`),
          {
            id: memoryRow.id,
            type: "imported-artifact",
            source_table: "project_memory",
            source_row_id: memoryRow.id,
            project_id: project.id,
            producer: memoryRow.producer,
            created_at: memoryRow.created_at || now,
            updated_at: memoryRow.created_at || now,
            metadata: { source: memoryRow.source ?? null },
          } satisfies ImportedArtifactFrontmatter,
          memoryRow.content,
        );
        importedArtifacts += 1;
      }

      for (const repo of projectRepos) {
        const repoNoteRow = knowledgeNoteRows.find((row) => row.scope === "repo" && row.subject_id === repo.id);
        const repoContent = repoNoteRow?.content?.trim() || this.synthesizeRepoNote(repo.id, repoKnowledgeRows, knowledgeEntries);
        writeMarkdownFile(
          this.repoKnowledgePath(project.slug, repo.slug),
          {
            id: repo.id,
            type: "knowledge-note",
            scope: "repo",
            subject_id: repo.id,
            project_id: project.id,
            repo_id: repo.id,
            slug: repo.slug,
            title: repo.name,
            created_at: repoNoteRow?.created_at || repo.created_at,
            updated_at: repoNoteRow?.updated_at || repo.updated_at,
            source_type: repoNoteRow?.source_type || "task_completion",
            source_id: repoNoteRow?.source_id || "vault-import",
            change_summary: repoNoteRow?.change_summary || "Imported from legacy repo knowledge",
            version: repoNoteRow?.version || 1,
            metadata: repoNoteRow?.metadata ? JSON.parse(repoNoteRow.metadata) : {},
          } satisfies RepoKnowledgeFrontmatter,
          repoContent,
        );

        if (repo.notes?.trim()) {
          writeMarkdownFile(
            path.join(this.projectImportedDir(project.slug, path.join("repo-knowledge", repo.slug)), `${slugify(repo.id, "repo-notes")}-project-repos-notes.md`),
            {
              id: `${repo.id}:project_repos.notes`,
              type: "imported-artifact",
              source_table: "project_repos",
              source_row_id: repo.id,
              project_id: project.id,
              repo_id: repo.id,
              created_at: repo.updated_at || repo.created_at || now,
              updated_at: repo.updated_at || repo.created_at || now,
            } satisfies ImportedArtifactFrontmatter,
            repo.notes,
          );
          importedArtifacts += 1;
        }

        for (const row of repoKnowledgeRows.filter((entry) => entry.repo_id === repo.id)) {
          writeMarkdownFile(
            path.join(this.projectImportedDir(project.slug, path.join("repo-knowledge", repo.slug)), `${slugify(row.id, "repo-knowledge")}.md`),
            {
              id: row.id,
              type: "imported-artifact",
              source_table: "repo_knowledge",
              source_row_id: row.id,
              project_id: project.id,
              repo_id: repo.id,
              producer: row.producer,
              created_at: row.created_at || now,
              updated_at: row.created_at || now,
            } satisfies ImportedArtifactFrontmatter,
            row.content,
          );
          importedArtifacts += 1;
        }
      }

      for (const skill of projectSkills.filter((entry) => entry.project_id === project.id)) {
        writeMarkdownFile(
          path.join(this.projectSkillsDir(project.slug), `${slugify(path.basename(skill.file) || skill.id, "skill")}-${skill.id.slice(0, 8)}.md`),
          {
            id: skill.id,
            type: "project-skill",
            project_id: project.id,
            title: path.basename(skill.file) || skill.file,
            file: skill.file,
            condition: skill.condition ?? null,
            created_at: skill.created_at || now,
            updated_at: skill.created_at || now,
          } satisfies ProjectSkillFrontmatter,
          `# ${path.basename(skill.file) || skill.file}\n`,
        );
      }

      for (const variable of projectVariables.filter((entry) => entry.project_id === project.id)) {
        writeMarkdownFile(
          path.join(this.projectVariablesDir(project.slug), `${slugify(variable.key, "var")}.md`),
          {
            id: `project-variable:${project.id}:${variable.key}`,
            type: "project-variable",
            project_id: project.id,
            title: variable.key,
            key: variable.key,
            value: variable.value,
            created_at: now,
            updated_at: now,
          } satisfies ProjectVariableFrontmatter,
          "",
        );
      }

      writeMarkdownFile(
        this.projectAgentsIndexPath(project.slug),
        {
          id: `project-agents:${project.id}`,
          type: "project-agents",
          project_id: project.id,
          title: "Project Agents",
          created_at: project.created_at,
          updated_at: project.updated_at,
          agents: projectAgents.filter((entry) => entry.project_id === project.id).sort((a, b) => a.routing_order - b.routing_order),
        } satisfies ProjectAgentsIndexFrontmatter,
        "# Project Agents\n",
      );

      for (const thread of projectThreads.filter((entry) => entry.project_id === project.id)) {
        writeMarkdownFile(
          path.join(this.projectThreadsDir(project.slug), `${encodeURIComponent(thread.thread_id)}.md`),
          {
            id: `project-thread:${project.id}:${thread.thread_id}`,
            type: "project-thread",
            project_id: project.id,
            thread_id: thread.thread_id,
            title: thread.thread_id,
            created_at: thread.created_at || now,
            updated_at: thread.created_at || now,
          } satisfies ProjectThreadFrontmatter,
          `# Thread ${thread.thread_id}\n`,
        );
      }
    }

    for (const entry of knowledgeEntries) {
      const filePath = this.nextKnowledgeEntryPath(entry.scope, entry.subject_id, entry.title || entry.id);
      writeMarkdownFile(
        filePath,
        {
          id: entry.id,
          type: "knowledge-evidence",
          scope: entry.scope,
          subject_id: entry.subject_id,
          source_type: entry.source_type,
          source_id: entry.source_id,
          kind: entry.kind,
          title: entry.title,
          confidence: entry.confidence,
          durability: entry.durability,
          tags: entry.tags ? JSON.parse(entry.tags) : [],
          evidence: entry.evidence ? JSON.parse(entry.evidence) : [],
          metadata: entry.metadata ? JSON.parse(entry.metadata) : {},
          content_hash: entry.content_hash || contentHash(entry.scope, entry.subject_id, entry.body),
          created_at: entry.created_at || now,
          updated_at: entry.updated_at || entry.created_at || now,
        } satisfies EvidenceFrontmatter,
        entry.body,
      );
      evidenceFiles += 1;
    }

    return {
      projects: projects.length,
      repos: repos.length,
      agents: agents.length,
      importedArtifacts,
      evidenceFiles,
    };
  }

  private composeAgentNoteBody(name: string, identity: string | undefined, portableKnowledge: string): string {
    const sections = [`# ${name}`];
    if (identity?.trim()) {
      sections.push(`## Identity\n${identity.trim()}`);
    }
    if (portableKnowledge.trim()) {
      sections.push(`## Portable Knowledge\n${portableKnowledge.trim()}`);
    }
    return sections.join("\n\n");
  }

  private synthesizeProjectNote(
    projectId: string,
    projectMemoryRows: ProjectMemory[],
    knowledgeEntries: Array<{ scope: VaultKnowledgeScope; subject_id: string; body: string }>,
  ): string {
    const lines = [
      ...projectMemoryRows
        .filter((row) => row.project_id === projectId && row.producer === "system")
        .map((row) => row.content.trim()),
      ...knowledgeEntries
        .filter((row) => row.scope === "project" && row.subject_id === projectId)
        .map((row) => row.body.trim()),
    ].filter(Boolean);
    return Array.from(new Set(lines)).map((line) => `- ${line.replace(/^\-\s*/, "")}`).join("\n");
  }

  private synthesizeRepoNote(
    repoId: string,
    repoKnowledgeRows: Array<{ repo_id: string; content: string; producer: "human" | "system" }>,
    knowledgeEntries: Array<{ scope: VaultKnowledgeScope; subject_id: string; body: string }>,
  ): string {
    const lines = [
      ...repoKnowledgeRows
        .filter((row) => row.repo_id === repoId && row.producer === "system")
        .map((row) => row.content.trim()),
      ...knowledgeEntries
        .filter((row) => row.scope === "repo" && row.subject_id === repoId)
        .map((row) => row.body.trim()),
    ].filter(Boolean);
    return Array.from(new Set(lines)).map((line) => `- ${line.replace(/^\-\s*/, "")}`).join("\n");
  }

  private synthesizeAgentNote(
    agentId: string,
    agentMemoryRows: Array<{ agent_id: string; content: string }>,
    knowledgeEntries: Array<{ scope: VaultKnowledgeScope; subject_id: string; body: string }>,
  ): string {
    const lines = [
      ...agentMemoryRows
        .filter((row) => row.agent_id === agentId)
        .map((row) => row.content.trim()),
      ...knowledgeEntries
        .filter((row) => row.scope === "agent" && row.subject_id === agentId)
        .map((row) => row.body.trim()),
    ].filter(Boolean);
    return Array.from(new Set(lines)).map((line) => `- ${line.replace(/^\-\s*/, "")}`).join("\n");
  }
}

export const vaultStore = new VaultStore();

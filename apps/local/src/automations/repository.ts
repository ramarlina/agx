import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { parseAutomationMarkdown } from "./parser";
import { serializeAutomationDefinition } from "./serializer";
import {
  encodeAutomationFilename,
  getDefaultAutomationsDir,
  getLegacyRepoAutomationsDir,
  initializeAutomationRuntimeState,
  isAutomationDue,
  updateAutomationRuntimeState,
} from "./state";
import type {
  AutomationDefinition,
  AutomationListFilter,
  AutomationRecord,
  AutomationRuntimeState,
  AutomationStatePatch,
  AutomationUpdatePatch,
} from "./types";
import { normalizeAutomationDefinition } from "./validation";

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(value);
}

function removeUndefinedKeys<T extends Record<string, unknown>>(value: T): T {
  const next = { ...value };
  for (const [key, child] of Object.entries(next)) {
    if (child === undefined) {
      delete next[key];
    }
  }
  return next;
}

function cloneDefinition(definition: AutomationDefinition): AutomationDefinition {
  return JSON.parse(JSON.stringify(definition)) as AutomationDefinition;
}

function sortRecords(records: AutomationRecord[]): AutomationRecord[] {
  return [...records].sort((left, right) => {
    const leftTime = Date.parse(left.runtimeState.updatedAt || left.definition.createdAt || "") || 0;
    const rightTime = Date.parse(right.runtimeState.updatedAt || right.definition.createdAt || "") || 0;
    return rightTime - leftTime;
  });
}

export function isAutomationFrontmatterEnabled(): boolean {
  return envFlag("AGX_AUTOMATIONS_FRONTMATTER_ENABLED", true);
}

export function isAutomationDualReadEnabled(): boolean {
  return envFlag("AGX_AUTOMATIONS_DUAL_READ_ENABLED", true);
}

export class AutomationRepository {
  readonly rootDir: string;
  private readonly activeDir: string;
  private readonly archivedDir: string;
  private readonly stateDir: string;

  constructor(rootDir: string = getDefaultAutomationsDir()) {
    this.rootDir = path.resolve(rootDir);
    this.activeDir = path.join(this.rootDir, "active");
    this.archivedDir = path.join(this.rootDir, "archived");
    this.stateDir = path.join(this.rootDir, ".state");
    this.ensureDirs();
    this.migrateLegacyRepoStateIfNeeded();
  }

  getAutomation(id: string): AutomationRecord | null {
    const location = this.findAutomationLocation(id);
    if (!location) {
      return null;
    }
    return this.readAutomationFile(location.filePath, location.archived);
  }

  listAutomations(includeArchived = false): AutomationRecord[] {
    const recordsById = new Map<string, AutomationRecord>();
    for (const { filePath, archived } of this.listMarkdownFiles(includeArchived)) {
      const record = this.readAutomationFile(filePath, archived);
      if (!record) {
        continue;
      }
      if (recordsById.has(record.definition.id)) {
        console.error(`[automations] duplicate automation id detected: ${record.definition.id}`);
        continue;
      }
      recordsById.set(record.definition.id, record);
    }
    return sortRecords([...recordsById.values()]);
  }

  listVisibleAutomations(filter: AutomationListFilter = {}): AutomationRecord[] {
    return this.listAutomations(filter.includeArchived ?? false).filter((record) => {
      if (filter.state && record.definition.state !== filter.state) {
        return false;
      }
      if (filter.targetType && record.definition.target.type !== filter.targetType) {
        return false;
      }
      if (filter.projectId && record.definition.projectId !== filter.projectId) {
        return false;
      }
      if (filter.ids && !filter.ids.includes(record.definition.id)) {
        return false;
      }
      if (
        filter.graphId
        && (record.definition.target.type !== "execution_graph" || record.definition.target.graphId !== filter.graphId)
      ) {
        return false;
      }
      if (
        filter.taskId
        && (record.definition.target.type !== "execution_graph" || record.definition.target.taskId !== filter.taskId)
      ) {
        return false;
      }
      if (
        filter.rootMessageId
        && (
          record.definition.target.type !== "execution_graph"
          || record.definition.target.rootMessageId !== filter.rootMessageId
        )
      ) {
        return false;
      }
      return true;
    });
  }

  listDueAutomations(nowMs: number = Date.now(), filter: AutomationListFilter = {}): AutomationRecord[] {
    const records = this.listVisibleAutomations({
      ...filter,
      includeArchived: false,
      state: "active",
    });

    return records
      .map((record) => {
        const refreshed = this.ensureRuntimeState(record);
        return refreshed && isAutomationDue(refreshed.definition, refreshed.runtimeState, nowMs)
          ? refreshed
          : null;
      })
      .filter((record): record is AutomationRecord => Boolean(record))
      .sort((left, right) => (left.runtimeState.nextRunAt ?? 0) - (right.runtimeState.nextRunAt ?? 0));
  }

  createAutomation(input: AutomationDefinition): AutomationRecord {
    if (this.findAutomationLocation(input.id)) {
      throw new Error(`Automation ${input.id} already exists.`);
    }
    return this.writeAutomation(normalizeAutomationDefinition(input), false);
  }

  upsertAutomation(input: AutomationDefinition): AutomationRecord {
    const normalized = normalizeAutomationDefinition(input);
    const existing = this.findAutomationLocation(normalized.id);
    return this.writeAutomation(normalized, existing?.archived ?? false);
  }

  updateAutomation(id: string, patch: AutomationUpdatePatch): AutomationRecord | null {
    const current = this.getAutomation(id);
    if (!current) {
      return null;
    }

    const nextDefinition = this.applyPatch(current.definition, patch);
    return this.writeAutomation(nextDefinition, current.archived, current.runtimeState);
  }

  updateAutomationState(id: string, patch: AutomationStatePatch): AutomationRecord | null {
    const current = this.getAutomation(id);
    if (!current) {
      return null;
    }

    const runtimeState = updateAutomationRuntimeState(
      current.definition,
      current.runtimeState,
      patch,
    );
    this.writeStateFile(id, runtimeState);
    return {
      ...current,
      runtimeState,
    };
  }

  archiveAutomation(id: string): AutomationRecord | null {
    const current = this.getAutomation(id);
    if (!current || current.archived) {
      return current;
    }

    const nextPath = path.join(this.archivedDir, encodeAutomationFilename(id));
    fs.renameSync(current.filePath, nextPath);
    const runtimeState = updateAutomationRuntimeState(current.definition, current.runtimeState, {
      archivedAt: new Date().toISOString(),
    });
    this.writeStateFile(id, runtimeState);
    return {
      ...current,
      runtimeState,
      filePath: nextPath,
      archived: true,
    };
  }

  restoreAutomation(id: string): AutomationRecord | null {
    const current = this.getAutomation(id);
    if (!current || !current.archived) {
      return current;
    }

    const nextPath = path.join(this.activeDir, encodeAutomationFilename(id));
    fs.renameSync(current.filePath, nextPath);
    const runtimeState = updateAutomationRuntimeState(current.definition, current.runtimeState, {
      archivedAt: null,
    });
    this.writeStateFile(id, runtimeState);
    return {
      ...current,
      runtimeState,
      filePath: nextPath,
      archived: false,
    };
  }

  duplicateAutomation(id: string): AutomationRecord | null {
    const current = this.getAutomation(id);
    if (!current) {
      return null;
    }

    const duplicateId = `${current.definition.id}-copy-${randomUUID().slice(0, 8)}`;
    return this.createAutomation({
      ...cloneDefinition(current.definition),
      id: duplicateId,
      name: `${current.definition.name} Copy`,
      createdAt: new Date().toISOString(),
      state: "paused",
    });
  }

  deleteAutomation(id: string): boolean {
    const current = this.findAutomationLocation(id);
    if (!current) {
      return false;
    }

    fs.rmSync(current.filePath, { force: true });
    fs.rmSync(this.getStatePath(id), { force: true });
    return true;
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.activeDir, { recursive: true });
    fs.mkdirSync(this.archivedDir, { recursive: true });
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private migrateLegacyRepoStateIfNeeded(): void {
    const legacyRootDir = getLegacyRepoAutomationsDir();
    if (path.resolve(legacyRootDir) === this.rootDir) {
      return;
    }

    const legacyActiveDir = path.join(legacyRootDir, "active");
    const legacyArchivedDir = path.join(legacyRootDir, "archived");
    const legacyStateDir = path.join(legacyRootDir, ".state");
    const hasLegacyFiles = [legacyActiveDir, legacyArchivedDir, legacyStateDir].some((dirPath) => (
      fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0
    ));

    if (!hasLegacyFiles || this.hasStoredAutomationState()) {
      return;
    }

    let copiedEntries = 0;
    copiedEntries += this.copyDirContents(legacyActiveDir, this.activeDir);
    copiedEntries += this.copyDirContents(legacyArchivedDir, this.archivedDir);
    copiedEntries += this.copyDirContents(legacyStateDir, this.stateDir);

    if (copiedEntries > 0) {
      console.log(
        `[automations] migrated ${copiedEntries} legacy file(s) from ${legacyRootDir} to ${this.rootDir}`,
      );
    }
  }

  private hasStoredAutomationState(): boolean {
    return [this.activeDir, this.archivedDir, this.stateDir].some((dirPath) => (
      fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0
    ));
  }

  private copyDirContents(sourceDir: string, targetDir: string): number {
    if (!fs.existsSync(sourceDir)) {
      return 0;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    let copiedEntries = 0;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        copiedEntries += this.copyDirContents(sourcePath, targetPath);
        continue;
      }

      if (fs.existsSync(targetPath)) {
        continue;
      }

      fs.copyFileSync(sourcePath, targetPath);
      copiedEntries += 1;
    }

    return copiedEntries;
  }

  private listMarkdownFiles(includeArchived: boolean): Array<{ filePath: string; archived: boolean }> {
    const activeFiles = fs.existsSync(this.activeDir)
      ? fs.readdirSync(this.activeDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({ filePath: path.join(this.activeDir, name), archived: false }))
      : [];

    const archivedFiles = includeArchived && fs.existsSync(this.archivedDir)
      ? fs.readdirSync(this.archivedDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => ({ filePath: path.join(this.archivedDir, name), archived: true }))
      : [];

    return [...activeFiles, ...archivedFiles];
  }

  private findAutomationLocation(id: string): { filePath: string; archived: boolean } | null {
    const activePath = path.join(this.activeDir, encodeAutomationFilename(id));
    if (fs.existsSync(activePath)) {
      return { filePath: activePath, archived: false };
    }

    const archivedPath = path.join(this.archivedDir, encodeAutomationFilename(id));
    if (fs.existsSync(archivedPath)) {
      return { filePath: archivedPath, archived: true };
    }

    return null;
  }

  private readAutomationFile(filePath: string, archived: boolean): AutomationRecord | null {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const definition = parseAutomationMarkdown(raw, { filePath });
      const runtimeState = this.readStateFile(definition);
      return {
        definition,
        runtimeState,
        filePath,
        archived,
      };
    } catch (error) {
      console.error(`[automations] failed to read ${filePath}:`, error);
      return null;
    }
  }

  private readStateFile(definition: AutomationDefinition): AutomationRuntimeState {
    const statePath = this.getStatePath(definition.id);
    let existing: Partial<AutomationRuntimeState> | undefined;

    if (fs.existsSync(statePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(statePath, "utf8")) as Partial<AutomationRuntimeState>;
      } catch (error) {
        console.error(`[automations] failed to parse state for ${definition.id}:`, error);
      }
    }

    const nextState = initializeAutomationRuntimeState(definition, existing);
    if (
      !existing
      || existing.scheduleHash !== nextState.scheduleHash
      || existing.nextRunAt !== nextState.nextRunAt
    ) {
      this.writeStateFile(definition.id, nextState);
    }

    return nextState;
  }

  private writeStateFile(id: string, runtimeState: AutomationRuntimeState): void {
    fs.writeFileSync(this.getStatePath(id), `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");
  }

  private writeAutomation(
    definition: AutomationDefinition,
    archived: boolean,
    existingState?: Partial<AutomationRuntimeState>,
  ): AutomationRecord {
    const normalized = normalizeAutomationDefinition(definition);
    const updatedAt = new Date().toISOString();
    const filePath = path.join(
      archived ? this.archivedDir : this.activeDir,
      encodeAutomationFilename(normalized.id),
    );

    fs.writeFileSync(filePath, serializeAutomationDefinition(normalized), "utf8");
    const runtimeState = initializeAutomationRuntimeState(normalized, {
      ...(existingState ?? {}),
      updatedAt,
    });
    this.writeStateFile(normalized.id, runtimeState);

    return {
      definition: normalized,
      runtimeState,
      filePath,
      archived,
    };
  }

  private ensureRuntimeState(record: AutomationRecord): AutomationRecord | null {
    const nextState = initializeAutomationRuntimeState(record.definition, record.runtimeState);
    if (
      nextState.scheduleHash === record.runtimeState.scheduleHash
      && nextState.nextRunAt === record.runtimeState.nextRunAt
    ) {
      return record;
    }

    this.writeStateFile(record.definition.id, nextState);
    return {
      ...record,
      runtimeState: nextState,
    };
  }

  private applyPatch(definition: AutomationDefinition, patch: AutomationUpdatePatch): AutomationDefinition {
    const next = cloneDefinition(definition);

    if (patch.name !== undefined) next.name = patch.name;
    if (patch.description !== undefined) next.description = patch.description ?? undefined;
    if (patch.projectId !== undefined) next.projectId = patch.projectId ?? undefined;
    if (patch.state !== undefined) next.state = patch.state;
    if (patch.createdAt !== undefined) next.createdAt = patch.createdAt;
    if (patch.body !== undefined) next.body = patch.body;

    if (patch.trigger) {
      next.trigger = removeUndefinedKeys({
        ...next.trigger,
        ...patch.trigger,
      }) as AutomationDefinition["trigger"];
    }

    if (patch.execution !== undefined) {
      next.execution = patch.execution === null
        ? undefined
        : removeUndefinedKeys({
          ...(next.execution ?? {}),
          ...patch.execution,
        }) as AutomationDefinition["execution"];
    }

    if (patch.target) {
      next.target = removeUndefinedKeys({
        ...next.target,
        ...patch.target,
      }) as AutomationDefinition["target"];
    }

    return normalizeAutomationDefinition(next);
  }

  private getStatePath(id: string): string {
    return path.join(this.stateDir, `${encodeURIComponent(id)}.json`);
  }
}

let cachedRepository: AutomationRepository | null = null;
let cachedRootDir: string | null = null;

export function getAutomationRepository(): AutomationRepository {
  const rootDir = getDefaultAutomationsDir();
  if (!cachedRepository || cachedRootDir !== rootDir) {
    cachedRepository = new AutomationRepository(rootDir);
    cachedRootDir = rootDir;
  }
  return cachedRepository;
}

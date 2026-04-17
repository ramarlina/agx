import "server-only";

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { TrackerConnection } from "./types";

const AGX_DIR = path.join(homedir(), ".agx");

function getConnectionsPath(projectId: string): string {
  return path.join(AGX_DIR, "projects", projectId, "integrations", "trackers.json");
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readConnectionsFile(projectId: string): { connections: TrackerConnection[]; defaultTracker?: string } {
  if (!projectId) return { connections: [] };
  const filePath = getConnectionsPath(projectId);
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return {
      connections: Array.isArray(data.connections) ? data.connections : [],
      defaultTracker: typeof data.defaultTracker === "string" ? data.defaultTracker : undefined,
    };
  } catch {
    return { connections: [] };
  }
}

function writeConnectionsFile(
  projectId: string,
  connections: TrackerConnection[],
  defaultTracker: string | undefined
): void {
  const filePath = getConnectionsPath(projectId);
  ensureDir(filePath);
  const payload: { connections: TrackerConnection[]; defaultTracker?: string } = { connections };
  if (defaultTracker) payload.defaultTracker = defaultTracker;
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export function listTrackerConnections(projectId: string): TrackerConnection[] {
  return readConnectionsFile(projectId).connections;
}

export function getDefaultTrackerType(projectId: string): string | null {
  const data = readConnectionsFile(projectId);
  const typeExists = (t: string) => data.connections.some((c) => c.type === t);
  if (data.defaultTracker && typeExists(data.defaultTracker)) return data.defaultTracker;
  // Fall back to the only connected tracker, if exactly one is configured.
  return data.connections.length === 1 ? data.connections[0].type : null;
}

export function setDefaultTrackerType(projectId: string, trackerType: string | null): void {
  if (!projectId) return;
  const data = readConnectionsFile(projectId);
  const next = trackerType && data.connections.some((c) => c.type === trackerType) ? trackerType : undefined;
  writeConnectionsFile(projectId, data.connections, next);
}

export function addTrackerConnection(
  projectId: string,
  connection: TrackerConnection
): void {
  if (!projectId) return;
  const data = readConnectionsFile(projectId);
  const connections = data.connections.slice();
  const existing = connections.findIndex((c) => c.type === connection.type);
  if (existing >= 0) {
    connections[existing] = connection;
  } else {
    connections.push(connection);
  }
  writeConnectionsFile(projectId, connections, data.defaultTracker);
}

export function removeTrackerConnection(projectId: string, trackerType: string): void {
  if (!projectId) return;
  const data = readConnectionsFile(projectId);
  const connections = data.connections.filter((c) => c.type !== trackerType);
  const nextDefault = data.defaultTracker === trackerType ? undefined : data.defaultTracker;
  if (connections.length === 0) {
    const filePath = getConnectionsPath(projectId);
    try {
      unlinkSync(filePath);
    } catch {
      // already gone
    }
  } else {
    writeConnectionsFile(projectId, connections, nextDefault);
  }
}
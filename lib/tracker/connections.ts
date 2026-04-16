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

export function listTrackerConnections(projectId: string): TrackerConnection[] {
  if (!projectId) return [];
  const filePath = getConnectionsPath(projectId);
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.connections) ? data.connections : [];
  } catch {
    return [];
  }
}

export function addTrackerConnection(
  projectId: string,
  connection: TrackerConnection
): void {
  if (!projectId) return;
  const filePath = getConnectionsPath(projectId);
  ensureDir(filePath);
  const connections = listTrackerConnections(projectId);
  // Prevent duplicates — update existing connection of same type
  const existing = connections.findIndex((c) => c.type === connection.type);
  if (existing >= 0) {
    connections[existing] = connection;
  } else {
    connections.push(connection);
  }
  writeFileSync(filePath, JSON.stringify({ connections }, null, 2), "utf8");
}

export function removeTrackerConnection(projectId: string, trackerType: string): void {
  if (!projectId) return;
  const filePath = getConnectionsPath(projectId);
  const connections = listTrackerConnections(projectId).filter(
    (c) => c.type !== trackerType
  );
  if (connections.length === 0) {
    try {
      unlinkSync(filePath);
    } catch {
      // already gone
    }
  } else {
    ensureDir(filePath);
    writeFileSync(filePath, JSON.stringify({ connections }, null, 2), "utf8");
  }
}
import fs from "fs";

import { parseObjectiveMarkdown } from "./parser";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_FIELDS = ["id", "title", "teamId", "key", "status", "createdAt", "updatedAt"] as const;
const VALID_STATUSES = new Set(["on_track", "at_risk", "off_track", "done"]);

function isValidISOTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

export function validateObjectiveFile(filePath: string): ValidationResult {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { valid: false, errors: [`Cannot read file: ${error instanceof Error ? error.message : String(error)}`] };
  }

  if (!raw.startsWith("---")) {
    errors.push("File must start with --- (YAML frontmatter delimiter).");
  }

  let parsed;
  try {
    parsed = parseObjectiveMarkdown(raw, { filePath });
  } catch (error) {
    return { valid: false, errors: [`Parse error: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const obj = parsed.objective;

  for (const field of REQUIRED_FIELDS) {
    const value = obj[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (obj.status && !VALID_STATUSES.has(obj.status)) {
    errors.push(`Invalid status "${obj.status}". Must be one of: ${[...VALID_STATUSES].join(", ")}`);
  }

  if (obj.progress !== undefined) {
    if (typeof obj.progress !== "number" || obj.progress < 0 || obj.progress > 100) {
      errors.push(`progress must be a number between 0 and 100, got ${obj.progress}`);
    }
  }

  if (obj.createdAt && !isValidISOTimestamp(obj.createdAt)) {
    errors.push(`createdAt is not a valid ISO timestamp: "${obj.createdAt}"`);
  }

  if (obj.updatedAt && !isValidISOTimestamp(obj.updatedAt)) {
    errors.push(`updatedAt is not a valid ISO timestamp: "${obj.updatedAt}"`);
  }

  for (const activity of parsed.activities) {
    if (!activity.id) {
      errors.push(`Activity "${activity.title}" is missing an id.`);
    }
    if (!activity.objectiveId) {
      errors.push(`Activity "${activity.title}" is missing objectiveId.`);
    }
    if (activity.createdAt && !isValidISOTimestamp(activity.createdAt)) {
      errors.push(`Activity "${activity.title}" has invalid createdAt: "${activity.createdAt}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

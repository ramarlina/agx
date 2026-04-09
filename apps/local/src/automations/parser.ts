import { load } from "js-yaml";

import { normalizeAutomationDefinition } from "./validation";
import type { AutomationDefinition } from "./types";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n([\s\S]*))?$/;

function normalizeLoadedYaml(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseAutomationMarkdown(
  markdown: string,
  options: { filePath?: string } = {},
): AutomationDefinition {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new Error(`Automation file is missing YAML frontmatter${options.filePath ? ` (${options.filePath})` : ""}.`);
  }

  const [, rawFrontmatter, rawBody = ""] = match;
  const loaded = normalizeLoadedYaml(load(rawFrontmatter, {
    ...(options.filePath ? { filename: options.filePath } : {}),
  }));

  return normalizeAutomationDefinition({
    ...loaded,
    body: rawBody,
  });
}

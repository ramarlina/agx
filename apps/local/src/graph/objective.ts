export interface TaskObjectiveInput {
  objective?: string | null;
  description?: string | null;
  content?: string | null;
  title?: string | null;
}

const FRONTMATTER_PATTERN = /^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*/;
const LEADING_H1_PATTERN = /^#\s+(.+?)(?:\r?\n|$)/;

function normalizeOptionalText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_PATTERN, "");
}

export function sanitizeTaskObjective(
  value?: string | null,
  fallbackTitle?: string | null,
): string {
  const fallback = normalizeOptionalText(fallbackTitle);
  const raw = normalizeOptionalText(value);
  if (!raw) {
    return fallback;
  }

  const withoutFrontmatter = stripFrontmatter(raw).trim();
  if (!withoutFrontmatter) {
    return fallback;
  }

  const headingMatch = withoutFrontmatter.match(LEADING_H1_PATTERN);
  if (!headingMatch) {
    return withoutFrontmatter;
  }

  const rest = withoutFrontmatter.slice(headingMatch[0].length).trim();
  if (rest) {
    return rest;
  }

  return headingMatch[1].trim() || fallback;
}

export function deriveTaskObjective(input: TaskObjectiveInput): string {
  const description = normalizeOptionalText(input.description);
  if (description) {
    return sanitizeTaskObjective(description, input.title);
  }

  const content = normalizeOptionalText(input.content);
  if (content) {
    return sanitizeTaskObjective(content, input.title);
  }

  const objective = normalizeOptionalText(input.objective);
  if (objective) {
    return sanitizeTaskObjective(objective, input.title);
  }

  return normalizeOptionalText(input.title);
}

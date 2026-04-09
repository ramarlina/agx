export const DEPENDENCY_BLOCKED_REASON_PREFIX = "Waiting on dependencies";

interface DependencySummary {
  id?: string;
  title?: string;
  slug?: string;
  status?: string;
  stage?: string;
}

const MAX_DISPLAYED_DEPENDENCIES = 3;

function describeDependency(entry: DependencySummary): string {
  if (entry.title) return entry.title;
  if (entry.slug) return entry.slug;
  if (entry.id) return entry.id;
  return "(unknown)";
}

function describeStatus(entry: DependencySummary): string | null {
  if (entry.stage?.toLowerCase() === "intake") return " (awaiting approval)";
  return entry.status ? ` (${entry.status})` : null;
}

export function formatDependencyBlockedReason(dependencies: DependencySummary[]): string {
  if (!dependencies || dependencies.length === 0) {
    return "";
  }

  const entries = dependencies
    .slice(0, MAX_DISPLAYED_DEPENDENCIES)
    .map((entry) => `${describeDependency(entry)}${describeStatus(entry) ?? ""}`);

  let message = `${DEPENDENCY_BLOCKED_REASON_PREFIX}: ${entries.join(", ")}`;
  if (dependencies.length > MAX_DISPLAYED_DEPENDENCIES) {
    message += ` +${dependencies.length - MAX_DISPLAYED_DEPENDENCIES} more`;
  }
  return message;
}

export function isDependencyBlockedReason(reason?: string | null): boolean {
  return typeof reason === "string" && reason.startsWith(DEPENDENCY_BLOCKED_REASON_PREFIX);
}

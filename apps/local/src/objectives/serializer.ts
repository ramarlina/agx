import { dump } from "js-yaml";

import type {
  ProjectObjective,
  ProjectObjectiveActivity,
  ProjectObjectiveActivityThreadMessage,
  ProjectObjectiveWorkspaceState,
} from "@/lib/project-objectives";

function stripDefaults(obj: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }
  return next;
}

function serializeObjectiveFrontmatter(objective: ProjectObjective): string {
  const fields = stripDefaults({
    id: objective.id,
    title: objective.title,
    teamId: objective.teamId,
    key: objective.key,
    status: objective.status,
    progress: objective.progress || undefined,
    cadence: objective.cadence,
    condition: objective.condition,
    threadId: objective.threadId,
    chatSessionVersion: objective.chatSessionVersion || undefined,
    scheduledTaskIds: objective.scheduledTaskIds.length > 0 ? objective.scheduledTaskIds : undefined,
    createdAt: objective.createdAt,
    updatedAt: objective.updatedAt,
  });

  return dump(fields, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();
}

function serializeActivity(activity: ProjectObjectiveActivity): string {
  const lines: string[] = [];
  lines.push(`### ${activity.title}`);
  lines.push(`- **id:** ${activity.id}`);
  lines.push(`- **source:** ${activity.sourceLabel}`);
  lines.push(`- **created:** ${activity.createdAt}`);
  if (activity.body) {
    lines.push(`- **body:** ${activity.body}`);
  }
  if (activity.relatedTaskId) {
    lines.push(`- **relatedTaskId:** ${activity.relatedTaskId}`);
  }
  return lines.join("\n");
}

function serializeReplies(replies: ProjectObjectiveActivityThreadMessage[]): string {
  if (replies.length === 0) return "";
  const lines = ["#### Replies"];
  for (const reply of replies) {
    lines.push(`- **${reply.author}** (${reply.createdAt}): ${reply.body}`);
  }
  return lines.join("\n");
}

export function serializeObjectiveFile(
  objective: ProjectObjective,
  activities: ProjectObjectiveActivity[],
  activityThreads: Record<string, ProjectObjectiveActivityThreadMessage[]>,
): string {
  const frontmatter = serializeObjectiveFrontmatter(objective);
  const bodyParts: string[] = [];

  if (objective.summary) {
    bodyParts.push(`## Notes\n\n${objective.summary}`);
  }

  const objectiveActivities = activities
    .filter((a) => a.objectiveId === objective.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (objectiveActivities.length > 0) {
    const activityParts: string[] = ["## Activities"];
    for (const activity of objectiveActivities) {
      const activityText = serializeActivity(activity);
      const replies = activityThreads[activity.id] ?? [];
      const repliesText = serializeReplies(replies);
      activityParts.push(repliesText ? `${activityText}\n\n${repliesText}` : activityText);
    }
    bodyParts.push(activityParts.join("\n\n"));
  }

  const body = bodyParts.join("\n\n");
  return body.length > 0
    ? `---\n${frontmatter}\n---\n\n${body}\n`
    : `---\n${frontmatter}\n---\n`;
}

export function serializeWorkspaceToFiles(
  workspace: ProjectObjectiveWorkspaceState,
): Map<string, string> {
  const files = new Map<string, string>();

  for (const objective of workspace.objectives) {
    const filename = `${objective.key}.md`;
    const content = serializeObjectiveFile(
      objective,
      workspace.activities,
      workspace.activityThreads,
    );
    files.set(filename, content);
  }

  return files;
}

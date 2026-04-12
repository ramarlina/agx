import { dump } from "js-yaml";
import type { ObjectiveActivityFile } from "./types";

export function serializeActivityFile(activity: ObjectiveActivityFile): string {
  const fields: Record<string, unknown> = {
    id: activity.id,
    source: activity.source,
    objectiveLabel: activity.objectiveLabel,
    createdAt: activity.createdAt,
    type: activity.type,
  };

  const frontmatter = dump(fields, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();

  const body = activity.body.trim();
  return body
    ? `---\n${frontmatter}\n---\n\n${body}\n`
    : `---\n${frontmatter}\n---\n`;
}

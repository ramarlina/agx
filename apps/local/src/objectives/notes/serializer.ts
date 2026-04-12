import { dump } from "js-yaml";
import type { ObjectiveNoteFile } from "./types";

export function serializeNoteFile(note: ObjectiveNoteFile): string {
  const fields: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    objectiveId: note.objectiveId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };

  const frontmatter = dump(fields, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();

  const body = note.body.trim();
  return body
    ? `---\n${frontmatter}\n---\n\n${body}\n`
    : `---\n${frontmatter}\n---\n`;
}

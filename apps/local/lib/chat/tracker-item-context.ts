import type { JSONContent } from "@tiptap/core";

export interface MentionedTrackerItemContext {
  id: string;
  identifier: string;
  title: string;
  url: string | null;
  status: string;
  assignee: string | null;
  assigneeId: string | null;
  assigneeEmail: string | null;
  isAssignedToMe: boolean;
  teamId: string | null;
  teamName: string | null;
  teamKey: string | null;
  cycleId: string | null;
  cycleName: string | null;
  cycleNumber: number | null;
  description: string | null;
  updatedAt: string;
  pulledAt: string;
}

/** @deprecated Use MentionedTrackerItemContext instead */
export type MentionedLinearIssueContext = MentionedTrackerItemContext;

function walkNodes(
  nodes: JSONContent[] | undefined,
  visitor: (node: JSONContent) => void
): void {
  if (!nodes) return;
  for (const node of nodes) {
    visitor(node);
    walkNodes(node.content, visitor);
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function extractMentionedTrackerItemIds(doc: JSONContent): string[] {
  const itemIds = new Set<string>();

  walkNodes(doc.content, (node) => {
    if (node.type !== "trackerItemMention") return;
    const id = typeof node.attrs?.id === "string" ? node.attrs.id.trim() : "";
    if (id) {
      itemIds.add(id);
    }
  });

  return Array.from(itemIds);
}

/** @deprecated Use extractMentionedTrackerItemIds instead */
export const extractMentionedLinearIssueIds = extractMentionedTrackerItemIds;

export function buildTrackerItemContextPrefix(issues: MentionedTrackerItemContext[]): string {
  if (issues.length === 0) return "";

  const blocks = issues.map((issue) => {
    const parts = [
      `<tracker-item identifier="${escapeAttribute(issue.identifier)}" status="${escapeAttribute(issue.status)}"${issue.assignee ? ` assignee="${escapeAttribute(issue.assignee)}"` : ""}>`,
      `Title: ${issue.title}`,
      issue.url ? `URL: ${issue.url}` : null,
      issue.teamName ? `Team: ${issue.teamName}` : null,
      issue.cycleName || issue.cycleNumber != null
        ? `Cycle: ${issue.cycleName ?? `Cycle ${issue.cycleNumber}`}`
        : null,
      `Updated: ${issue.updatedAt}`,
      "",
      issue.description?.trim() || "No description provided.",
      "</tracker-item>",
    ];

    return parts.filter((part): part is string => part !== null).join("\n");
  });

  return `Referenced tickets (only because the user explicitly @mentioned them):\n\n${blocks.join("\n\n")}\n\n`;
}

/** @deprecated Use buildTrackerItemContextPrefix instead */
export const buildLinearIssueContextPrefix = buildTrackerItemContextPrefix;

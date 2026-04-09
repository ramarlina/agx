import type { JSONContent } from "@tiptap/core";

export interface ComposerRoutingMetadata {
  pinnedParticipantId?: string;
  mentionedParticipantIds: string[];
  parallelParticipantIds: string[];
}

function normalizeParticipantIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
}

function normalizePinnedParticipantId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

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

export function extractComposerRouting(
  doc: JSONContent,
  pinnedParticipantId?: string | null
): ComposerRoutingMetadata {
  const mentioned = new Set<string>();
  const parallel = new Set<string>();

  walkNodes(doc.content, (node) => {
    if (node.type !== "participantMention") return;

    const attrs = node.attrs ?? {};
    const id = typeof attrs.id === "string" ? attrs.id.trim() : "";
    const kind = typeof attrs.kind === "string" ? attrs.kind : "agent";
    if (!id || kind !== "agent") return;

    mentioned.add(id);
    if (attrs.mode === "parallel") {
      parallel.add(id);
    }
  });

  const normalizedPinned = normalizePinnedParticipantId(pinnedParticipantId);
  return {
    ...(normalizedPinned ? { pinnedParticipantId: normalizedPinned } : {}),
    mentionedParticipantIds: Array.from(mentioned),
    parallelParticipantIds: Array.from(parallel),
  };
}

export function normalizeComposerRouting(value: unknown): ComposerRoutingMetadata {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const pinnedParticipantId = normalizePinnedParticipantId(input.pinnedParticipantId);
  const mentionedParticipantIds = normalizeParticipantIds(input.mentionedParticipantIds);
  const mentionedSet = new Set(mentionedParticipantIds);

  const parallelParticipantIds = normalizeParticipantIds(input.parallelParticipantIds).filter(
    (participantId) => {
      mentionedSet.add(participantId);
      return true;
    }
  );

  return {
    ...(pinnedParticipantId ? { pinnedParticipantId } : {}),
    mentionedParticipantIds: Array.from(mentionedSet),
    parallelParticipantIds,
  };
}

export function orderParticipantIds(
  participantIds: string[],
  pinnedParticipantId?: string | null
): string[] {
  const uniqueIds = normalizeParticipantIds(participantIds);
  const normalizedPinned = normalizePinnedParticipantId(pinnedParticipantId);

  if (!normalizedPinned || !uniqueIds.includes(normalizedPinned)) {
    return uniqueIds;
  }

  return [
    normalizedPinned,
    ...uniqueIds.filter((participantId) => participantId !== normalizedPinned),
  ];
}

export function mergeComposerRouting(
  detected: { mentioned: Set<string>; parallel: Set<string> },
  routing: ComposerRoutingMetadata
): { mentioned: Set<string>; parallel: Set<string> } {
  const mentioned = new Set(detected.mentioned);
  const parallel = new Set(detected.parallel);

  for (const participantId of routing.mentionedParticipantIds) {
    mentioned.add(participantId);
  }

  for (const participantId of routing.parallelParticipantIds) {
    mentioned.add(participantId);
    parallel.add(participantId);
  }

  return { mentioned, parallel };
}

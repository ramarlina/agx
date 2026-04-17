import type { PrLinkSource, TrackerTargetType } from "./github-types";

export const ID_PATTERN = /(?<![A-Za-z0-9])[A-Z]+-\d+(?![A-Za-z0-9])/;
const ID_PATTERN_GLOBAL = new RegExp(ID_PATTERN, "g");

export interface ExtractedId {
  id: string;
  source: Exclude<PrLinkSource, "manual">;
}

export interface PrLinkInput {
  headRef: string;
  title: string;
  body: string;
}

export function extractTrackerIds(input: PrLinkInput): ExtractedId[] {
  const out: ExtractedId[] = [];
  const seen = new Set<string>();
  const fields: Array<[string, ExtractedId["source"]]> = [
    [input.headRef, "branch"],
    [input.title, "title"],
    [input.body, "body"],
  ];
  for (const [text, source] of fields) {
    const matches = text.match(ID_PATTERN_GLOBAL) ?? [];
    for (const raw of matches) {
      const id = raw.toUpperCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, source });
    }
  }
  return out;
}

export type TrackerResolver = (
  id: string,
) => Promise<{ targetType: TrackerTargetType; targetId: string } | null>;

export interface ResolvedPrLink {
  targetType: TrackerTargetType;
  targetId: string;
  linkSource: Exclude<PrLinkSource, "manual">;
}

export async function resolvePrLink(
  input: PrLinkInput,
  resolvers: TrackerResolver[],
): Promise<ResolvedPrLink | null> {
  const ids = extractTrackerIds(input);
  for (const extracted of ids) {
    for (const resolver of resolvers) {
      const match = await resolver(extracted.id);
      if (match) {
        return {
          targetType: match.targetType,
          targetId: match.targetId,
          linkSource: extracted.source,
        };
      }
    }
  }
  return null;
}

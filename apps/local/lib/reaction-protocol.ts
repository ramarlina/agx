import type { ReactionType } from "./types";

export interface ParsedReactionSignal {
  raw: string;
  target: string;
  type: ReactionType;
  reason?: string;
  blockerCode?: string;
}

export interface InvalidReactionSignal {
  raw: string;
  error: string;
}

export interface ParsedReactionOutput {
  signals: ParsedReactionSignal[];
  invalid: InvalidReactionSignal[];
  cleanedText: string;
}

const REACTION_TYPES = new Set<ReactionType>([
  "ack",
  "working",
  "done",
  "clarify",
  "blocked",
]);

const TAG_REGEX = /\[reaction\s+([^\]]+)\]/gi;
const ATTR_REGEX =
  /([a-zA-Z][a-zA-Z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s\]]*?(?=\s|]|[a-zA-Z][a-zA-Z0-9_]*=|$)))/g;

function decodeAttrValue(value: string): string {
  return value.replace(/\\(["'\\])/g, "$1").trim();
}

function parseAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_REGEX.lastIndex = 0;

  for (;;) {
    const match = ATTR_REGEX.exec(raw);
    if (!match) break;
    const key = match[1].toLowerCase();
    const quotedDouble = match[2];
    const quotedSingle = match[3];
    const bare = match[4];
    const value = decodeAttrValue(quotedDouble ?? quotedSingle ?? bare ?? "");
    attrs.set(key, value);
  }

  return attrs;
}

export function parseReactionSignals(content: string): ParsedReactionOutput {
  const signals: ParsedReactionSignal[] = [];
  const invalid: InvalidReactionSignal[] = [];

  const cleanedText = content
    .replace(TAG_REGEX, (rawTag, attrsRaw) => {
      const attrs = parseAttributes(String(attrsRaw));
      const target = (attrs.get("target") || "").trim();
      const typeRaw = (attrs.get("type") || "").trim().toLowerCase();
      const reason = (attrs.get("reason") || "").trim();
      const blockerCode = (attrs.get("blockercode") || attrs.get("blocker_code") || "").trim();

      if (!target) {
        invalid.push({ raw: rawTag, error: "Missing target" });
        return "";
      }

      if (!REACTION_TYPES.has(typeRaw as ReactionType)) {
        invalid.push({ raw: rawTag, error: `Invalid type: ${typeRaw || "(empty)"}` });
        return "";
      }

      const type = typeRaw as ReactionType;
      if ((type === "clarify" || type === "blocked") && !reason) {
        invalid.push({ raw: rawTag, error: `"${type}" requires reason` });
        return "";
      }

      signals.push({
        raw: rawTag,
        target,
        type,
        reason: reason || undefined,
        blockerCode: type === "blocked" ? blockerCode || undefined : undefined,
      });
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { signals, invalid, cleanedText };
}

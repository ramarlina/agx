import type { JSONContent } from "@tiptap/core";

/**
 * Serialize a Tiptap document JSON back to plain text with mention tokens.
 *
 * - participantMention → @Name or @@Name
 * - projectMention → @~project:slug
 * - fileMention → @/path or @~/path
 * - threadMention → @#shortId
 * - trackerItemMention → @ABC-123
 * - text nodes → verbatim text
 * - paragraphs separated by \n
 */
export function serializeToPlainText(doc: JSONContent): string {
  if (!doc.content) return "";

  const paragraphs: string[] = [];

  for (const block of doc.content) {
    if (block.type === "paragraph") {
      paragraphs.push(serializeParagraph(block));
    } else {
      // Fallback: treat as paragraph
      paragraphs.push(serializeParagraph(block));
    }
  }

  return paragraphs.join("\n");
}

function serializeParagraph(node: JSONContent): string {
  if (!node.content) return "";

  let text = "";

  for (const child of node.content) {
    switch (child.type) {
      case "text":
        text += child.text ?? "";
        break;

      case "participantMention": {
        const attrs = child.attrs ?? {};
        const prefix = attrs.mode === "parallel" ? "@@" : "@";
        text += `${prefix}${attrs.name}`;
        break;
      }

      case "projectMention": {
        const attrs = child.attrs ?? {};
        const slug = String(attrs.slug ?? "").trim();
        if (slug) {
          text += `@~project:${slug}`;
        } else if (attrs.name) {
          text += `@${attrs.name}`;
        }
        break;
      }

      case "fileMention": {
        const attrs = child.attrs ?? {};
        const display = attrs.relativePath || attrs.path;
        text += `@${display}`;
        break;
      }

      case "threadMention": {
        const attrs = child.attrs ?? {};
        const shortId = (attrs.threadId ?? "").slice(0, 8);
        text += `@#${shortId}`;
        break;
      }

      case "trackerItemMention": {
        const attrs = child.attrs ?? {};
        const identifier = String(attrs.identifier ?? "").trim();
        if (identifier) {
          text += `@${identifier}`;
        }
        break;
      }

      default:
        // hardBreak, etc.
        if (child.type === "hardBreak") {
          text += "\n";
        }
        break;
    }
  }

  return text;
}

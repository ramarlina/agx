import type { Editor } from "@tiptap/core";

export interface ParagraphTextInfo {
  /** Plain text of the current paragraph (mention nodes collapsed to their display text) */
  text: string;
  /** Cursor position within the plain text */
  cursorPos: number;
  /** ProseMirror position of the start of the paragraph's content */
  blockStart: number;
}

/**
 * Extract the plain text of the paragraph containing the cursor,
 * with cursor position mapped to plain-text coordinates.
 *
 * Mention atom nodes are expanded to their display text so that
 * the existing autocomplete hooks (which work on plain text + cursor offset)
 * continue to function correctly.
 */
export function getCurrentParagraphText(editor: Editor): ParagraphTextInfo | null {
  const { state } = editor;
  const { $from } = state.selection;

  // Find the nearest parent paragraph
  const depth = $from.depth;
  let paragraphDepth = -1;
  for (let d = depth; d >= 0; d--) {
    if ($from.node(d).type.name === "paragraph") {
      paragraphDepth = d;
      break;
    }
  }

  if (paragraphDepth === -1) return null;

  const paragraphNode = $from.node(paragraphDepth);
  const blockStart = $from.start(paragraphDepth); // PM pos of first child

  // The cursor's PM offset within the paragraph
  const cursorOffset = $from.pos - blockStart;

  // Walk the paragraph children, building plain text and mapping cursor
  let text = "";
  let cursorPos = 0;
  let pmOffset = 0;
  let cursorMapped = false;

  paragraphNode.forEach((child, offset) => {
    const childStart = offset; // offset within paragraph node content
    const childEnd = offset + child.nodeSize;

    if (child.isText) {
      const t = child.text ?? "";
      // If cursor falls within this text node
      if (!cursorMapped && cursorOffset >= childStart && cursorOffset <= childEnd) {
        cursorPos = text.length + (cursorOffset - childStart);
        cursorMapped = true;
      }
      text += t;
    } else if (child.isAtom) {
      // Expand atom to its display text
      const display = getAtomDisplayText(child);
      if (!cursorMapped && cursorOffset >= childStart && cursorOffset <= childEnd) {
        // Cursor is at the atom boundary — place it after the display text
        cursorPos = text.length + display.length;
        cursorMapped = true;
      }
      text += display;
    }
  });

  // If cursor is at end of paragraph
  if (!cursorMapped) {
    cursorPos = text.length;
  }

  return { text, cursorPos, blockStart };
}

function getAtomDisplayText(node: { type: { name: string }; attrs: Record<string, any> }): string {
  switch (node.type.name) {
    case "participantMention": {
      const prefix = node.attrs.mode === "parallel" ? "@@" : "@";
      return `${prefix}${node.attrs.name}`;
    }
    case "projectMention": {
      const slug = String(node.attrs.slug ?? "").trim();
      if (slug) {
        return `@~project:${slug}`;
      }
      return node.attrs.name ? `@${node.attrs.name}` : "";
    }
    case "fileMention": {
      const display = node.attrs.relativePath || node.attrs.path;
      return `@${display}`;
    }
    case "threadMention": {
      const shortId = (node.attrs.threadId ?? "").slice(0, 8);
      return `@#${shortId}`;
    }
    case "linearIssueMention": {
      const identifier = String(node.attrs.identifier ?? "").trim();
      return identifier ? `@${identifier}` : "";
    }
    default:
      return "";
  }
}

/**
 * Convert a plain-text range [startIndex, endIndex) back to ProseMirror
 * positions within the paragraph that starts at `blockStart`.
 *
 * Walks paragraph children the same way as getCurrentParagraphText,
 * mapping plain-text offsets to PM positions.
 */
export function plainTextRangeToPos(
  editor: Editor,
  blockStart: number,
  startIndex: number,
  endIndex: number
): { from: number; to: number } | null {
  const { state } = editor;
  const resolvedStart = state.doc.resolve(blockStart);

  // Find the paragraph node
  const depth = resolvedStart.depth;
  let paragraphNode = null;
  let paragraphStart = blockStart;
  for (let d = depth; d >= 0; d--) {
    const node = resolvedStart.node(d);
    if (node.type.name === "paragraph") {
      paragraphNode = node;
      paragraphStart = resolvedStart.start(d);
      break;
    }
  }

  if (!paragraphNode) {
    // blockStart IS the paragraph content start — resolve parent
    const parent = state.doc.resolve(blockStart);
    paragraphNode = parent.parent;
    paragraphStart = blockStart;
  }

  let plainOffset = 0;
  let from: number | null = null;
  let to: number | null = null;

  paragraphNode.forEach((child, offset) => {
    const pmPos = paragraphStart + offset;
    const childSize = child.nodeSize;

    if (child.isText) {
      const t = child.text ?? "";
      const textEnd = plainOffset + t.length;

      if (from === null && startIndex >= plainOffset && startIndex <= textEnd) {
        from = pmPos + (startIndex - plainOffset);
      }
      if (to === null && endIndex >= plainOffset && endIndex <= textEnd) {
        to = pmPos + (endIndex - plainOffset);
      }

      plainOffset = textEnd;
    } else if (child.isAtom) {
      const display = getAtomDisplayText(child);
      const textEnd = plainOffset + display.length;

      if (from === null && startIndex >= plainOffset && startIndex <= textEnd) {
        from = pmPos;
      }
      if (to === null && endIndex >= plainOffset && endIndex <= textEnd) {
        to = pmPos + childSize;
      }

      plainOffset = textEnd;
    }
  });

  // Handle positions at the very end
  if (from === null && startIndex >= plainOffset) {
    from = paragraphStart + paragraphNode.content.size;
  }
  if (to === null && endIndex >= plainOffset) {
    to = paragraphStart + paragraphNode.content.size;
  }

  if (from === null || to === null) return null;

  return { from, to };
}

/**
 * Strip internal protocol markers from message content before display.
 * Covers: [agx:*], [reaction ...], [checkpoint], [criteria:*], [done], [blocked*], [SKIP]
 */
export function stripMarkers(content: string): string {
  return content
    .replace(/\[reaction\s+[^\]]*\]/gi, "")
    .replace(/\[agx:[^\]]*\]/g, "")
    .replace(/\[checkpoint\]/g, "")
    .replace(/\[criteria:\s*[^\]]*\]/g, "")
    .replace(/\[done\]/g, "")
    .replace(/\[blocked[^\]]*\]/g, "")
    .replace(/^\[SKIP\]$/gm, "")
    .trim();
}

export type StreamSegment =
  | { type: "text"; content: string }
  | { type: "tool"; name: string; details: string; pending: boolean };

const TOOL_START = /\*\*(?:🌐\s*)?(?:Z\.ai\s+)?Built-in Tool:\s*(\w+)\*\*/;

export function parseStreamSegments(raw: string): StreamSegment[] {
  const segments: StreamSegment[] = [];
  let rest = raw;

  while (rest.length > 0) {
    const match = rest.match(TOOL_START);
    if (!match || match.index === undefined) {
      const text = stripMarkers(rest).trim();
      if (text) segments.push({ type: "text", content: text });
      break;
    }

    const before = rest.slice(0, match.index).trim();
    if (before) {
      const text = stripMarkers(before).trim();
      if (text) segments.push({ type: "text", content: text });
    }

    rest = rest.slice(match.index + match[0].length);
    const toolName = match[1];

    const nextTool = rest.match(TOOL_START);
    let toolBlock: string;
    if (nextTool && nextTool.index !== undefined) {
      const nextText = rest.slice(nextTool.index);
      const hasTextBefore = rest.slice(0, nextTool.index).replace(/\s/g, "").length > 0;
      if (hasTextBefore) {
        toolBlock = rest.slice(0, nextTool.index);
        rest = rest.slice(nextTool.index);
      } else {
        toolBlock = rest;
        rest = "";
      }
    } else {
      toolBlock = rest;
      rest = "";
    }

    const hasOutput = /\*\*Output:\*\*/.test(toolBlock);
    const pending = !hasOutput;

    const details = toolBlock
      .replace(/^\s*\n/, "")
      .replace(/\s+$/, "")
      .replace(/^\*\*Input:\*\*\s*\n?/, "")
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .replace(/\*Executing on server\.\.\.\*\s*/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    segments.push({ type: "tool", name: toolName, details, pending });
  }

  return segments;
}

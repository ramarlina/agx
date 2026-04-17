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
  | { type: "tool"; name: string; input: string; pending: boolean };

const TOOL_START = /\*\*(?:🌐\s*)?(?:Z\.ai\s+)?Built-in Tool:\s*(\w+)\*\*/;

function cleanText(s: string): string {
  return stripMarkers(
    s
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*$/g, "")
      .replace(/ {10,}/g, " ")
  ).trim();
}

export function parseStreamSegments(raw: string): StreamSegment[] {
  const segments: StreamSegment[] = [];

  // Split content on tool block starts, keeping the delimiter
  const parts = raw.split(TOOL_START);

  // parts[0] = text before first tool
  // parts[1] = tool name, parts[2] = rest until next split
  // parts[3] = tool name, parts[4] = rest, etc.

  const firstText = cleanText(parts[0]);
  if (firstText) segments.push({ type: "text", content: firstText });

  for (let i = 1; i < parts.length; i += 2) {
    const toolName = parts[i];
    const block = parts[i + 1] || "";

    // Extract input from code block
    const inputMatch = block.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const input = inputMatch ? inputMatch[1].trim() : "";

    // Find where tool block ends and text resumes
    const hasOutput = /\*\*Output:\*\*/.test(block);
    let textAfter = "";

    if (hasOutput) {
      // Output line ends, then after double-newline text resumes
      const outputIdx = block.indexOf("**Output:**");
      const afterOutput = block.slice(outputIdx);
      // Find double newline after the output summary line
      const boundary = afterOutput.search(/\n\s*\n(?=\S)/);
      if (boundary !== -1) {
        textAfter = afterOutput.slice(boundary).trim();
      }
    } else {
      // No output yet (pending) — check for text after *Executing on server...*
      const execIdx = block.indexOf("*Executing on server...*");
      if (execIdx !== -1) {
        const afterExec = block.slice(execIdx + "*Executing on server...*".length).trim();
        if (afterExec) textAfter = afterExec;
      }
    }

    segments.push({ type: "tool", name: toolName, input, pending: !hasOutput });

    const cleaned = cleanText(textAfter);
    if (cleaned) segments.push({ type: "text", content: cleaned });
  }

  return segments;
}

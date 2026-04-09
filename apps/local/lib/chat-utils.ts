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

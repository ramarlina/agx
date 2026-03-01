/**
 * Strip all agx control markers from text before persistence.
 * Removes marker syntax while preserving surrounding content.
 */

const MARKER_PATTERNS = [
  /\[checkpoint:\s*[^\]]*\]/gi,
  /\[learn:\s*[^\]]*\]/gi,
  /\[progress:\s*\d+%?\s*\]/gi,
  /\[blocked:\s*[^\]]*\]/gi,
  /\[done\]/gi,
  /\[plan_json:\s*\{[\s\S]*?\}\s*\]/gi,
  /\[criteria_json:\s*\{[\s\S]*?\}\s*\]/gi,
  /\[agx:\w+[^\]]*\]/gi,
];

function stripMarkers(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of MARKER_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // Clean up empty lines left behind
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

module.exports = { stripMarkers, MARKER_PATTERNS };

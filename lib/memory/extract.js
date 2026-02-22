'use strict';

/**
 * Memory extraction from completed/failed tasks.
 *
 * After a task finishes, makes one LLM call to distill 0-3 memories
 * (decisions, patterns, gotchas) from the task summary. Strict JSON
 * contract with one retry. Fail-open: extraction failure never blocks
 * task completion.
 */

const crypto = require('crypto');
const { insertMemory } = require('../storage/db');

const EXTRACTION_PROMPT = `From this task summary, extract 0-3 memories that would help an agent working on similar tasks in the future. Each memory should be a single actionable sentence.

Categories:
- "decision": A design/implementation choice that was made and why
- "pattern": A codebase or workflow pattern discovered
- "gotcha": A pitfall, failure, or thing to avoid

Return ONLY a JSON array of objects: [{"memory_type": "decision"|"pattern"|"gotcha", "content": "..."}]
Return an empty array [] if there's nothing worth remembering.

Task outcome: {{outcome}}
Task title: {{title}}
Task summary:
{{summary}}`;

/**
 * Parse strict JSON array of memories from LLM response.
 * @param {string} text - Raw LLM response
 * @returns {Array<{memory_type: string, content: string}>|null} Parsed memories or null
 */
function parseMemoryJson(text) {
  if (!text || typeof text !== 'string') return null;

  // Try to find a JSON array in the response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;

    const VALID_TYPES = new Set(['outcome', 'decision', 'pattern', 'gotcha']);
    const validated = parsed.filter(
      (m) =>
        m &&
        typeof m.memory_type === 'string' &&
        VALID_TYPES.has(m.memory_type) &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    );

    return validated.slice(0, 3);
  } catch {
    return null;
  }
}

/**
 * Build the extraction prompt from task context.
 */
function buildExtractionPrompt({ title, summary, outcome }) {
  return EXTRACTION_PROMPT
    .replace('{{outcome}}', outcome || 'unknown')
    .replace('{{title}}', title || 'Untitled')
    .replace('{{summary}}', summary || '(no summary)');
}

/**
 * Extract and store memories from a completed task.
 *
 * @param {Object} params
 * @param {string} params.taskId - Cloud task ID
 * @param {string} params.agentId - Agent identifier (e.g. project slug or provider)
 * @param {string} params.title - Task title
 * @param {string} params.summary - Task summary/explanation from decision payload
 * @param {string} params.outcome - 'success' | 'failed'
 * @param {Function} params.llmCall - async (prompt: string) => string — the LLM invocation function
 * @param {Function} [params.onLog] - Optional logger
 * @returns {Promise<Array>} Inserted memories (may be empty)
 */
async function extractAndStoreMemories({ taskId, agentId, title, summary, outcome, llmCall, onLog }) {
  if (!taskId || !agentId || !summary) {
    onLog?.('[memory] skipping extraction: missing taskId, agentId, or summary');
    return [];
  }

  const prompt = buildExtractionPrompt({ title, summary, outcome });
  let memories = null;

  // Attempt 1
  try {
    const response = await llmCall(prompt);
    memories = parseMemoryJson(response);
  } catch (err) {
    onLog?.(`[memory] extraction LLM call failed: ${err?.message || err}`);
  }

  // Retry once if first attempt returned non-JSON
  if (!memories) {
    try {
      const response = await llmCall(prompt);
      memories = parseMemoryJson(response);
    } catch (err) {
      onLog?.(`[memory] extraction retry failed: ${err?.message || err}`);
    }
  }

  if (!memories || memories.length === 0) {
    onLog?.('[memory] no memories extracted');
    return [];
  }

  const stored = [];
  for (const mem of memories) {
    try {
      const id = crypto.randomUUID();
      const inserted = insertMemory({
        id,
        agent_id: agentId,
        task_id: taskId,
        memory_type: mem.memory_type,
        content: mem.content.trim(),
      });
      if (inserted) {
        stored.push({ id, ...mem });
        onLog?.(`[memory] stored ${mem.memory_type}: ${mem.content.trim().slice(0, 80)}`);
      }
    } catch (err) {
      onLog?.(`[memory] insert failed: ${err?.message || err}`);
    }
  }

  return stored;
}

module.exports = { extractAndStoreMemories, parseMemoryJson, buildExtractionPrompt };

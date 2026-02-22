'use strict';

/**
 * Memory injection into agent prompts at task start.
 *
 * Retrieves the last N memories for an agent (scoped per-project via agent_id)
 * and formats them as a "## Past learnings" block for prompt injection.
 */

const { getMemoriesByAgent } = require('../storage/db');

const DEFAULT_MAX_MEMORIES = 5;
const DEFAULT_MAX_CHARS = 1600; // ~400 tokens budget

/**
 * Retrieve recent memories for an agent and format as a prompt block.
 *
 * @param {Object} params
 * @param {string} params.agentId - Agent identifier (typically project slug)
 * @param {number} [params.maxMemories=5] - Max memories to inject
 * @param {number} [params.maxChars=1600] - Hard character cap for the block
 * @returns {string} Formatted "## Past learnings" block, or empty string if none
 */
function buildMemoryBlock({ agentId, maxMemories = DEFAULT_MAX_MEMORIES, maxChars = DEFAULT_MAX_CHARS }) {
  if (!agentId) return '';

  let memories;
  try {
    memories = getMemoriesByAgent(agentId);
  } catch {
    return '';
  }

  if (!memories || memories.length === 0) return '';

  // Take last N by recency (they're ordered ASC by created_at, so take from the end)
  const recent = memories.slice(-maxMemories);

  const TYPE_LABELS = {
    outcome: 'Outcome',
    decision: 'Decision',
    pattern: 'Pattern',
    gotcha: 'Gotcha',
  };

  const lines = ['## Past learnings', '', 'From previous tasks in this project:', ''];
  let totalChars = lines.join('\n').length;

  for (const mem of recent) {
    const label = TYPE_LABELS[mem.memory_type] || mem.memory_type;
    const line = `- **${label}:** ${mem.content}`;
    if (totalChars + line.length + 1 > maxChars) break;
    lines.push(line);
    totalChars += line.length + 1;
  }

  // If no memories fit within budget, return empty
  if (lines.length <= 4) return '';

  return lines.join('\n');
}

module.exports = { buildMemoryBlock, DEFAULT_MAX_MEMORIES, DEFAULT_MAX_CHARS };

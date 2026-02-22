'use strict';

/**
 * Lightweight LLM call for memory extraction.
 * Uses the claude CLI in one-shot mode (no permissions needed for pure text generation).
 */

const execa = require('execa');

/**
 * Call claude CLI with a prompt and return the text response.
 * Falls back to returning null if claude is unavailable.
 *
 * @param {string} prompt
 * @param {Object} [options]
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @returns {Promise<string|null>}
 */
async function callClaude(prompt, { timeout = 30000 } = {}) {
  const result = await execa('claude', ['-p', prompt, '--no-input'], {
    timeout,
    reject: false,
    env: { ...process.env, TERM: 'dumb' },
  });

  if (result.exitCode !== 0) {
    throw new Error(`claude exited with code ${result.exitCode}: ${(result.stderr || '').slice(0, 200)}`);
  }

  return result.stdout || '';
}

module.exports = { callClaude };

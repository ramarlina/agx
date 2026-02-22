/* eslint-disable no-console */
'use strict';

const crypto = require('crypto');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendTail(prev, chunk, maxChars = 4000) {
  const next = `${prev || ''}${String(chunk || '')}`;
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}

function truncateForTrace(str, maxChars = 2000) {
  if (!str) return '';
  if (str.length <= maxChars) return str;
  return str.slice(-maxChars);
}

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { }
  return crypto.createHash('sha1').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12);
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/\u001b\[[0-9;]*m/g, '');

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    for (let i = 0; i < cleaned.length; i += 1) {
      if (cleaned[i] !== '{') continue;
      let depth = 0;
      for (let j = i; j < cleaned.length; j += 1) {
        const ch = cleaned[j];
        if (ch === '{') depth += 1;
        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const maybe = cleaned.slice(i, j + 1);
            try {
              return JSON.parse(maybe);
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }
}

function extractJsonLast(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/\u001b\[[0-9;]*m/g, '');

  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (cleaned[i] !== '}') continue;
    let depth = 0;
    for (let j = i; j >= 0; j -= 1) {
      const ch = cleaned[j];
      if (ch === '}') depth += 1;
      if (ch === '{') {
        depth -= 1;
        if (depth === 0) {
          const maybe = cleaned.slice(j, i + 1);
          try {
            return JSON.parse(maybe);
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function truncateForPrompt(text, maxChars) {
  const value = String(text || '');
  const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 6000;
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}\n[truncated]`;
}

function ensureNextPrompt(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  if (decision.done) return decision;
  if (typeof decision.next_prompt === 'string' && decision.next_prompt.trim()) return decision;

  const source = [decision.explanation, decision.summary, decision.final_result]
    .find((v) => typeof v === 'string' && v.trim());

  const fallback = source
    ? `Continue the task with this guidance: ${source.trim()}`
    : 'Continue the task by identifying the next concrete step, implementing it, and verifying the result.';

  return {
    ...decision,
    next_prompt: fallback
  };
}

function buildNextPromptWithDecisionContext(decision) {
  if (!decision || typeof decision !== 'object') return '';
  const nextPrompt = typeof decision.next_prompt === 'string' ? decision.next_prompt.trim() : '';
  if (!nextPrompt) return '';

  const decisionLabel = typeof decision.decision === 'string' ? decision.decision.trim() : '';
  const summary = typeof decision.summary === 'string' ? decision.summary.trim() : '';
  const explanation = typeof decision.explanation === 'string' ? decision.explanation.trim() : '';
  const finalResult = typeof decision.final_result === 'string' ? decision.final_result.trim() : '';

  const ctx = [];
  if (decisionLabel) ctx.push(`Decision: ${decisionLabel}`);
  if (summary) ctx.push(`Summary: ${truncateForPrompt(summary, 800)}`);
  if (explanation && explanation !== summary) ctx.push(`Explanation: ${truncateForPrompt(explanation, 1200)}`);
  if (finalResult && finalResult !== summary && finalResult !== explanation) ctx.push(`Final Result: ${truncateForPrompt(finalResult, 1200)}`);

  if (!ctx.length) return nextPrompt;

  return [
    nextPrompt,
    '',
    'Context from last decision:',
    ...ctx.map((line) => `- ${line}`),
  ].join('\n');
}

function ensureExplanation(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  if (typeof decision.explanation === 'string' && decision.explanation.trim()) return decision;

  const source = [decision.summary, decision.final_result, decision.next_prompt]
    .find((v) => typeof v === 'string' && v.trim());

  return {
    ...decision,
    explanation: source ? source.trim() : 'No explanation provided.'
  };
}

module.exports = {
  sleep,
  appendTail,
  truncateForTrace,
  randomId,
  extractJson,
  extractJsonLast,
  truncateForPrompt,
  ensureNextPrompt,
  buildNextPromptWithDecisionContext,
  ensureExplanation,
};

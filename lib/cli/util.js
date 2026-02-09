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

function truncateForTemporalTrace(str, maxChars = 2000) {
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

module.exports = {
  sleep,
  appendTail,
  truncateForTemporalTrace,
  randomId,
  extractJson,
  extractJsonLast,
};


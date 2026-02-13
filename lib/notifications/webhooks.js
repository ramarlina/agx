'use strict';

const { loadConfig } = require('../cli/configStore');

const SUPPORTED_EVENTS = Object.freeze([
  'task.created',
  'task.stage_complete',
  'task.completed',
  'task.failed',
  'task.blocked',
]);

const WILDCARD_EVENT = '*';

function normalizeEventName(value) {
  if (!value && value !== 0) return '';
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return '';
  if (candidate === WILDCARD_EVENT) return WILDCARD_EVENT;
  if (candidate.endsWith('.*')) {
    return candidate;
  }
  return SUPPORTED_EVENTS.includes(candidate) ? candidate : '';
}

function normalizeEventsInput(value) {
  if (value === undefined || value === null) {
    return [WILDCARD_EVENT];
  }
  const parts = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeEventName(item);
      if (normalized) parts.push(normalized);
    }
  } else if (typeof value === 'string') {
    for (const item of value.split(',')) {
      const normalized = normalizeEventName(item);
      if (normalized) parts.push(normalized);
    }
  }
  if (parts.length === 0) {
    return [WILDCARD_EVENT];
  }
  return Array.from(new Set(parts));
}

function normalizeWebhookEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!url) return null;
  const events = normalizeEventsInput(entry.events);
  if (!events.length) return null;
  return { url, events };
}

function parseWebhookEntries(config) {
  const source = config ?? loadConfig();
  if (!source || !Array.isArray(source.webhooks)) return [];
  return source.webhooks
    .map(normalizeWebhookEntry)
    .filter((entry) => entry !== null);
}

function eventMatches(entry, eventName) {
  if (!entry || !eventName) return false;
  const normalized = String(eventName).trim().toLowerCase();
  if (!normalized) return false;
  if (!Array.isArray(entry.events)) return false;
  if (entry.events.includes(WILDCARD_EVENT)) return true;
  if (entry.events.includes(normalized)) return true;
  return entry.events.some((event) => event.endsWith('.*') && normalized.startsWith(event.slice(0, -1)));
}

async function sendWebhookEvent(eventName, payload = null, options = {}) {
  const normalizedEvent = normalizeEventName(eventName);
  if (!normalizedEvent) return [];

  const entries = Array.isArray(options.webhooks)
    ? options.webhooks
    : parseWebhookEntries(options.config);

  if (!entries.length) return [];

  const matches = entries.filter((entry) => eventMatches(entry, normalizedEvent));
  if (!matches.length) return [];

  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return matches;

  const timestamp = options.timestamp || new Date().toISOString();
  const body = JSON.stringify({ event: normalizedEvent, timestamp, payload });
  const logger = options.logger || console;

  const results = await Promise.allSettled(
    matches.map((match) => fetchFn(match.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AGX-Event': normalizedEvent,
      },
      body,
    }))
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      if (logger && typeof logger.error === 'function') {
        logger.error(`Webhook failed (${matches[index].url}): ${String(result.reason)}`);
      }
    }
  });

  return matches;
}

module.exports = {
  SUPPORTED_EVENTS,
  normalizeWebhookEntry,
  parseWebhookEntries,
  eventMatches,
  sendWebhookEvent,
};

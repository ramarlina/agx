'use strict';

const { createHttpClient, createTemporalClient } = require('./httpClient');

function createOrchestrator(config) {
  // Now using pg-boss based orchestrator (HTTP client)
  return createHttpClient(config);
}

module.exports = {
  createOrchestrator,
  // Re-export for backward compatibility
  createTemporalClient,
  createHttpClient,
};

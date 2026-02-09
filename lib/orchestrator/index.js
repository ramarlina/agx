'use strict';

const { createHttpClient } = require('./httpClient');

function createOrchestrator(config) {
  // Now using pg-boss based orchestrator (HTTP client)
  return createHttpClient(config);
}

module.exports = {
  createOrchestrator,
  createHttpClient,
};

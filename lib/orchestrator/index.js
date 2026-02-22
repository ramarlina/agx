'use strict';

const { createHttpClient } = require('./httpClient');

function createOrchestrator(config) {
  return createHttpClient(config);
}

module.exports = {
  createOrchestrator,
  createHttpClient,
};

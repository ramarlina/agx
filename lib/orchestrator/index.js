'use strict';

const { createTemporalClient } = require('./temporalClient');

function createOrchestrator(config) {
  const strategy = (process.env.AGX_ORCHESTRATOR || 'temporal').toLowerCase();

  if (strategy !== 'temporal') {
    throw new Error(`Unsupported orchestrator strategy: ${strategy}. Legacy mode has been removed.`);
  }

  return createTemporalClient(config);
}

module.exports = {
  createOrchestrator,
};

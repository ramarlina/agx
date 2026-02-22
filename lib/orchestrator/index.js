'use strict';

const { createHttpClient } = require('./httpClient');
const { insertMemory, getMemoriesByTask, getMemoriesByAgent } = require('../storage/db');
const crypto = require('crypto');

const ALLOWED_MEMORY_TYPES = new Set(['outcome', 'decision', 'pattern', 'gotcha']);

function createOrchestrator(config) {
  return createHttpClient(config);
}

/**
 * Attach /api/memories REST routes to an express-compatible app.
 * POST /api/memories        - write a memory (idempotent)
 * GET  /api/memories        - read memories by task_id or agent_id query param
 *
 * @param {object} app - Express app or router
 */
function attachMemoryRoutes(app) {
  // POST /api/memories
  app.post('/api/memories', (req, res) => {
    const { agent_id, task_id, memory_type, content } = req.body || {};

    if (!agent_id || !task_id || !memory_type || !content) {
      return res.status(400).json({ error: 'Missing required fields: agent_id, task_id, memory_type, content' });
    }

    if (!ALLOWED_MEMORY_TYPES.has(memory_type)) {
      return res.status(400).json({
        error: `Invalid memory_type: ${memory_type}. Must be one of: ${[...ALLOWED_MEMORY_TYPES].join(', ')}`,
      });
    }

    try {
      const id = crypto.randomUUID();
      const inserted = insertMemory({ id, agent_id, task_id, memory_type, content });
      const status = inserted ? 201 : 200;
      return res.status(status).json({ ok: true, inserted });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/memories?task_id=... or ?agent_id=...
  app.get('/api/memories', (req, res) => {
    const { task_id, agent_id } = req.query || {};

    if (!task_id && !agent_id) {
      return res.status(400).json({ error: 'Query param task_id or agent_id is required' });
    }

    try {
      const rows = task_id ? getMemoriesByTask(task_id) : getMemoriesByAgent(agent_id);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  createOrchestrator,
  createHttpClient,
  attachMemoryRoutes,
};

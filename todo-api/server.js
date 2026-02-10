import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import ResolutionWorker from './workers/resolution-worker.js';
import ReputationCalcWorker from './workers/reputation-calc-worker.js';
import SignalsAggregateWorker from './workers/signals-aggregate-worker.js';
import PredictionStore from './stores/prediction-store.js';

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage
const todos = new Map();

// Prediction store and resolution worker
const predictionStore = new PredictionStore();
const resolutionWorker = new ResolutionWorker({
  dataStore: predictionStore,
  pollInterval: 30000 // Check every 30 seconds
});

// Reputation calculation worker
const reputationCalcWorker = new ReputationCalcWorker({
  dataStore: predictionStore,
  resolutionWorker: resolutionWorker
});

// Signals aggregation worker
const signalsAggregateWorker = new SignalsAggregateWorker({
  dataStore: predictionStore,
  reputationWorker: reputationCalcWorker,
  pollInterval: 300000 // Aggregate every 5 minutes
});

// In-memory storage for token signals with multi-agent convergence
const tokenSignals = new Map([
  ['ETH', {
    symbol: 'ETH',
    name: 'Ethereum',
    convergence: 3,
    maxAgents: 3,
    agents: ['claude', 'gemini', 'ollama'],
    lastUpdated: new Date().toISOString(),
    score: 1.0
  }],
  ['USDC', {
    symbol: 'USDC',
    name: 'USD Coin',
    convergence: 2,
    maxAgents: 3,
    agents: ['claude', 'gemini'],
    lastUpdated: new Date().toISOString(),
    score: 0.67
  }],
  ['LINK', {
    symbol: 'LINK',
    name: 'Chainlink',
    convergence: 3,
    maxAgents: 3,
    agents: ['claude', 'gemini', 'ollama'],
    lastUpdated: new Date().toISOString(),
    score: 1.0
  }],
  ['ARB', {
    symbol: 'ARB',
    name: 'Arbitrum',
    convergence: 1,
    maxAgents: 3,
    agents: ['claude'],
    lastUpdated: new Date().toISOString(),
    score: 0.33
  }]
]);

// In-memory storage for agent performance metrics
const agentPerformance = new Map([
  ['claude', {
    agent: 'claude',
    type: 'claude',
    wins: 152,
    totalSignals: 187,
    convergenceRate: 0.813,
    averageAccuracy: 0.892,
    lastUpdated: new Date().toISOString()
  }],
  ['gemini', {
    agent: 'gemini',
    type: 'gemini',
    wins: 128,
    totalSignals: 162,
    convergenceRate: 0.790,
    averageAccuracy: 0.854,
    lastUpdated: new Date().toISOString()
  }],
  ['ollama', {
    agent: 'ollama',
    type: 'ollama',
    wins: 95,
    totalSignals: 140,
    convergenceRate: 0.679,
    averageAccuracy: 0.761,
    lastUpdated: new Date().toISOString()
  }]
]);

// In-memory storage for token API call stats
const tokenCallStats = new Map([
  ['ETH', { symbol: 'ETH', totalCalls: 145, lastCalled: new Date().toISOString() }],
  ['USDC', { symbol: 'USDC', totalCalls: 89, lastCalled: new Date().toISOString() }],
  ['LINK', { symbol: 'LINK', totalCalls: 112, lastCalled: new Date().toISOString() }],
  ['ARB', { symbol: 'ARB', totalCalls: 34, lastCalled: new Date().toISOString() }]
]);

// In-memory storage for blockchain domains
const domains = new Map([
  ['ethereum', {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    type: 'L1',
    nativeToken: 'ETH',
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/',
    blockExplorer: 'https://etherscan.io',
    agentCoverage: 3,
    maxAgents: 3,
    agents: ['claude', 'gemini', 'ollama'],
    supportedTokens: ['ETH', 'USDC', 'LINK', 'ARB'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }],
  ['base', {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    type: 'L2',
    nativeToken: 'ETH',
    rpcUrl: 'https://base-mainnet.g.alchemy.com/v2/',
    blockExplorer: 'https://basescan.org',
    agentCoverage: 2,
    maxAgents: 3,
    agents: ['claude', 'gemini'],
    supportedTokens: ['USDC', 'LINK'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }],
  ['solana', {
    id: 'solana',
    name: 'Solana',
    chainId: null,
    type: 'L1',
    nativeToken: 'SOL',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    blockExplorer: 'https://solscan.io',
    agentCoverage: 2,
    maxAgents: 3,
    agents: ['claude', 'ollama'],
    supportedTokens: ['SOL', 'USDC'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }],
  ['arbitrum', {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainId: 42161,
    type: 'L2',
    nativeToken: 'ETH',
    rpcUrl: 'https://arb-mainnet.g.alchemy.com/v2/',
    blockExplorer: 'https://arbiscan.io',
    agentCoverage: 3,
    maxAgents: 3,
    agents: ['claude', 'gemini', 'ollama'],
    supportedTokens: ['ETH', 'ARB', 'USDC', 'LINK'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }],
  ['optimism', {
    id: 'optimism',
    name: 'Optimism',
    chainId: 10,
    type: 'L2',
    nativeToken: 'ETH',
    rpcUrl: 'https://opt-mainnet.g.alchemy.com/v2/',
    blockExplorer: 'https://optimistic.etherscan.io',
    agentCoverage: 2,
    maxAgents: 3,
    agents: ['claude', 'gemini'],
    supportedTokens: ['ETH', 'USDC', 'OP'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }],
  ['polygon', {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    type: 'L2',
    nativeToken: 'MATIC',
    rpcUrl: 'https://polygon-mainnet.g.alchemy.com/v2/',
    blockExplorer: 'https://polygonscan.com',
    agentCoverage: 1,
    maxAgents: 3,
    agents: ['claude'],
    supportedTokens: ['MATIC', 'USDC'],
    lastUpdated: new Date().toISOString(),
    isActive: true
  }]
]);

// Middleware
app.use(express.json());

// Custom error class for API errors
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

// Validation helpers
function validateTodoInput(body, isUpdate = false) {
  const errors = [];

  if (!isUpdate && !body.title) {
    errors.push({ field: 'title', message: 'Title is required' });
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      errors.push({ field: 'title', message: 'Title must be a string' });
    } else if (body.title.trim().length === 0) {
      errors.push({ field: 'title', message: 'Title cannot be empty' });
    } else if (body.title.length > 200) {
      errors.push({ field: 'title', message: 'Title must be 200 characters or less' });
    }
  }

  if (body.completed !== undefined && typeof body.completed !== 'boolean') {
    errors.push({ field: 'completed', message: 'Completed must be a boolean' });
  }

  if (body.priority !== undefined) {
    const validPriorities = ['low', 'medium', 'high'];
    if (!validPriorities.includes(body.priority)) {
      errors.push({ field: 'priority', message: `Priority must be one of: ${validPriorities.join(', ')}` });
    }
  }

  return errors;
}

function validateUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Routes

// GET /todos - List all todos
app.get('/todos', asyncHandler(async (req, res) => {
  const { completed, priority } = req.query;
  let result = Array.from(todos.values());

  // Filter by completed status
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    result = result.filter(t => t.completed === isCompleted);
  }

  // Filter by priority
  if (priority) {
    if (!['low', 'medium', 'high'].includes(priority)) {
      throw new ApiError(400, 'Invalid priority filter', {
        field: 'priority',
        allowed: ['low', 'medium', 'high']
      });
    }
    result = result.filter(t => t.priority === priority);
  }

  // Sort by createdAt descending
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    success: true,
    count: result.length,
    data: result
  });
}));

// GET /todos/:id - Get single todo
app.get('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  res.json({
    success: true,
    data: todo
  });
}));

// POST /todos - Create new todo
app.post('/todos', asyncHandler(async (req, res) => {
  const validationErrors = validateTodoInput(req.body);
  if (validationErrors.length > 0) {
    throw new ApiError(400, 'Validation failed', { errors: validationErrors });
  }

  const todo = {
    id: uuidv4(),
    title: req.body.title.trim(),
    completed: req.body.completed ?? false,
    priority: req.body.priority ?? 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  todos.set(todo.id, todo);

  res.status(201).json({
    success: true,
    message: 'Todo created successfully',
    data: todo
  });
}));

// PUT /todos/:id - Update todo
app.put('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  const validationErrors = validateTodoInput(req.body, true);
  if (validationErrors.length > 0) {
    throw new ApiError(400, 'Validation failed', { errors: validationErrors });
  }

  // Update fields
  if (req.body.title !== undefined) {
    todo.title = req.body.title.trim();
  }
  if (req.body.completed !== undefined) {
    todo.completed = req.body.completed;
  }
  if (req.body.priority !== undefined) {
    todo.priority = req.body.priority;
  }
  todo.updatedAt = new Date().toISOString();

  todos.set(id, todo);

  res.json({
    success: true,
    message: 'Todo updated successfully',
    data: todo
  });
}));

// PATCH /todos/:id/toggle - Toggle completed status
app.patch('/todos/:id/toggle', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  const todo = todos.get(id);
  if (!todo) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  todo.completed = !todo.completed;
  todo.updatedAt = new Date().toISOString();

  todos.set(id, todo);

  res.json({
    success: true,
    message: `Todo marked as ${todo.completed ? 'completed' : 'incomplete'}`,
    data: todo
  });
}));

// DELETE /todos/:id - Delete todo
app.delete('/todos/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid todo ID format');
  }

  if (!todos.has(id)) {
    throw new ApiError(404, 'Todo not found', { id });
  }

  todos.delete(id);

  res.json({
    success: true,
    message: 'Todo deleted successfully'
  });
}));

// DELETE /todos - Delete all completed todos
app.delete('/todos', asyncHandler(async (req, res) => {
  const { completed } = req.query;

  if (completed !== 'true') {
    throw new ApiError(400, 'Must specify ?completed=true to delete completed todos');
  }

  let deletedCount = 0;
  for (const [id, todo] of todos) {
    if (todo.completed) {
      todos.delete(id);
      deletedCount++;
    }
  }

  res.json({
    success: true,
    message: `Deleted ${deletedCount} completed todo(s)`,
    deletedCount
  });
}));

// Helper function to track and update token call stats
function trackTokenCall(symbol) {
  if (tokenCallStats.has(symbol)) {
    const stats = tokenCallStats.get(symbol);
    stats.totalCalls += 1;
    stats.lastCalled = new Date().toISOString();
  }
}

// GET /tokens - List all tokens with call stats
app.get('/tokens', asyncHandler(async (req, res) => {
  const { sortBy } = req.query;

  // Convert tokens map to array with call stats
  let tokens = Array.from(tokenSignals.values()).map(token => {
    const stats = tokenCallStats.get(token.symbol) || { totalCalls: 0, lastCalled: null };
    return {
      symbol: token.symbol,
      name: token.name,
      convergence: token.convergence,
      agentConsensus: `${token.convergence}/${token.maxAgents}`,
      agents: token.agents,
      convergenceScore: token.score.toFixed(2),
      lastUpdated: token.lastUpdated,
      callStats: {
        totalCalls: stats.totalCalls,
        lastCalled: stats.lastCalled
      }
    };
  });

  // Sort by requested criteria
  if (sortBy === 'calls') {
    tokens.sort((a, b) => b.callStats.totalCalls - a.callStats.totalCalls);
  } else if (sortBy === 'convergence') {
    tokens.sort((a, b) => b.convergence - a.convergence);
  } else {
    // Default: sort by convergence score descending
    tokens.sort((a, b) => parseFloat(b.convergenceScore) - parseFloat(a.convergenceScore));
  }

  trackTokenCall('ETH'); // Track this list call

  res.json({
    success: true,
    count: tokens.length,
    data: tokens
  });
}));

// GET /tokens/:symbol - Get single token detail with call stats
app.get('/tokens/:symbol', asyncHandler(async (req, res) => {
  const { symbol } = req.params;
  const upperSymbol = symbol.toUpperCase();

  if (!tokenSignals.has(upperSymbol)) {
    throw new ApiError(404, 'Token not found', { symbol: upperSymbol });
  }

  const token = tokenSignals.get(upperSymbol);
  const stats = tokenCallStats.get(upperSymbol) || { totalCalls: 0, lastCalled: null };

  // Track this call
  if (!tokenCallStats.has(upperSymbol)) {
    tokenCallStats.set(upperSymbol, { symbol: upperSymbol, totalCalls: 1, lastCalled: new Date().toISOString() });
  } else {
    trackTokenCall(upperSymbol);
  }

  res.json({
    success: true,
    data: {
      symbol: token.symbol,
      name: token.name,
      convergence: token.convergence,
      agentConsensus: `${token.convergence}/${token.maxAgents}`,
      agents: token.agents,
      convergenceScore: token.score.toFixed(2),
      lastUpdated: token.lastUpdated,
      callStats: {
        totalCalls: stats.totalCalls + 1,
        lastCalled: new Date().toISOString()
      }
    }
  });
}));

// GET /signals/hot_tokens - Get tokens with multi-agent convergence
app.get('/signals/hot_tokens', asyncHandler(async (req, res) => {
  const { minConvergence, sortBy } = req.query;

  // Convert tokens map to array
  let hotTokens = Array.from(tokenSignals.values());

  // Filter by minimum convergence if specified
  if (minConvergence !== undefined) {
    const minVal = parseInt(minConvergence);
    if (isNaN(minVal) || minVal < 1 || minVal > 3) {
      throw new ApiError(400, 'Invalid minConvergence value. Must be 1, 2, or 3', {
        field: 'minConvergence',
        allowed: [1, 2, 3]
      });
    }
    hotTokens = hotTokens.filter(token => token.convergence >= minVal);
  }

  // Sort by convergence score (descending) or by convergence count
  if (sortBy === 'convergence') {
    hotTokens.sort((a, b) => b.convergence - a.convergence);
  } else {
    // Default: sort by score descending, then by convergence count
    hotTokens.sort((a, b) => b.score - a.score || b.convergence - a.convergence);
  }

  res.json({
    success: true,
    count: hotTokens.length,
    totalAvailable: tokenSignals.size,
    data: hotTokens.map(token => ({
      symbol: token.symbol,
      name: token.name,
      convergence: token.convergence,
      agentConsensus: `${token.convergence}/${token.maxAgents}`,
      agents: token.agents,
      convergenceScore: token.score.toFixed(2),
      lastUpdated: token.lastUpdated
    }))
  });
}));

// GET /signals/best_performers - Get top winning agents
app.get('/signals/best_performers', asyncHandler(async (req, res) => {
  const { limit, sortBy, minAccuracy } = req.query;

  // Parse limit parameter (default 10, max 100)
  let limitVal = 10;
  if (limit !== undefined) {
    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ApiError(400, 'Invalid limit value. Must be between 1 and 100', {
        field: 'limit',
        min: 1,
        max: 100
      });
    }
    limitVal = parsedLimit;
  }

  // Parse minAccuracy parameter
  let minAccuracyVal = 0;
  if (minAccuracy !== undefined) {
    const parsedAccuracy = parseFloat(minAccuracy);
    if (isNaN(parsedAccuracy) || parsedAccuracy < 0 || parsedAccuracy > 1) {
      throw new ApiError(400, 'Invalid minAccuracy value. Must be between 0 and 1', {
        field: 'minAccuracy',
        min: 0,
        max: 1
      });
    }
    minAccuracyVal = parsedAccuracy;
  }

  // Convert agents map to array
  let agents = Array.from(agentPerformance.values());

  // Filter by minimum accuracy if specified
  if (minAccuracyVal > 0) {
    agents = agents.filter(agent => agent.averageAccuracy >= minAccuracyVal);
  }

  // Sort by wins (descending) or by accuracy
  if (sortBy === 'accuracy') {
    agents.sort((a, b) => b.averageAccuracy - a.averageAccuracy);
  } else if (sortBy === 'convergenceRate') {
    agents.sort((a, b) => b.convergenceRate - a.convergenceRate);
  } else {
    // Default: sort by wins descending
    agents.sort((a, b) => b.wins - a.wins);
  }

  // Apply limit
  const paginatedAgents = agents.slice(0, limitVal);

  res.json({
    success: true,
    count: paginatedAgents.length,
    totalAgents: agentPerformance.size,
    data: paginatedAgents.map(agent => ({
      agent: agent.agent,
      type: agent.type,
      wins: agent.wins,
      totalSignals: agent.totalSignals,
      winRate: (agent.wins / agent.totalSignals).toFixed(4),
      convergenceRate: agent.convergenceRate.toFixed(4),
      averageAccuracy: agent.averageAccuracy.toFixed(4),
      lastUpdated: agent.lastUpdated
    }))
  });
}));

// Prediction API endpoints

// GET /predictions - List all predictions
app.get('/predictions', asyncHandler(async (req, res) => {
  const { status, agent, symbol } = req.query;

  const predictions = await predictionStore.getPredictions({
    status,
    agent,
    symbol
  });

  res.json({
    success: true,
    count: predictions.length,
    data: predictions
  });
}));

// GET /predictions/stats - Get prediction statistics
app.get('/predictions/stats', asyncHandler(async (req, res) => {
  const stats = await predictionStore.getStats();

  res.json({
    success: true,
    data: stats
  });
}));

// GET /predictions/:id - Get single prediction
app.get('/predictions/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid prediction ID format');
  }

  const prediction = await predictionStore.getPrediction(id);
  if (!prediction) {
    throw new ApiError(404, 'Prediction not found', { id });
  }

  res.json({
    success: true,
    data: prediction
  });
}));

// POST /predictions - Create new prediction
app.post('/predictions', asyncHandler(async (req, res) => {
  const { agent, symbol, predictedValue, lockTime, metadata } = req.body;

  // Validation
  const errors = [];
  if (!agent) errors.push({ field: 'agent', message: 'Agent is required' });
  if (!symbol) errors.push({ field: 'symbol', message: 'Symbol is required' });
  if (predictedValue === undefined) errors.push({ field: 'predictedValue', message: 'Predicted value is required' });
  if (!lockTime) errors.push({ field: 'lockTime', message: 'Lock time is required' });

  if (lockTime) {
    const lockDate = new Date(lockTime);
    if (isNaN(lockDate.getTime())) {
      errors.push({ field: 'lockTime', message: 'Invalid lock time format' });
    } else if (lockDate <= new Date()) {
      errors.push({ field: 'lockTime', message: 'Lock time must be in the future' });
    }
  }

  if (errors.length > 0) {
    throw new ApiError(400, 'Validation failed', { errors });
  }

  const prediction = await predictionStore.createPrediction({
    agent,
    symbol,
    predictedValue,
    lockTime,
    metadata
  });

  res.status(201).json({
    success: true,
    message: 'Prediction created successfully',
    data: prediction
  });
}));

// PUT /predictions/:id/outcome - Set actual outcome
app.put('/predictions/:id/outcome', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { actualOutcome } = req.body;

  if (!validateUUID(id)) {
    throw new ApiError(400, 'Invalid prediction ID format');
  }

  if (actualOutcome === undefined) {
    throw new ApiError(400, 'Actual outcome is required', {
      field: 'actualOutcome'
    });
  }

  const prediction = await predictionStore.setOutcome(id, actualOutcome);

  res.json({
    success: true,
    message: 'Outcome updated successfully',
    data: prediction
  });
}));

// GET /worker/status - Get resolution worker status
app.get('/worker/status', asyncHandler(async (req, res) => {
  const status = resolutionWorker.getStatus();

  res.json({
    success: true,
    data: status
  });
}));

// GET /workers/reputation/status - Get reputation worker status
app.get('/workers/reputation/status', asyncHandler(async (req, res) => {
  const status = reputationCalcWorker.getStatus();

  res.json({
    success: true,
    data: status
  });
}));

// GET /agents/:name/reputation - Get agent reputation metrics
app.get('/agents/:name/reputation', asyncHandler(async (req, res) => {
  const { name } = req.params;

  const reputation = await reputationCalcWorker.getAgentReputation(name);

  if (!reputation) {
    throw new ApiError(404, 'Agent not found or has no resolved predictions', { agent: name });
  }

  res.json({
    success: true,
    data: {
      agent: name,
      ...reputation
    }
  });
}));

// GET /agents/reputations - Get all agent reputations
app.get('/agents/reputations', asyncHandler(async (req, res) => {
  const reputations = await reputationCalcWorker.getAllReputations();

  const data = Object.entries(reputations).map(([agent, metrics]) => ({
    agent,
    ...metrics
  }));

  res.json({
    success: true,
    count: data.length,
    data
  });
}));

// Signals Aggregation API endpoints

// GET /signals/aggregate - Get all aggregated signals
app.get('/signals/aggregate', asyncHandler(async (req, res) => {
  const signals = signalsAggregateWorker.getSignals();

  res.json({
    success: true,
    data: signals
  });
}));

// GET /signals/gems - Get gems (biggest multiples)
app.get('/signals/gems', asyncHandler(async (req, res) => {
  const { limit } = req.query;
  let gems = signalsAggregateWorker.getSignal('gems');

  // Apply limit if specified
  if (limit !== undefined) {
    const limitVal = parseInt(limit);
    if (isNaN(limitVal) || limitVal < 1 || limitVal > 100) {
      throw new ApiError(400, 'Invalid limit value. Must be between 1 and 100', {
        field: 'limit',
        min: 1,
        max: 100
      });
    }
    gems = gems.slice(0, limitVal);
  }

  res.json({
    success: true,
    count: gems.length,
    data: gems
  });
}));

// GET /signals/hot_tokens_aggregate - Get hot tokens from aggregator
app.get('/signals/hot_tokens_aggregate', asyncHandler(async (req, res) => {
  const { minConvergence } = req.query;
  let hotTokens = signalsAggregateWorker.getSignal('hot_tokens');

  // Filter by minimum convergence if specified
  if (minConvergence !== undefined) {
    const minVal = parseInt(minConvergence);
    if (isNaN(minVal) || minVal < 1 || minVal > 3) {
      throw new ApiError(400, 'Invalid minConvergence value. Must be 1, 2, or 3', {
        field: 'minConvergence',
        allowed: [1, 2, 3]
      });
    }
    hotTokens = hotTokens.filter(token => token.convergence >= minVal);
  }

  res.json({
    success: true,
    count: hotTokens.length,
    data: hotTokens
  });
}));

// GET /signals/best_performers_aggregate - Get best performers from aggregator
app.get('/signals/best_performers_aggregate', asyncHandler(async (req, res) => {
  const { limit, minWinRate } = req.query;
  let performers = signalsAggregateWorker.getSignal('best_performers');

  // Filter by minimum win rate if specified
  if (minWinRate !== undefined) {
    const minVal = parseFloat(minWinRate);
    if (isNaN(minVal) || minVal < 0 || minVal > 1) {
      throw new ApiError(400, 'Invalid minWinRate value. Must be between 0 and 1', {
        field: 'minWinRate',
        min: 0,
        max: 1
      });
    }
    performers = performers.filter(p => p.winRate >= minVal);
  }

  // Apply limit if specified
  if (limit !== undefined) {
    const limitVal = parseInt(limit);
    if (isNaN(limitVal) || limitVal < 1 || limitVal > 100) {
      throw new ApiError(400, 'Invalid limit value. Must be between 1 and 100', {
        field: 'limit',
        min: 1,
        max: 100
      });
    }
    performers = performers.slice(0, limitVal);
  }

  res.json({
    success: true,
    count: performers.length,
    data: performers
  });
}));

// GET /signals/recent_exits - Get recently resolved predictions
app.get('/signals/recent_exits', asyncHandler(async (req, res) => {
  const { limit, status } = req.query;
  let recentExits = signalsAggregateWorker.getSignal('recent_exits');

  // Filter by status if specified
  if (status) {
    if (!['correct', 'incorrect'].includes(status)) {
      throw new ApiError(400, 'Invalid status value. Must be correct or incorrect', {
        field: 'status',
        allowed: ['correct', 'incorrect']
      });
    }
    recentExits = recentExits.filter(exit => exit.status === status);
  }

  // Apply limit if specified
  if (limit !== undefined) {
    const limitVal = parseInt(limit);
    if (isNaN(limitVal) || limitVal < 1 || limitVal > 100) {
      throw new ApiError(400, 'Invalid limit value. Must be between 1 and 100', {
        field: 'limit',
        min: 1,
        max: 100
      });
    }
    recentExits = recentExits.slice(0, limitVal);
  }

  res.json({
    success: true,
    count: recentExits.length,
    data: recentExits
  });
}));

// GET /workers/signals-aggregate/status - Get signals aggregate worker status
app.get('/workers/signals-aggregate/status', asyncHandler(async (req, res) => {
  const status = signalsAggregateWorker.getStatus();

  res.json({
    success: true,
    data: status
  });
}));

// GET /domains - List all blockchain domains
app.get('/domains', asyncHandler(async (req, res) => {
  const { type, activeOnly, sortBy } = req.query;

  // Convert domains map to array
  let domainsList = Array.from(domains.values());

  // Filter by active status if specified
  if (activeOnly === 'true') {
    domainsList = domainsList.filter(d => d.isActive === true);
  }

  // Filter by type if specified (L1 or L2)
  if (type) {
    if (!['L1', 'L2'].includes(type.toUpperCase())) {
      throw new ApiError(400, 'Invalid type filter. Must be L1 or L2', {
        field: 'type',
        allowed: ['L1', 'L2']
      });
    }
    domainsList = domainsList.filter(d => d.type === type.toUpperCase());
  }

  // Sort by requested criteria
  if (sortBy === 'agents') {
    domainsList.sort((a, b) => b.agentCoverage - a.agentCoverage);
  } else if (sortBy === 'name') {
    domainsList.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Default: sort by agent coverage descending
    domainsList.sort((a, b) => b.agentCoverage - a.agentCoverage);
  }

  res.json({
    success: true,
    count: domainsList.length,
    data: domainsList
  });
}));

// GET /domains/:id - Get single domain detail
app.get('/domains/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const domainId = id.toLowerCase();

  if (!domains.has(domainId)) {
    throw new ApiError(404, 'Domain not found', { id: domainId });
  }

  const domain = domains.get(domainId);

  res.json({
    success: true,
    data: domain
  });
}));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    workers: {
      resolution: resolutionWorker.getStatus(),
      reputation: reputationCalcWorker.getStatus(),
      signalsAggregate: signalsAggregateWorker.getStatus()
    }
  });
});

// 404 handler for unknown routes
app.use((req, res, next) => {
  throw new ApiError(404, `Route ${req.method} ${req.path} not found`);
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error for debugging
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${new Date().toISOString()}] Error:`, err);
  }

  // Handle JSON parse errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      message: err.message
    });
  }

  // Handle our custom API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // Handle unexpected errors
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  resolutionWorker.stop();
  reputationCalcWorker.stop();
  signalsAggregateWorker.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  resolutionWorker.stop();
  reputationCalcWorker.stop();
  signalsAggregateWorker.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, () => {
  console.log(`Todo API server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET    /health                       - Health check');
  console.log('  GET    /signals/hot_tokens           - Get hot tokens with multi-agent convergence');
  console.log('  GET    /signals/best_performers      - Get top winning agents');
  console.log('  GET    /predictions                  - List all predictions');
  console.log('  GET    /predictions/stats            - Get prediction statistics');
  console.log('  GET    /predictions/:id              - Get single prediction');
  console.log('  POST   /predictions                  - Create prediction');
  console.log('  PUT    /predictions/:id/outcome      - Set actual outcome');
  console.log('  GET    /worker/status                - Get resolution worker status');
  console.log('  GET    /workers/reputation/status    - Get reputation worker status');
  console.log('  GET    /workers/signals-aggregate/status - Get signals aggregate worker status');
  console.log('  GET    /signals/aggregate            - Get all aggregated signals');
  console.log('  GET    /signals/gems                 - Get gems (biggest multiples)');
  console.log('  GET    /signals/hot_tokens_aggregate - Get hot tokens (computed)');
  console.log('  GET    /signals/best_performers_aggregate - Get best performers (computed)');
  console.log('  GET    /signals/recent_exits         - Get recently resolved predictions');
  console.log('  GET    /agents/:name/reputation      - Get agent reputation metrics');
  console.log('  GET    /agents/reputations           - Get all agent reputations');
  console.log('  GET    /tokens                       - List all tokens with call stats');
  console.log('  GET    /tokens/:symbol               - Get single token with call stats');
  console.log('  GET    /todos                        - List all todos');
  console.log('  GET    /todos/:id                    - Get single todo');
  console.log('  POST   /todos                        - Create todo');
  console.log('  PUT    /todos/:id                    - Update todo');
  console.log('  PATCH  /todos/:id/toggle             - Toggle completed');
  console.log('  DELETE /todos/:id                    - Delete todo');
  console.log('  DELETE /todos?completed=true         - Delete all completed');
  console.log('');

  // Start the resolution worker
  console.log('Starting resolution worker...');
  resolutionWorker.start();

  // Log worker events
  resolutionWorker.on('started', () => {
    console.log('[ResolutionWorker] Started successfully');
  });

  resolutionWorker.on('batchComplete', (results) => {
    if (results.processed > 0) {
      console.log(`[ResolutionWorker] Processed ${results.processed} predictions (${results.correct} correct, ${results.incorrect} incorrect)`);
    }
  });

  resolutionWorker.on('error', (err) => {
    console.error('[ResolutionWorker] Error:', err);
  });

  // Start the reputation calculation worker
  console.log('Starting reputation calculation worker...');
  reputationCalcWorker.start();

  // Log reputation worker events
  reputationCalcWorker.on('started', () => {
    console.log('[ReputationCalcWorker] Started successfully');
  });

  reputationCalcWorker.on('reputationUpdated', (event) => {
    console.log(`[ReputationCalcWorker] Updated ${event.agent}: winRate=${event.reputation.winRate}, avgMultiple=${event.reputation.avgMultiple}, totalCalls=${event.reputation.totalCalls}`);
  });

  reputationCalcWorker.on('error', (err) => {
    console.error('[ReputationCalcWorker] Error:', err);
  });

  // Start the signals aggregation worker
  console.log('Starting signals aggregation worker...');
  signalsAggregateWorker.start();

  // Log signals worker events
  signalsAggregateWorker.on('started', () => {
    console.log('[SignalsAggregateWorker] Started successfully');
  });

  signalsAggregateWorker.on('aggregationComplete', (cache) => {
    console.log(`[SignalsAggregateWorker] Aggregation complete: gems=${cache.gems.length}, hot_tokens=${cache.hot_tokens.length}, best_performers=${cache.best_performers.length}, recent_exits=${cache.recent_exits.length}`);
  });

  signalsAggregateWorker.on('error', (err) => {
    console.error('[SignalsAggregateWorker] Error:', err);
  });
});

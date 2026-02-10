/**
 * Reputation Calculation Worker
 *
 * Listens for prediction resolution events and recomputes agent reputation metrics:
 * - Win rate: percentage of correct predictions
 * - Average multiple: avg(predicted_value / actual_outcome)
 * - Total calls: total number of predictions made
 *
 * Subscribes to ResolutionWorker events to update metrics in real-time.
 */

import { EventEmitter } from 'events';

class ReputationCalcWorker extends EventEmitter {
  constructor(options = {}) {
    super();

    this.dataStore = options.dataStore; // Injected data store
    this.resolutionWorker = options.resolutionWorker; // Resolution worker to subscribe to
    this.isRunning = false;

    // In-memory cache of agent reputations
    // Map<agentName, { winRate, avgMultiple, totalCalls, correctCalls, incorrectCalls }>
    this.reputationCache = new Map();
  }

  /**
   * Start the worker
   */
  start() {
    if (this.isRunning) {
      console.log('[ReputationCalcWorker] Already running');
      return;
    }

    if (!this.resolutionWorker) {
      throw new Error('ResolutionWorker is required to subscribe to events');
    }

    console.log('[ReputationCalcWorker] Starting...');
    this.isRunning = true;

    // Subscribe to resolution events
    this.resolutionWorker.on('predictionResolved', this._onPredictionResolved.bind(this));
    this.resolutionWorker.on('batchComplete', this._onBatchComplete.bind(this));

    // Initialize reputation cache from existing data
    this._initializeReputations().catch(err => {
      console.error('[ReputationCalcWorker] Error initializing reputations:', err);
      this.emit('error', err);
    });

    this.emit('started');
  }

  /**
   * Stop the worker
   */
  stop() {
    if (!this.isRunning) {
      console.log('[ReputationCalcWorker] Not running');
      return;
    }

    console.log('[ReputationCalcWorker] Stopping...');
    this.isRunning = false;

    // Unsubscribe from events
    if (this.resolutionWorker) {
      this.resolutionWorker.off('predictionResolved', this._onPredictionResolved.bind(this));
      this.resolutionWorker.off('batchComplete', this._onBatchComplete.bind(this));
    }

    this.emit('stopped');
  }

  /**
   * Initialize reputation cache from all resolved predictions
   * @private
   */
  async _initializeReputations() {
    console.log('[ReputationCalcWorker] Initializing reputation cache...');

    try {
      const predictions = await this.dataStore.getPredictions();
      const resolvedPredictions = predictions.filter(p => p.status !== 'pending');

      // Group by agent
      const agentPredictions = this._groupByAgent(resolvedPredictions);

      // Calculate reputation for each agent
      for (const [agent, preds] of Object.entries(agentPredictions)) {
        const reputation = this._calculateReputation(preds);
        this.reputationCache.set(agent, reputation);
        console.log(`[ReputationCalcWorker] Initialized ${agent}: ${JSON.stringify(reputation)}`);
      }

      console.log(`[ReputationCalcWorker] Initialized ${this.reputationCache.size} agent reputations`);
    } catch (err) {
      console.error('[ReputationCalcWorker] Failed to initialize reputations:', err);
      throw err;
    }
  }

  /**
   * Handle prediction resolution event
   * @private
   */
  async _onPredictionResolved(event) {
    const { predictionId } = event;

    try {
      // Get the full prediction to extract agent info
      const prediction = await this.dataStore.getPrediction(predictionId);
      if (!prediction) {
        console.warn(`[ReputationCalcWorker] Prediction ${predictionId} not found`);
        return;
      }

      // Recalculate reputation for this agent
      await this._updateAgentReputation(prediction.agent);

      this.emit('reputationUpdated', {
        agent: prediction.agent,
        predictionId,
        reputation: this.reputationCache.get(prediction.agent)
      });
    } catch (err) {
      console.error('[ReputationCalcWorker] Error handling prediction resolved:', err);
      this.emit('error', err);
    }
  }

  /**
   * Handle batch complete event
   * @private
   */
  async _onBatchComplete(results) {
    console.log('[ReputationCalcWorker] Batch complete, refreshing reputations');

    try {
      // Get all unique agents that had predictions resolved
      const predictions = await this.dataStore.getPredictions();
      const resolvedPredictions = predictions.filter(p => p.status !== 'pending');
      const agents = [...new Set(resolvedPredictions.map(p => p.agent))];

      // Update reputation for all agents
      for (const agent of agents) {
        await this._updateAgentReputation(agent);
      }

      this.emit('batchReputationUpdated', { agents, count: agents.length });
    } catch (err) {
      console.error('[ReputationCalcWorker] Error handling batch complete:', err);
      this.emit('error', err);
    }
  }

  /**
   * Update reputation for a specific agent
   * @private
   */
  async _updateAgentReputation(agent) {
    console.log(`[ReputationCalcWorker] Updating reputation for ${agent}`);

    // Get all resolved predictions for this agent
    const predictions = await this.dataStore.getPredictions({ agent });
    const resolvedPredictions = predictions.filter(p => p.status !== 'pending');

    if (resolvedPredictions.length === 0) {
      console.log(`[ReputationCalcWorker] No resolved predictions for ${agent}`);
      return;
    }

    // Calculate reputation
    const reputation = this._calculateReputation(resolvedPredictions);
    this.reputationCache.set(agent, reputation);

    console.log(`[ReputationCalcWorker] Updated ${agent}: ${JSON.stringify(reputation)}`);
  }

  /**
   * Calculate reputation metrics from predictions
   * @private
   * @param {Array} predictions - Resolved predictions
   * @returns {Object} Reputation metrics
   */
  _calculateReputation(predictions) {
    const totalCalls = predictions.length;
    const correctCalls = predictions.filter(p => p.wasCorrect === true).length;
    const incorrectCalls = predictions.filter(p => p.wasCorrect === false).length;
    const winRate = totalCalls > 0 ? (correctCalls / totalCalls).toFixed(4) : 0;

    // Calculate average multiple (predicted / actual)
    // Only for numeric predictions
    const numericPredictions = predictions.filter(
      p =>
        typeof p.predictedValue === 'number' &&
        typeof p.actualOutcome === 'number' &&
        p.actualOutcome !== 0
    );

    let avgMultiple = null;
    if (numericPredictions.length > 0) {
      const multiples = numericPredictions.map(p => p.predictedValue / p.actualOutcome);
      const sum = multiples.reduce((acc, val) => acc + val, 0);
      avgMultiple = (sum / multiples.length).toFixed(4);
    }

    return {
      winRate: parseFloat(winRate),
      avgMultiple: avgMultiple !== null ? parseFloat(avgMultiple) : null,
      totalCalls,
      correctCalls,
      incorrectCalls
    };
  }

  /**
   * Group predictions by agent
   * @private
   */
  _groupByAgent(predictions) {
    const grouped = {};

    for (const prediction of predictions) {
      if (!grouped[prediction.agent]) {
        grouped[prediction.agent] = [];
      }
      grouped[prediction.agent].push(prediction);
    }

    return grouped;
  }

  /**
   * Get reputation for a specific agent
   * @param {string} agent - Agent name
   * @returns {Object|null} Reputation metrics or null if not found
   */
  async getAgentReputation(agent) {
    // Check cache first
    if (this.reputationCache.has(agent)) {
      return this.reputationCache.get(agent);
    }

    // Calculate on-demand if not in cache
    const predictions = await this.dataStore.getPredictions({ agent });
    const resolvedPredictions = predictions.filter(p => p.status !== 'pending');

    if (resolvedPredictions.length === 0) {
      return null;
    }

    const reputation = this._calculateReputation(resolvedPredictions);
    this.reputationCache.set(agent, reputation);
    return reputation;
  }

  /**
   * Get all agent reputations
   * @returns {Object} Map of agent -> reputation
   */
  async getAllReputations() {
    const result = {};

    for (const [agent, reputation] of this.reputationCache.entries()) {
      result[agent] = reputation;
    }

    return result;
  }

  /**
   * Get worker status
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      cachedAgents: this.reputationCache.size,
      agents: Array.from(this.reputationCache.keys())
    };
  }
}

export default ReputationCalcWorker;

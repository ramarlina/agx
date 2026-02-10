/**
 * Signals Aggregate Worker
 *
 * Periodically computes and caches aggregated signal data:
 * - gems: predictions with biggest multiples (predicted/actual ratios)
 * - hot_tokens: tokens with multi-agent convergence
 * - best_performers: top-performing agents by win rate
 * - recent_exits: recently resolved predictions
 *
 * Runs every 5 minutes to keep signal data fresh.
 */

import { EventEmitter } from 'events';

class SignalsAggregateWorker extends EventEmitter {
  constructor(options = {}) {
    super();

    this.pollInterval = options.pollInterval || 300000; // 5 minutes default
    this.dataStore = options.dataStore; // Injected prediction store
    this.reputationWorker = options.reputationWorker; // For accessing agent reputations
    this.isRunning = false;
    this.intervalId = null;

    // Cached aggregated data
    this.cache = {
      gems: [],
      hot_tokens: [],
      best_performers: [],
      recent_exits: [],
      lastUpdated: null
    };
  }

  /**
   * Start the worker
   */
  start() {
    if (this.isRunning) {
      console.log('[SignalsAggregateWorker] Already running');
      return;
    }

    console.log('[SignalsAggregateWorker] Starting...');
    this.isRunning = true;

    // Run immediately on start
    this._aggregateSignals().catch(err => {
      console.error('[SignalsAggregateWorker] Error on startup:', err);
      this.emit('error', err);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this._aggregateSignals().catch(err => {
        console.error('[SignalsAggregateWorker] Error during aggregation:', err);
        this.emit('error', err);
      });
    }, this.pollInterval);

    this.emit('started');
  }

  /**
   * Stop the worker
   */
  stop() {
    if (!this.isRunning) {
      console.log('[SignalsAggregateWorker] Not running');
      return;
    }

    console.log('[SignalsAggregateWorker] Stopping...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.emit('stopped');
  }

  /**
   * Aggregate all signals
   * @private
   */
  async _aggregateSignals() {
    const now = new Date();
    console.log(`[SignalsAggregateWorker] Aggregating signals at ${now.toISOString()}`);

    try {
      // Fetch all predictions
      const predictions = await this.dataStore.getPredictions();
      const resolvedPredictions = predictions.filter(p => p.status !== 'pending');

      // Compute each signal type
      const gems = this._computeGems(resolvedPredictions);
      const hot_tokens = this._computeHotTokens(predictions);
      const best_performers = await this._computeBestPerformers();
      const recent_exits = this._computeRecentExits(resolvedPredictions);

      // Update cache
      this.cache = {
        gems,
        hot_tokens,
        best_performers,
        recent_exits,
        lastUpdated: now.toISOString()
      };

      console.log('[SignalsAggregateWorker] Aggregation complete:', {
        gems: gems.length,
        hot_tokens: hot_tokens.length,
        best_performers: best_performers.length,
        recent_exits: recent_exits.length
      });

      this.emit('aggregationComplete', this.cache);
    } catch (err) {
      console.error('[SignalsAggregateWorker] Fatal error in aggregation:', err);
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Compute gems: predictions with biggest multiples
   * Only considers correct predictions with numeric values
   * @private
   */
  _computeGems(resolvedPredictions) {
    // Filter for numeric predictions that were correct
    const numericPredictions = resolvedPredictions.filter(
      p =>
        p.wasCorrect === true &&
        typeof p.predictedValue === 'number' &&
        typeof p.actualOutcome === 'number' &&
        p.actualOutcome !== 0 &&
        p.predictedValue > 0 &&
        p.actualOutcome > 0
    );

    // Calculate multiples
    const gemsWithMultiples = numericPredictions.map(p => {
      const multiple = p.predictedValue / p.actualOutcome;
      return {
        predictionId: p.id,
        agent: p.agent,
        symbol: p.symbol,
        predictedValue: p.predictedValue,
        actualOutcome: p.actualOutcome,
        multiple: parseFloat(multiple.toFixed(4)),
        resolvedAt: p.resolvedAt,
        metadata: p.metadata
      };
    });

    // Sort by multiple descending and take top 10
    gemsWithMultiples.sort((a, b) => b.multiple - a.multiple);
    return gemsWithMultiples.slice(0, 10);
  }

  /**
   * Compute hot tokens: symbols with multi-agent convergence
   * Groups predictions by symbol and counts unique agents
   * @private
   */
  _computeHotTokens(predictions) {
    // Group predictions by symbol
    const symbolGroups = {};

    for (const p of predictions) {
      if (!symbolGroups[p.symbol]) {
        symbolGroups[p.symbol] = {
          symbol: p.symbol,
          agents: new Set(),
          predictions: [],
          correctPredictions: 0,
          totalPredictions: 0
        };
      }

      symbolGroups[p.symbol].agents.add(p.agent);
      symbolGroups[p.symbol].predictions.push(p);
      symbolGroups[p.symbol].totalPredictions++;

      if (p.wasCorrect === true) {
        symbolGroups[p.symbol].correctPredictions++;
      }
    }

    // Convert to array and compute convergence metrics
    const hotTokens = Object.values(symbolGroups).map(group => {
      const agentCount = group.agents.size;
      const convergenceScore = agentCount / 3; // Assuming max 3 agents
      const accuracy = group.totalPredictions > 0
        ? group.correctPredictions / group.totalPredictions
        : 0;

      return {
        symbol: group.symbol,
        convergence: agentCount,
        agents: Array.from(group.agents),
        agentConsensus: `${agentCount}/3`,
        convergenceScore: parseFloat(convergenceScore.toFixed(2)),
        accuracy: parseFloat(accuracy.toFixed(4)),
        totalPredictions: group.totalPredictions,
        lastUpdated: new Date().toISOString()
      };
    });

    // Sort by convergence (descending), then by accuracy (descending)
    hotTokens.sort((a, b) => {
      if (b.convergence !== a.convergence) {
        return b.convergence - a.convergence;
      }
      return b.accuracy - a.accuracy;
    });

    return hotTokens;
  }

  /**
   * Compute best performers: top agents by win rate
   * @private
   */
  async _computeBestPerformers() {
    if (!this.reputationWorker) {
      console.warn('[SignalsAggregateWorker] No reputation worker available');
      return [];
    }

    try {
      // Get all reputations
      const reputations = await this.reputationWorker.getAllReputations();

      // Convert to array and enrich
      const performers = Object.entries(reputations).map(([agent, metrics]) => ({
        agent,
        winRate: metrics.winRate,
        avgMultiple: metrics.avgMultiple,
        totalCalls: metrics.totalCalls,
        correctCalls: metrics.correctCalls,
        incorrectCalls: metrics.incorrectCalls,
        lastUpdated: new Date().toISOString()
      }));

      // Sort by win rate descending
      performers.sort((a, b) => b.winRate - a.winRate);

      return performers;
    } catch (err) {
      console.error('[SignalsAggregateWorker] Error computing best performers:', err);
      return [];
    }
  }

  /**
   * Compute recent exits: recently resolved predictions (last 24h)
   * @private
   */
  _computeRecentExits(resolvedPredictions) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Filter predictions resolved in last 24h
    const recentExits = resolvedPredictions
      .filter(p => {
        if (!p.resolvedAt) return false;
        const resolvedDate = new Date(p.resolvedAt);
        return resolvedDate >= oneDayAgo;
      })
      .map(p => ({
        predictionId: p.id,
        agent: p.agent,
        symbol: p.symbol,
        predictedValue: p.predictedValue,
        actualOutcome: p.actualOutcome,
        wasCorrect: p.wasCorrect,
        status: p.status,
        resolvedAt: p.resolvedAt,
        metadata: p.metadata
      }));

    // Sort by resolution time descending (most recent first)
    recentExits.sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));

    return recentExits.slice(0, 50); // Return last 50
  }

  /**
   * Get cached signals
   * @returns {Object}
   */
  getSignals() {
    return {
      ...this.cache,
      isFresh: this._isCacheFresh()
    };
  }

  /**
   * Get specific signal type
   * @param {string} type - 'gems', 'hot_tokens', 'best_performers', or 'recent_exits'
   * @returns {Array}
   */
  getSignal(type) {
    if (!['gems', 'hot_tokens', 'best_performers', 'recent_exits'].includes(type)) {
      throw new Error(`Invalid signal type: ${type}`);
    }
    return this.cache[type] || [];
  }

  /**
   * Check if cache is fresh (updated within last poll interval)
   * @private
   */
  _isCacheFresh() {
    if (!this.cache.lastUpdated) return false;
    const lastUpdate = new Date(this.cache.lastUpdated);
    const now = new Date();
    return (now - lastUpdate) < this.pollInterval;
  }

  /**
   * Get worker status
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      nextAggregation: this.intervalId
        ? new Date(Date.now() + this.pollInterval).toISOString()
        : null,
      lastUpdated: this.cache.lastUpdated,
      isCacheFresh: this._isCacheFresh(),
      cacheStats: {
        gems: this.cache.gems.length,
        hot_tokens: this.cache.hot_tokens.length,
        best_performers: this.cache.best_performers.length,
        recent_exits: this.cache.recent_exits.length
      }
    };
  }
}

export default SignalsAggregateWorker;

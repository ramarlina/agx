/**
 * Resolution Worker
 *
 * Checks for predictions that have reached their lock time and resolves them
 * by comparing the prediction against the actual outcome and updating status.
 *
 * Lock time: The timestamp when a prediction can no longer be changed and
 * should be compared against the actual outcome to determine if it was correct.
 */

import { EventEmitter } from 'events';

class ResolutionWorker extends EventEmitter {
  constructor(options = {}) {
    super();

    this.pollInterval = options.pollInterval || 60000; // 1 minute default
    this.dataStore = options.dataStore; // Injected data store
    this.isRunning = false;
    this.intervalId = null;
  }

  /**
   * Start the worker
   */
  start() {
    if (this.isRunning) {
      console.log('[ResolutionWorker] Already running');
      return;
    }

    console.log('[ResolutionWorker] Starting...');
    this.isRunning = true;

    // Run immediately on start
    this._processResolutions().catch(err => {
      console.error('[ResolutionWorker] Error on startup:', err);
      this.emit('error', err);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this._processResolutions().catch(err => {
        console.error('[ResolutionWorker] Error during processing:', err);
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
      console.log('[ResolutionWorker] Not running');
      return;
    }

    console.log('[ResolutionWorker] Stopping...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.emit('stopped');
  }

  /**
   * Process predictions that have reached lock time
   * @private
   */
  async _processResolutions() {
    const now = new Date();
    console.log(`[ResolutionWorker] Checking for predictions to resolve at ${now.toISOString()}`);

    try {
      // Get all predictions that need resolution
      const predictions = await this._getPendingPredictions();

      if (predictions.length === 0) {
        console.log('[ResolutionWorker] No predictions to resolve');
        return;
      }

      console.log(`[ResolutionWorker] Found ${predictions.length} prediction(s) to resolve`);

      // Process each prediction
      const results = {
        processed: 0,
        correct: 0,
        incorrect: 0,
        errors: 0
      };

      for (const prediction of predictions) {
        try {
          await this._resolvePrediction(prediction);
          results.processed++;

          // Track if prediction was correct
          if (prediction.status === 'correct') {
            results.correct++;
          } else if (prediction.status === 'incorrect') {
            results.incorrect++;
          }
        } catch (err) {
          console.error(`[ResolutionWorker] Failed to resolve prediction ${prediction.id}:`, err);
          results.errors++;
          this.emit('resolutionError', { prediction, error: err });
        }
      }

      console.log('[ResolutionWorker] Batch complete:', results);
      this.emit('batchComplete', results);

    } catch (err) {
      console.error('[ResolutionWorker] Fatal error in processing:', err);
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Get predictions that have passed their lock time but haven't been resolved
   * @private
   * @returns {Promise<Array>}
   */
  async _getPendingPredictions() {
    if (!this.dataStore || typeof this.dataStore.getPendingPredictions !== 'function') {
      throw new Error('DataStore with getPendingPredictions method is required');
    }

    return await this.dataStore.getPendingPredictions();
  }

  /**
   * Resolve a single prediction
   * @private
   * @param {Object} prediction
   * @param {string} prediction.id - Prediction ID
   * @param {*} prediction.predictedValue - What was predicted
   * @param {*} prediction.actualOutcome - The actual outcome
   * @param {string} prediction.lockTime - ISO timestamp when prediction locks
   * @param {string} prediction.status - Current status (pending, resolved, etc)
   */
  async _resolvePrediction(prediction) {
    console.log(`[ResolutionWorker] Resolving prediction ${prediction.id}`);

    // Determine if prediction was correct
    const isCorrect = this._comparePredictionToOutcome(
      prediction.predictedValue,
      prediction.actualOutcome
    );

    // Update prediction status
    const newStatus = isCorrect ? 'correct' : 'incorrect';
    const resolvedAt = new Date().toISOString();

    await this.dataStore.updatePrediction(prediction.id, {
      status: newStatus,
      resolvedAt,
      wasCorrect: isCorrect
    });

    console.log(
      `[ResolutionWorker] Prediction ${prediction.id} resolved as ${newStatus} ` +
      `(predicted: ${JSON.stringify(prediction.predictedValue)}, ` +
      `actual: ${JSON.stringify(prediction.actualOutcome)})`
    );

    this.emit('predictionResolved', {
      predictionId: prediction.id,
      status: newStatus,
      isCorrect,
      resolvedAt
    });
  }

  /**
   * Compare predicted value to actual outcome
   * @private
   * @param {*} predicted
   * @param {*} actual
   * @returns {boolean}
   */
  _comparePredictionToOutcome(predicted, actual) {
    // Handle null/undefined
    if (predicted === null || predicted === undefined) {
      return actual === null || actual === undefined;
    }

    // For objects/arrays, do deep equality (simple version)
    if (typeof predicted === 'object') {
      return JSON.stringify(predicted) === JSON.stringify(actual);
    }

    // For primitives, use strict equality
    // Could add tolerance for numeric predictions (e.g., within 5%)
    if (typeof predicted === 'number' && typeof actual === 'number') {
      // Optional: add tolerance for numeric predictions
      const tolerance = 0.05; // 5%
      const diff = Math.abs(predicted - actual);
      const threshold = Math.abs(predicted * tolerance);
      return diff <= threshold;
    }

    return predicted === actual;
  }

  /**
   * Get worker status
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      nextCheck: this.intervalId ? new Date(Date.now() + this.pollInterval).toISOString() : null
    };
  }
}

export default ResolutionWorker;

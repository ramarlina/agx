/**
 * Prediction Data Store
 *
 * In-memory store for predictions (mesh-signals domain).
 * In production, this would be backed by a database.
 */

import { v4 as uuidv4 } from 'uuid';

class PredictionStore {
  constructor() {
    // Map<predictionId, prediction>
    this.predictions = new Map();
  }

  /**
   * Create a new prediction
   * @param {Object} data
   * @param {string} data.agent - Agent making the prediction
   * @param {string} data.symbol - Token symbol or entity being predicted
   * @param {*} data.predictedValue - The predicted value
   * @param {string} data.lockTime - ISO timestamp when prediction locks
   * @param {Object} [data.metadata] - Additional metadata
   * @returns {Object} Created prediction
   */
  async createPrediction(data) {
    const prediction = {
      id: uuidv4(),
      agent: data.agent,
      symbol: data.symbol,
      predictedValue: data.predictedValue,
      actualOutcome: null,
      lockTime: data.lockTime,
      status: 'pending', // pending, resolved, correct, incorrect
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      wasCorrect: null,
      metadata: data.metadata || {}
    };

    this.predictions.set(prediction.id, prediction);
    return prediction;
  }

  /**
   * Update prediction outcome (typically set before lock time)
   * @param {string} id - Prediction ID
   * @param {*} actualOutcome - The actual outcome
   */
  async setOutcome(id, actualOutcome) {
    const prediction = this.predictions.get(id);
    if (!prediction) {
      throw new Error(`Prediction ${id} not found`);
    }

    prediction.actualOutcome = actualOutcome;
    prediction.updatedAt = new Date().toISOString();

    this.predictions.set(id, prediction);
    return prediction;
  }

  /**
   * Update prediction status and resolution data
   * @param {string} id - Prediction ID
   * @param {Object} updates - Fields to update
   */
  async updatePrediction(id, updates) {
    const prediction = this.predictions.get(id);
    if (!prediction) {
      throw new Error(`Prediction ${id} not found`);
    }

    Object.assign(prediction, updates);
    prediction.updatedAt = new Date().toISOString();

    this.predictions.set(id, prediction);
    return prediction;
  }

  /**
   * Get predictions that need resolution
   * (lock time has passed, status is pending, and actual outcome is set)
   * @returns {Promise<Array>}
   */
  async getPendingPredictions() {
    const now = new Date();
    const pending = [];

    for (const prediction of this.predictions.values()) {
      const lockTime = new Date(prediction.lockTime);

      // Criteria for resolution:
      // 1. Lock time has passed
      // 2. Status is still 'pending'
      // 3. Actual outcome has been set
      if (
        now >= lockTime &&
        prediction.status === 'pending' &&
        prediction.actualOutcome !== null &&
        prediction.actualOutcome !== undefined
      ) {
        pending.push(prediction);
      }
    }

    return pending;
  }

  /**
   * Get prediction by ID
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getPrediction(id) {
    return this.predictions.get(id) || null;
  }

  /**
   * Get all predictions (with optional filters)
   * @param {Object} [filters]
   * @param {string} [filters.status]
   * @param {string} [filters.agent]
   * @param {string} [filters.symbol]
   * @returns {Promise<Array>}
   */
  async getPredictions(filters = {}) {
    let results = Array.from(this.predictions.values());

    if (filters.status) {
      results = results.filter(p => p.status === filters.status);
    }

    if (filters.agent) {
      results = results.filter(p => p.agent === filters.agent);
    }

    if (filters.symbol) {
      results = results.filter(p => p.symbol === filters.symbol);
    }

    // Sort by creation time, most recent first
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return results;
  }

  /**
   * Delete prediction
   * @param {string} id
   */
  async deletePrediction(id) {
    return this.predictions.delete(id);
  }

  /**
   * Get statistics
   */
  async getStats() {
    const all = Array.from(this.predictions.values());

    return {
      total: all.length,
      pending: all.filter(p => p.status === 'pending').length,
      resolved: all.filter(p => p.status !== 'pending').length,
      correct: all.filter(p => p.status === 'correct').length,
      incorrect: all.filter(p => p.status === 'incorrect').length,
      accuracy: this._calculateAccuracy(all)
    };
  }

  _calculateAccuracy(predictions) {
    const resolved = predictions.filter(p => p.wasCorrect !== null);
    if (resolved.length === 0) return 0;

    const correct = resolved.filter(p => p.wasCorrect === true).length;
    return (correct / resolved.length).toFixed(4);
  }
}

export default PredictionStore;

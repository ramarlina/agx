/**
 * Cost Cap - Track and enforce spending limits for agx tasks.
 *
 * Psychological safety for "walk away" autonomy:
 * - Even a crude `if (cost > $5) stop()` unlocks trust
 * - Users can set cost caps per task or globally
 * - Execution stops gracefully when cap is reached
 *
 * Pricing estimates (as of 2024):
 * - Claude 3.5 Sonnet: $3/1M input, $15/1M output
 * - Claude 3 Opus: $15/1M input, $75/1M output
 * - GPT-4 Turbo: $10/1M input, $30/1M output
 * - Gemini 1.5 Pro: $3.50/1M input, $10.50/1M output
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_COST_CAP_USD = 5.0;
const COST_FILE_NAME = 'cost.json';

// Token-to-cost rates per model (USD per 1M tokens)
const MODEL_PRICING = {
  // Claude models
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-sonnet': { input: 3.0, output: 15.0 },
  'claude-opus': { input: 15.0, output: 75.0 },
  'claude': { input: 3.0, output: 15.0 }, // Default to sonnet pricing
  
  // OpenAI models
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  
  // Gemini models
  'gemini-1.5-pro': { input: 3.5, output: 10.5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-pro': { input: 0.5, output: 1.5 },
  'gemini': { input: 3.5, output: 10.5 }, // Default to pro pricing
  
  // Ollama (local, no cost)
  'ollama': { input: 0, output: 0 },
  'llama': { input: 0, output: 0 },
  'codex': { input: 0, output: 0 }, // Codex uses local models
  
  // Default fallback (conservative estimate)
  'default': { input: 5.0, output: 15.0 },
};

/**
 * Get pricing for a model.
 * @param {string} model
 * @returns {{ input: number, output: number }}
 */
function getModelPricing(model) {
  if (!model) return MODEL_PRICING.default;
  
  const normalized = String(model).toLowerCase();
  
  // Direct match
  if (MODEL_PRICING[normalized]) {
    return MODEL_PRICING[normalized];
  }
  
  // Partial match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return pricing;
    }
  }
  
  return MODEL_PRICING.default;
}

/**
 * Estimate cost for a single API call.
 * @param {object} options
 * @param {number} options.inputTokens
 * @param {number} options.outputTokens
 * @param {string} options.model
 * @returns {number} Cost in USD
 */
function estimateCost({ inputTokens = 0, outputTokens = 0, model = 'default' }) {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Cost tracker for a task.
 */
class CostTracker {
  constructor(options = {}) {
    this.taskRoot = options.taskRoot || null;
    this.costCap = options.costCap ?? DEFAULT_COST_CAP_USD;
    this.model = options.model || 'default';
    this.totalCost = 0;
    this.calls = [];
    this._loaded = false;
  }
  
  /**
   * Load existing cost data from disk.
   */
  async load() {
    if (this._loaded || !this.taskRoot) return;
    
    try {
      const costPath = path.join(this.taskRoot, COST_FILE_NAME);
      if (fs.existsSync(costPath)) {
        const data = JSON.parse(fs.readFileSync(costPath, 'utf8'));
        this.totalCost = data.totalCost || 0;
        this.calls = data.calls || [];
      }
    } catch {
      // Ignore load errors, start fresh
    }
    
    this._loaded = true;
  }
  
  /**
   * Save cost data to disk.
   */
  async save() {
    if (!this.taskRoot) return;
    
    try {
      const costPath = path.join(this.taskRoot, COST_FILE_NAME);
      const data = {
        totalCost: this.totalCost,
        costCap: this.costCap,
        model: this.model,
        calls: this.calls,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(costPath, JSON.stringify(data, null, 2));
    } catch {
      // Ignore save errors
    }
  }
  
  /**
   * Record a cost event.
   * @param {object} event
   * @param {number} event.inputTokens
   * @param {number} event.outputTokens
   * @param {string} event.model
   * @param {string} event.stage
   * @returns {{ cost: number, totalCost: number, exceededCap: boolean }}
   */
  record({ inputTokens = 0, outputTokens = 0, model, stage = 'unknown' }) {
    const effectiveModel = model || this.model;
    const cost = estimateCost({ inputTokens, outputTokens, model: effectiveModel });
    
    this.totalCost += cost;
    this.calls.push({
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      model: effectiveModel,
      stage,
      cost,
    });
    
    // Auto-save after each record
    this.save().catch(() => {});
    
    return {
      cost,
      totalCost: this.totalCost,
      exceededCap: this.totalCost >= this.costCap,
      remaining: Math.max(0, this.costCap - this.totalCost),
    };
  }
  
  /**
   * Check if cost cap is exceeded.
   * @returns {boolean}
   */
  isExceeded() {
    return this.totalCost >= this.costCap;
  }
  
  /**
   * Get remaining budget.
   * @returns {number}
   */
  getRemaining() {
    return Math.max(0, this.costCap - this.totalCost);
  }
  
  /**
   * Get summary for display.
   * @returns {string}
   */
  getSummary() {
    const pct = this.costCap > 0 ? ((this.totalCost / this.costCap) * 100).toFixed(0) : 0;
    return `$${this.totalCost.toFixed(2)} / $${this.costCap.toFixed(2)} (${pct}%)`;
  }
}

/**
 * Create a cost tracker for a task.
 * @param {object} options
 * @param {string} options.taskRoot - Path to task directory
 * @param {number} options.costCap - Cost cap in USD
 * @param {string} options.model - Default model for pricing
 * @returns {CostTracker}
 */
function createCostTracker(options = {}) {
  return new CostTracker(options);
}

/**
 * Check if execution should stop due to cost cap.
 * @param {CostTracker} tracker
 * @param {function} onLog
 * @returns {{ shouldStop: boolean, reason: string }}
 */
function checkCostCap(tracker, onLog = () => {}) {
  if (!tracker) {
    return { shouldStop: false, reason: '' };
  }
  
  if (tracker.isExceeded()) {
    const reason = `Cost cap exceeded: ${tracker.getSummary()}`;
    onLog(`[cost-cap] ⚠️ ${reason}`);
    return { shouldStop: true, reason };
  }
  
  const remaining = tracker.getRemaining();
  if (remaining < 0.50) {
    onLog(`[cost-cap] ⚠️ Low budget: $${remaining.toFixed(2)} remaining`);
  }
  
  return { shouldStop: false, reason: '' };
}

module.exports = {
  DEFAULT_COST_CAP_USD,
  MODEL_PRICING,
  getModelPricing,
  estimateCost,
  CostTracker,
  createCostTracker,
  checkCostCap,
};

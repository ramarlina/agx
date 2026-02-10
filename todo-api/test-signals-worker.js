/**
 * Test script for signals-aggregate worker
 */

import SignalsAggregateWorker from './workers/signals-aggregate-worker.js';
import PredictionStore from './stores/prediction-store.js';
import ReputationCalcWorker from './workers/reputation-calc-worker.js';
import ResolutionWorker from './workers/resolution-worker.js';

async function test() {
  console.log('=== Testing SignalsAggregateWorker ===\n');

  // Create data store
  const predictionStore = new PredictionStore();

  // Create some test predictions
  console.log('Creating test predictions...');

  // Create predictions with different agents and symbols
  const lockTime1 = new Date(Date.now() + 1000).toISOString();
  const lockTime2 = new Date(Date.now() + 2000).toISOString();

  const p1 = await predictionStore.createPrediction({
    agent: 'claude',
    symbol: 'ETH',
    predictedValue: 2000,
    lockTime: lockTime1,
    metadata: { source: 'test' }
  });

  const p2 = await predictionStore.createPrediction({
    agent: 'gemini',
    symbol: 'ETH',
    predictedValue: 2100,
    lockTime: lockTime1,
    metadata: { source: 'test' }
  });

  const p3 = await predictionStore.createPrediction({
    agent: 'ollama',
    symbol: 'BTC',
    predictedValue: 50000,
    lockTime: lockTime2,
    metadata: { source: 'test' }
  });

  console.log(`Created ${p1.id}, ${p2.id}, ${p3.id}\n`);

  // Set outcomes
  console.log('Setting outcomes...');
  await predictionStore.setOutcome(p1.id, 1950); // Claude was close
  await predictionStore.setOutcome(p2.id, 2000); // Gemini was close
  await predictionStore.setOutcome(p3.id, 48000); // Ollama was close

  // Wait for lock times to pass
  console.log('Waiting for lock times...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Create workers
  const resolutionWorker = new ResolutionWorker({
    dataStore: predictionStore,
    pollInterval: 30000
  });

  const reputationWorker = new ReputationCalcWorker({
    dataStore: predictionStore,
    resolutionWorker: resolutionWorker
  });

  const signalsWorker = new SignalsAggregateWorker({
    dataStore: predictionStore,
    reputationWorker: reputationWorker,
    pollInterval: 10000 // 10 seconds for testing
  });

  // Start workers
  console.log('\nStarting workers...');
  resolutionWorker.start();

  // Wait for resolution
  await new Promise(resolve => {
    resolutionWorker.on('batchComplete', () => {
      console.log('Resolution complete');
      resolve();
    });
  });

  reputationWorker.start();
  await new Promise(resolve => setTimeout(resolve, 1000));

  signalsWorker.start();

  // Wait for aggregation
  await new Promise(resolve => {
    signalsWorker.on('aggregationComplete', () => {
      console.log('Aggregation complete');
      resolve();
    });
  });

  // Test getting signals
  console.log('\n=== Worker Status ===');
  console.log(JSON.stringify(signalsWorker.getStatus(), null, 2));

  console.log('\n=== All Signals ===');
  const allSignals = signalsWorker.getSignals();
  console.log(JSON.stringify(allSignals, null, 2));

  console.log('\n=== Gems ===');
  const gems = signalsWorker.getSignal('gems');
  console.log(JSON.stringify(gems, null, 2));

  console.log('\n=== Hot Tokens ===');
  const hotTokens = signalsWorker.getSignal('hot_tokens');
  console.log(JSON.stringify(hotTokens, null, 2));

  console.log('\n=== Best Performers ===');
  const performers = signalsWorker.getSignal('best_performers');
  console.log(JSON.stringify(performers, null, 2));

  console.log('\n=== Recent Exits ===');
  const exits = signalsWorker.getSignal('recent_exits');
  console.log(JSON.stringify(exits, null, 2));

  // Cleanup
  console.log('\n=== Stopping workers ===');
  signalsWorker.stop();
  reputationWorker.stop();
  resolutionWorker.stop();

  console.log('\nTest complete!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

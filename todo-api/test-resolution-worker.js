/**
 * Test script for resolution worker
 *
 * Demonstrates:
 * 1. Creating predictions with lock times
 * 2. Setting outcomes
 * 3. Worker automatically resolving predictions when lock time is reached
 */

import ResolutionWorker from './workers/resolution-worker.js';
import PredictionStore from './stores/prediction-store.js';

async function runTest() {
  console.log('=== Resolution Worker Test ===\n');

  const store = new PredictionStore();
  const worker = new ResolutionWorker({
    dataStore: store,
    pollInterval: 5000 // Check every 5 seconds for demo
  });

  // Set up event listeners
  worker.on('started', () => {
    console.log('✓ Worker started\n');
  });

  worker.on('predictionResolved', (event) => {
    console.log(`✓ Prediction ${event.predictionId} resolved as: ${event.status}`);
    console.log(`  Resolved at: ${event.resolvedAt}\n`);
  });

  worker.on('batchComplete', (results) => {
    console.log('Batch complete:', results);
  });

  // Create test predictions with lock times
  console.log('Creating test predictions...\n');

  // Prediction 1: Lock time 10 seconds from now
  const lockTime1 = new Date(Date.now() + 10000); // 10 seconds
  const pred1 = await store.createPrediction({
    agent: 'claude',
    symbol: 'ETH',
    predictedValue: 3500,
    lockTime: lockTime1.toISOString()
  });
  console.log(`Created prediction ${pred1.id}`);
  console.log(`  Symbol: ${pred1.symbol}`);
  console.log(`  Predicted: ${pred1.predictedValue}`);
  console.log(`  Lock time: ${pred1.lockTime}`);

  // Set outcome immediately (correct)
  await store.setOutcome(pred1.id, 3520); // Close to 3500, within 5% tolerance
  console.log(`  Outcome set: 3520 (should be correct)\n`);

  // Prediction 2: Lock time 15 seconds from now
  const lockTime2 = new Date(Date.now() + 15000); // 15 seconds
  const pred2 = await store.createPrediction({
    agent: 'gemini',
    symbol: 'BTC',
    predictedValue: 50000,
    lockTime: lockTime2.toISOString()
  });
  console.log(`Created prediction ${pred2.id}`);
  console.log(`  Symbol: ${pred2.symbol}`);
  console.log(`  Predicted: ${pred2.predictedValue}`);
  console.log(`  Lock time: ${pred2.lockTime}`);

  // Set outcome (incorrect)
  await store.setOutcome(pred2.id, 60000); // Very different from 50000
  console.log(`  Outcome set: 60000 (should be incorrect)\n`);

  // Prediction 3: Lock time 20 seconds from now
  const lockTime3 = new Date(Date.now() + 20000); // 20 seconds
  const pred3 = await store.createPrediction({
    agent: 'ollama',
    symbol: 'LINK',
    predictedValue: 'bullish',
    lockTime: lockTime3.toISOString()
  });
  console.log(`Created prediction ${pred3.id}`);
  console.log(`  Symbol: ${pred3.symbol}`);
  console.log(`  Predicted: ${pred3.predictedValue}`);
  console.log(`  Lock time: ${pred3.lockTime}`);

  // Set outcome (correct - exact match for string)
  await store.setOutcome(pred3.id, 'bullish');
  console.log(`  Outcome set: bullish (should be correct)\n`);

  console.log('Starting worker...\n');
  worker.start();

  // Let the worker run for 30 seconds
  console.log('Worker will check for predictions to resolve every 5 seconds.');
  console.log('Waiting 30 seconds...\n');

  await new Promise(resolve => setTimeout(resolve, 30000));

  // Check final stats
  console.log('\n=== Final Statistics ===');
  const stats = await store.getStats();
  console.log('Total predictions:', stats.total);
  console.log('Pending:', stats.pending);
  console.log('Resolved:', stats.resolved);
  console.log('Correct:', stats.correct);
  console.log('Incorrect:', stats.incorrect);
  console.log('Accuracy:', stats.accuracy);

  // Get all predictions
  console.log('\n=== All Predictions ===');
  const allPredictions = await store.getPredictions();
  allPredictions.forEach(p => {
    console.log(`\nPrediction ${p.id}:`);
    console.log(`  Symbol: ${p.symbol}`);
    console.log(`  Agent: ${p.agent}`);
    console.log(`  Predicted: ${JSON.stringify(p.predictedValue)}`);
    console.log(`  Actual: ${JSON.stringify(p.actualOutcome)}`);
    console.log(`  Status: ${p.status}`);
    console.log(`  Was correct: ${p.wasCorrect}`);
    if (p.resolvedAt) {
      console.log(`  Resolved at: ${p.resolvedAt}`);
    }
  });

  // Stop worker
  console.log('\n\nStopping worker...');
  worker.stop();

  console.log('\n=== Test Complete ===');
  process.exit(0);
}

// Run the test
runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

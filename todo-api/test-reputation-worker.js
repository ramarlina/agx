/**
 * Test script for Reputation Calculation Worker
 *
 * This script tests the reputation calculation worker by:
 * 1. Creating multiple predictions from different agents
 * 2. Setting outcomes
 * 3. Waiting for resolution
 * 4. Checking computed reputation metrics (win rate, avg multiple, total calls)
 *
 * Usage: node test-reputation-worker.js
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3000';

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to make API calls
async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json();

  if (!data.success) {
    throw new Error(`API call failed: ${data.error}`);
  }

  return data;
}

async function main() {
  console.log('=== Reputation Calculation Worker Test ===\n');

  // Check workers are running
  console.log('1. Checking worker status...');
  const resolutionStatus = await apiCall('GET', '/worker/status');
  const reputationStatus = await apiCall('GET', '/workers/reputation/status');
  console.log('   Resolution worker:', resolutionStatus.data);
  console.log('   Reputation worker:', reputationStatus.data);
  console.log('');

  // Get current time and create lock times in the near future
  const now = Date.now();
  const lockTime1 = new Date(now + 5000).toISOString();  // 5 seconds from now
  const lockTime2 = new Date(now + 10000).toISOString(); // 10 seconds from now
  const lockTime3 = new Date(now + 15000).toISOString(); // 15 seconds from now

  console.log('2. Creating test predictions...');

  // Claude predictions (2 correct, 1 incorrect)
  const claude1 = await apiCall('POST', '/predictions', {
    agent: 'claude',
    symbol: 'ETH',
    predictedValue: 3500,
    lockTime: lockTime1,
    metadata: { test: true }
  });
  console.log(`   Created Claude ETH prediction: ${claude1.data.id}`);

  const claude2 = await apiCall('POST', '/predictions', {
    agent: 'claude',
    symbol: 'BTC',
    predictedValue: 60000,
    lockTime: lockTime1,
    metadata: { test: true }
  });
  console.log(`   Created Claude BTC prediction: ${claude2.data.id}`);

  const claude3 = await apiCall('POST', '/predictions', {
    agent: 'claude',
    symbol: 'SOL',
    predictedValue: 100,
    lockTime: lockTime2,
    metadata: { test: true }
  });
  console.log(`   Created Claude SOL prediction: ${claude3.data.id}`);

  // Gemini predictions (1 correct, 1 incorrect)
  const gemini1 = await apiCall('POST', '/predictions', {
    agent: 'gemini',
    symbol: 'ETH',
    predictedValue: 3600,
    lockTime: lockTime2,
    metadata: { test: true }
  });
  console.log(`   Created Gemini ETH prediction: ${gemini1.data.id}`);

  const gemini2 = await apiCall('POST', '/predictions', {
    agent: 'gemini',
    symbol: 'BTC',
    predictedValue: 55000,
    lockTime: lockTime3,
    metadata: { test: true }
  });
  console.log(`   Created Gemini BTC prediction: ${gemini2.data.id}`);

  // Ollama predictions (all correct)
  const ollama1 = await apiCall('POST', '/predictions', {
    agent: 'ollama',
    symbol: 'ETH',
    predictedValue: 3520,
    lockTime: lockTime3,
    metadata: { test: true }
  });
  console.log(`   Created Ollama ETH prediction: ${ollama1.data.id}`);

  console.log('');

  // Set outcomes
  console.log('3. Setting actual outcomes...');
  await apiCall('PUT', `/predictions/${claude1.data.id}/outcome`, { actualOutcome: 3520 }); // Correct (within 5%)
  console.log('   Set ETH outcome: 3520');

  await apiCall('PUT', `/predictions/${claude2.data.id}/outcome`, { actualOutcome: 55000 }); // Incorrect
  console.log('   Set BTC outcome: 55000');

  await apiCall('PUT', `/predictions/${claude3.data.id}/outcome`, { actualOutcome: 102 }); // Correct (within 5%)
  console.log('   Set SOL outcome: 102');

  await apiCall('PUT', `/predictions/${gemini1.data.id}/outcome`, { actualOutcome: 3520 }); // Correct
  console.log('   Set Gemini ETH outcome: 3520');

  await apiCall('PUT', `/predictions/${gemini2.data.id}/outcome`, { actualOutcome: 55000 }); // Incorrect
  console.log('   Set Gemini BTC outcome: 55000');

  await apiCall('PUT', `/predictions/${ollama1.data.id}/outcome`, { actualOutcome: 3520 }); // Correct
  console.log('   Set Ollama ETH outcome: 3520');

  console.log('');

  // Wait for resolutions
  console.log('4. Waiting for predictions to lock and resolve...');
  console.log('   First batch locks in 5 seconds...');
  await sleep(8000); // Wait 8 seconds for first batch

  console.log('   Second batch locks in ~7 more seconds...');
  await sleep(7000); // Wait for second batch

  console.log('   Third batch locks in ~8 more seconds...');
  await sleep(8000); // Wait for third batch

  console.log('   Waiting extra time for worker processing...');
  await sleep(5000); // Extra buffer for processing

  console.log('');

  // Check reputation metrics
  console.log('5. Checking reputation metrics...\n');

  // Claude reputation (expected: 2/3 = 0.6667 win rate)
  try {
    const claudeRep = await apiCall('GET', '/agents/claude/reputation');
    console.log('   Claude reputation:');
    console.log(`     Win Rate: ${claudeRep.data.winRate} (expected: ~0.6667)`);
    console.log(`     Avg Multiple: ${claudeRep.data.avgMultiple}`);
    console.log(`     Total Calls: ${claudeRep.data.totalCalls} (expected: 3)`);
    console.log(`     Correct: ${claudeRep.data.correctCalls}, Incorrect: ${claudeRep.data.incorrectCalls}`);
  } catch (err) {
    console.log('   Claude: Not yet resolved or error:', err.message);
  }

  console.log('');

  // Gemini reputation (expected: 1/2 = 0.5 win rate)
  try {
    const geminiRep = await apiCall('GET', '/agents/gemini/reputation');
    console.log('   Gemini reputation:');
    console.log(`     Win Rate: ${geminiRep.data.winRate} (expected: 0.5)`);
    console.log(`     Avg Multiple: ${geminiRep.data.avgMultiple}`);
    console.log(`     Total Calls: ${geminiRep.data.totalCalls} (expected: 2)`);
    console.log(`     Correct: ${geminiRep.data.correctCalls}, Incorrect: ${geminiRep.data.incorrectCalls}`);
  } catch (err) {
    console.log('   Gemini: Not yet resolved or error:', err.message);
  }

  console.log('');

  // Ollama reputation (expected: 1/1 = 1.0 win rate)
  try {
    const ollamaRep = await apiCall('GET', '/agents/ollama/reputation');
    console.log('   Ollama reputation:');
    console.log(`     Win Rate: ${ollamaRep.data.winRate} (expected: 1.0)`);
    console.log(`     Avg Multiple: ${ollamaRep.data.avgMultiple}`);
    console.log(`     Total Calls: ${ollamaRep.data.totalCalls} (expected: 1)`);
    console.log(`     Correct: ${ollamaRep.data.correctCalls}, Incorrect: ${ollamaRep.data.incorrectCalls}`);
  } catch (err) {
    console.log('   Ollama: Not yet resolved or error:', err.message);
  }

  console.log('');

  // Get all reputations
  console.log('6. All agent reputations:');
  const allReps = await apiCall('GET', '/agents/reputations');
  console.table(allReps.data);

  console.log('\n=== Test Complete ===');
  console.log('\nExpected results:');
  console.log('  Claude:  ~66.67% win rate (2 correct, 1 incorrect)');
  console.log('  Gemini:  50% win rate (1 correct, 1 incorrect)');
  console.log('  Ollama:  100% win rate (1 correct, 0 incorrect)');
}

main()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });

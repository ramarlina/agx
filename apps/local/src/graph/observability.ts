export interface GraphObservabilitySnapshot {
  graphCreateCount: number;
  replanCount: number;
  rollbackCount: number;
  migrationFailureCount: number;
  gatePassCount: number;
  gateFailCount: number;
  gatePassRate: number;
  gateFailRate: number;
}

interface GraphObservabilityCounters {
  graphCreateCount: number;
  replanCount: number;
  rollbackCount: number;
  migrationFailureCount: number;
  gatePassCount: number;
  gateFailCount: number;
}

const counters: GraphObservabilityCounters = {
  graphCreateCount: 0,
  replanCount: 0,
  rollbackCount: 0,
  migrationFailureCount: 0,
  gatePassCount: 0,
  gateFailCount: 0,
};

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export function recordGraphCreate(): void {
  counters.graphCreateCount += 1;
}

export function recordReplan(): void {
  counters.replanCount += 1;
}

export function recordRollback(): void {
  counters.rollbackCount += 1;
}

export function recordMigrationFailure(): void {
  counters.migrationFailureCount += 1;
}

export function recordGateVerificationResult(passed: boolean): void {
  if (passed) {
    counters.gatePassCount += 1;
    return;
  }
  counters.gateFailCount += 1;
}

export function getGraphObservabilitySnapshot(): GraphObservabilitySnapshot {
  const attempts = counters.gatePassCount + counters.gateFailCount;
  return {
    ...counters,
    gatePassRate: safeRate(counters.gatePassCount, attempts),
    gateFailRate: safeRate(counters.gateFailCount, attempts),
  };
}

export function resetGraphObservability(): void {
  counters.graphCreateCount = 0;
  counters.replanCount = 0;
  counters.rollbackCount = 0;
  counters.migrationFailureCount = 0;
  counters.gatePassCount = 0;
  counters.gateFailCount = 0;
}

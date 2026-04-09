import { assertWorkerCount, WriteRateMonitor } from "@/lib/limits";

describe("assertWorkerCount", () => {
  it("accepts worker count within limit", () => {
    expect(() => assertWorkerCount(1)).not.toThrow();
    expect(() => assertWorkerCount(5)).not.toThrow();
    expect(() => assertWorkerCount(10)).not.toThrow();
  });

  it("rejects worker count above MAX_WORKERS", () => {
    expect(() => assertWorkerCount(11)).toThrow(/exceeds MAX_WORKERS/);
    expect(() => assertWorkerCount(100)).toThrow(/exceeds MAX_WORKERS/);
  });

  it("rejects worker count below 1", () => {
    expect(() => assertWorkerCount(0)).toThrow(/at least 1/);
    expect(() => assertWorkerCount(-1)).toThrow(/at least 1/);
  });
});

describe("WriteRateMonitor", () => {
  it("reports no warning when write rate is low", () => {
    const monitor = new WriteRateMonitor();
    monitor.record();
    const result = monitor.check();
    expect(result.warning).toBe(false);
  });

  it("reports warning when write rate exceeds threshold", () => {
    const monitor = new WriteRateMonitor();
    // Simulate 500 writes in the sample window (way above 40 QPS)
    for (let i = 0; i < 500; i++) {
      monitor.record();
    }
    const result = monitor.check();
    expect(result.warning).toBe(true);
    expect(result.qps).toBeGreaterThanOrEqual(40);
  });
});

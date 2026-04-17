/**
 * @jest-environment node
 */

const mockSpawnSync = jest.fn();
const mockFetch = jest.fn();

jest.mock("child_process", () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

jest.mock("@/lib/shell-env", () => ({
  buildSpawnEnv: () => ({}),
}));

global.fetch = mockFetch as typeof fetch;

describe("GET /api/update-check", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("returns updateAvailable: true when latest > current", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "2.0.0" }),
    });
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "agx/1.0.0 darwin-arm64 node-v20\n" });

    const { GET } = await import("@/app/api/update-check/route");
    const res = await GET();
    const body = await res.json();

    expect(body.updateAvailable).toBe(true);
    expect(body.latestVersion).toBe("2.0.0");
    expect(body.currentVersion).toBe("1.0.0");
  });

  test("returns updateAvailable: false when versions match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    });
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "agx/1.0.0 darwin-arm64 node-v20\n" });

    const { GET } = await import("@/app/api/update-check/route");
    const res = await GET();
    const body = await res.json();

    expect(body.updateAvailable).toBe(false);
  });

  test("returns updateAvailable: false when npm fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "agx/1.0.0 darwin-arm64 node-v20\n" });

    const { GET } = await import("@/app/api/update-check/route");
    const res = await GET();
    const body = await res.json();

    expect(body.updateAvailable).toBe(false);
  });

  test("returns updateAvailable: false when CLI version unavailable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "2.0.0" }),
    });
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });

    const { GET } = await import("@/app/api/update-check/route");
    const res = await GET();
    const body = await res.json();

    expect(body.updateAvailable).toBe(false);
  });
});

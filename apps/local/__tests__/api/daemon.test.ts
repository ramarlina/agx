/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAll = jest.fn();
const mockValidateBearerToken = jest.fn();

jest.mock("@/lib/agent-process-registry", () => ({
  getAll: () => mockGetAll(),
}));

jest.mock("@/lib/security", () => {
  const actual = jest.requireActual("@/lib/security");
  return {
    ...actual,
    validateBearerToken: (...args: unknown[]) => mockValidateBearerToken(...args),
  };
});

describe("/api/daemon", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetAll.mockReturnValue([
      { state: "running" },
      { state: "spawning" },
      { state: "idle" },
    ]);
    mockValidateBearerToken.mockResolvedValue({ valid: false });
  });

  test("rejects anonymous callers with no browser or bearer context", async () => {
    const { GET } = await import("@/app/api/daemon/route");
    const response = await GET(
      new NextRequest("http://localhost:41741/api/daemon"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  test("rejects browser callers from untrusted origins", async () => {
    const { GET } = await import("@/app/api/daemon/route");
    const response = await GET(
      new NextRequest("http://localhost:41741/api/daemon", {
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  test("allows same-origin board reads via referer fallback", async () => {
    const { GET } = await import("@/app/api/daemon/route");
    const response = await GET(
      new NextRequest("http://localhost:41741/api/daemon", {
        headers: { referer: "http://localhost:41741/" },
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(
      expect.objectContaining({
        running: false,
        targetWorkers: 0,
        activeWorkers: 2,
      }),
    );
  });

  test("allows bearer-authenticated service callers", async () => {
    mockValidateBearerToken.mockResolvedValue({
      valid: true,
      userId: "user-123",
    });

    const { GET } = await import("@/app/api/daemon/route");
    const response = await GET(
      new NextRequest("http://localhost:41741/api/daemon", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("keeps malformed worker updates on the existing 400 path", async () => {
    const { POST } = await import("@/app/api/daemon/route");
    const response = await POST(
      new NextRequest("http://localhost:41741/api/daemon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:41741",
        },
        body: JSON.stringify({ workers: 999 }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("MAX_WORKERS");
  });

  test("allows same-origin callers to stop the daemon", async () => {
    const { POST, GET } = await import("@/app/api/daemon/route");

    const startResponse = await POST(
      new NextRequest("http://localhost:41741/api/daemon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:41741",
        },
        body: JSON.stringify({ workers: 2 }),
      }),
    );
    expect(startResponse.status).toBe(200);

    const stopResponse = await POST(
      new NextRequest("http://localhost:41741/api/daemon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:41741",
        },
        body: JSON.stringify({ action: "stop" }),
      }),
    );
    const stopData = await stopResponse.json();

    expect(stopResponse.status).toBe(200);
    expect(stopData).toEqual({ running: false, targetWorkers: 0 });

    const statusResponse = await GET(
      new NextRequest("http://localhost:41741/api/daemon", {
        headers: { origin: "http://localhost:41741" },
      }),
    );
    const statusData = await statusResponse.json();

    expect(statusData.running).toBe(false);
    expect(statusData.targetWorkers).toBe(0);
  });
});

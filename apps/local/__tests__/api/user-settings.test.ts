/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetUserSettings = jest.fn();
const mockUpsertUserSettings = jest.fn();

jest.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
  upsertUserSettings: (...args: unknown[]) => mockUpsertUserSettings(...args),
}));

describe("/api/user-settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("GET returns settings payload", async () => {
    mockGetUserSettings.mockResolvedValue({
      user_id: "user-1",
      default_provider: "claude",
      models: { claude: "claude-3.7" },
      provenance: "cli",
      changed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { GET } = await import("@/app/api/user-settings/route");
    const request = new NextRequest("http://localhost/api/user-settings");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.settings.default_provider).toBe("claude");
    expect(mockGetUserSettings).toHaveBeenCalled();
  });

  test("PUT upserts with web provenance by default", async () => {
    mockUpsertUserSettings.mockResolvedValue({
      settings: {
        user_id: "user-1",
        default_provider: "gemini",
        models: { gemini: "gemini-2.0" },
        provenance: "web",
        changed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      updated: true,
    });

    const { PUT } = await import("@/app/api/user-settings/route");
    const request = new NextRequest("http://localhost/api/user-settings", {
      method: "PUT",
      body: JSON.stringify({
        default_provider: "gemini",
        default_model: "gemini-2.0",
        models: { gemini: "gemini-2.0" },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.settings.provenance).toBe("web");
    expect(mockUpsertUserSettings).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        default_provider: "gemini",
        models: expect.objectContaining({ gemini: "gemini-2.0" }),
        provenance: "web",
      }),
      expect.any(Object)
    );
  });
});


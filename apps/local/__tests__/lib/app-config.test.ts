/**
 * @jest-environment node
 */

describe("app-config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.AGX_BOARD_URL;
    delete process.env.NEXT_PUBLIC_AGX_BOARD_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("includes localhost defaults and tailscale wildcard for dev origins", async () => {
    const { getAllowedDevOrigins } = await import("@/lib/app-config");

    expect(getAllowedDevOrigins()).toEqual(
      expect.arrayContaining(["localhost", "127.0.0.1", "**.ts.net"])
    );
  });

  test("extracts hostnames from configured board URLs", async () => {
    process.env.AGX_BOARD_URL = "https://mendrikas-macbook-pro.tail2ccf79.ts.net";
    process.env.NEXT_PUBLIC_APP_URL = "https://board.example.com:41741";

    const { getAllowedDevOrigins } = await import("@/lib/app-config");

    expect(getAllowedDevOrigins()).toEqual(
      expect.arrayContaining([
        "mendrikas-macbook-pro.tail2ccf79.ts.net",
        "board.example.com",
      ])
    );
  });
});

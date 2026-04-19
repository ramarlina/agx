/**
 * @jest-environment node
 */

import {
  createNotificationWebhook,
  notifyTaskEvent,
} from "@/lib/notifications";
import { createAdminDbClient } from "@/lib/db-adapter";
import { logger } from "@/lib/logger";

jest.mock("@/lib/db-adapter", () => ({
  createAdminDbClient: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: {
    error: jest.fn(),
    formatError: (error: unknown) =>
      error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) },
  },
}));

describe("notification webhooks", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("createNotificationWebhook rejects unsupported URL schemes before touching the database", async () => {
    await expect(
      createNotificationWebhook("user-1", {
        url: "ftp://hooks.example.com/agx",
        events: ["task.completed"],
      })
    ).rejects.toThrow("Webhook URL must use http or https");

    expect(createAdminDbClient).not.toHaveBeenCalled();
  });

  test("notifyTaskEvent aborts slow webhook deliveries after the timeout", async () => {
    jest.useFakeTimers();

    (createAdminDbClient as jest.Mock).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  id: "webhook-1",
                  user_id: "user-1",
                  url: "https://hooks.example.com/agx",
                  name: "Primary",
                  events: ["task.completed"],
                  enabled: true,
                  created_at: "2026-04-18T00:00:00.000Z",
                  updated_at: "2026-04-18T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const fetchMock = jest.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    global.fetch = fetchMock as typeof fetch;

    const sendPromise = notifyTaskEvent({
      taskId: "task-1",
      userId: "user-1",
      eventType: "task.completed",
      title: "Ship notifications",
    });

    await jest.advanceTimersByTimeAsync(10_000);
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/agx",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "[notifications] failed to send to https://hooks.example.com/agx",
      expect.objectContaining({ message: expect.stringContaining("AbortError") })
    );
  });
});

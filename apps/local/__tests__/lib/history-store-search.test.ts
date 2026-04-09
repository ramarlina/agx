/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

function createTempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-history-search-"));
}

describe("searchMessages", () => {
  let historyDir = "";

  beforeEach(() => {
    jest.resetModules();
    historyDir = createTempHistoryDir();
    process.env.AGX_GROUP_CHAT_DIR = historyDir;
  });

  afterEach(() => {
    delete process.env.AGX_GROUP_CHAT_DIR;
    if (historyDir) {
      fs.rmSync(historyDir, { recursive: true, force: true });
    }
  });

  test("finds messages when query includes punctuation", async () => {
    const { saveMessages, searchMessages } = await import("@/lib/history-store");

    await saveMessages("thread-1", [
      {
        id: "msg-1",
        role: "assistant",
        participantId: "agent-1",
        content: "Heads-up: search should still find this message.",
        timestamp: 1000,
      },
    ]);

    const result = await searchMessages({ query: "Heads-up:" });

    expect(result.total).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        messageId: "msg-1",
      }),
    ]);
  });

  test("finds messages by partial word substring", async () => {
    const { saveMessages, searchMessages } = await import("@/lib/history-store");

    await saveMessages("thread-1", [
      {
        id: "msg-1",
        role: "assistant",
        participantId: "agent-1",
        content: "The deployment finished successfully.",
        timestamp: 1000,
      },
    ]);

    const result = await searchMessages({ query: "deploy" });

    expect(result.total).toBe(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        threadId: "thread-1",
        messageId: "msg-1",
      })
    );
    expect(result.results[0]?.snippet).toContain("<mark>deploy</mark>");
  });
});

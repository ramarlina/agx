/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

function createTempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-history-status-"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("getThreadStatusSnapshot", () => {
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

  test("returns scoped root message and mapped process statuses with response content", async () => {
    const { saveMessages, setReaction, getThreadStatusSnapshot } = await import("@/lib/history-store");
    const threadId = "thread-1";

    await saveMessages(threadId, [
      {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Build a status endpoint",
        timestamp: 1000,
      },
      {
        id: "assistant-1",
        role: "assistant",
        participantId: "jane",
        content: "I can take this",
        timestamp: 1100,
        rootMessageId: "root-1",
        parentMessageId: "root-1",
        depth: 1,
      },
      {
        id: "user-2",
        role: "user",
        participantId: null,
        content: "include process status too",
        timestamp: 1200,
        rootMessageId: "root-1",
        parentMessageId: "root-1",
        depth: 1,
      },
      {
        id: "assistant-2",
        role: "assistant",
        participantId: "flint",
        content: "implemented",
        timestamp: 1300,
        rootMessageId: "root-1",
        parentMessageId: "user-2",
        depth: 1,
      },
      {
        id: "other-root",
        role: "user",
        participantId: null,
        content: "separate thread root",
        timestamp: 1400,
      },
      {
        id: "other-reply",
        role: "assistant",
        participantId: "jewel",
        content: "separate reply",
        timestamp: 1500,
        rootMessageId: "other-root",
        parentMessageId: "other-root",
        depth: 1,
      },
    ]);

    await setReaction({
      threadId,
      messageId: "root-1",
      participantId: "jane",
      type: "working",
      hostPid: 1001,
    });
    await sleep(2);
    await setReaction({
      threadId,
      messageId: "user-2",
      participantId: "flint",
      type: "done",
      hostPid: 1002,
    });
    await sleep(2);
    await setReaction({
      threadId,
      messageId: "assistant-1",
      participantId: "jewel",
      type: "clarify",
      reason: "needs more context",
      hostPid: 1003,
    });
    await sleep(2);
    await setReaction({
      threadId,
      messageId: "other-root",
      participantId: "jewel",
      type: "done",
      hostPid: 1004,
    });

    const snapshot = await getThreadStatusSnapshot({
      threadId,
      messageLimit: 2,
      processLimit: 10,
    });

    expect(snapshot.rootMessage?.id).toBe("root-1");
    // Processes are now derived from assistant messages (not reactions),
    // so only agents with actual messages under root-1 appear.
    // jewel has a reaction but no message under root-1, so it's excluded.
    expect(snapshot.processes).toHaveLength(2);
    expect(snapshot.processes).toEqual([
      expect.objectContaining({
        processId: 1002,
        agent: "flint",
        responseToMessageId: "user-2",
        responseTo: "include process status too",
        responseToSenderName: "user",
        responseToSenderRole: "user",
        responseMessageId: "assistant-2",
        responseContent: "implemented",
        status: "done",
      }),
      expect.objectContaining({
        processId: 1001,
        agent: "jane",
        responseToMessageId: "root-1",
        responseTo: "Build a status endpoint",
        responseToSenderName: "user",
        responseToSenderRole: "user",
        responseMessageId: "assistant-1",
        responseContent: "I can take this",
        status: "running",
      }),
    ]);
    expect(snapshot.lastUpdatedAt).toBe(snapshot.processes[0].datetime);
  });

  test("returns empty snapshot when thread has no messages", async () => {
    const { getThreadStatusSnapshot } = await import("@/lib/history-store");

    const snapshot = await getThreadStatusSnapshot({
      threadId: "thread-1",
      messageLimit: 10,
      processLimit: 10,
    });

    expect(snapshot.rootMessage).toBeNull();
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.lastUpdatedAt).toBeNull();
  });

  test("derives earliest root message when multiple roots exist", async () => {
    const { saveMessages, getThreadStatusSnapshot } = await import("@/lib/history-store");
    const threadId = "thread-1";

    await saveMessages(threadId, [
      {
        id: "root-older",
        role: "user",
        participantId: null,
        content: "older root",
        timestamp: 1000,
      },
      {
        id: "root-newer",
        role: "user",
        participantId: null,
        content: "newer root",
        timestamp: 2000,
      },
      {
        id: "newer-reply",
        role: "assistant",
        participantId: "jane",
        content: "reply newer",
        timestamp: 2100,
        rootMessageId: "root-newer",
        parentMessageId: "root-newer",
        depth: 1,
      },
      {
        id: "older-reply",
        role: "assistant",
        participantId: "flint",
        content: "reply older",
        timestamp: 1200,
        rootMessageId: "root-older",
        parentMessageId: "root-older",
        depth: 1,
      },
    ]);

    const snapshot = await getThreadStatusSnapshot({
      threadId,
      messageLimit: 10,
      processLimit: 10,
    });

    expect(snapshot.rootMessage?.id).toBe("root-older");
    // Only agent messages under the derived root (root-older) appear as processes
    expect(snapshot.processes).toHaveLength(1);
    expect(snapshot.processes[0].agent).toBe("flint");
  });

  test("ignores stale running agent_process rows whose OS process is gone", async () => {
    const { saveMessages, getThreadStatusSnapshot } = await import("@/lib/history-store");
    const { register, getByThread } = await import("@/lib/agent-process-registry");
    const threadId = "thread-1";
    const now = Date.now();

    await saveMessages(threadId, [
      {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "What would this look like?",
        timestamp: now - 1000,
      },
    ]);

    register({
      workspaceId: threadId,
      threadId: "root-1",
      agentId: "jane",
      pid: 999999,
      state: "running",
      sinceMessageId: "root-1",
      responseMessageId: "jane-response-1",
      startedAt: now - 11 * 60 * 1000,
      lastActivity: now - 11 * 60 * 1000,
      projectSlug: "",
    });

    const snapshot = await getThreadStatusSnapshot({
      rootMessageId: "root-1",
      processLimit: 10,
      messageLimit: 10,
    });

    expect(snapshot.processes).toEqual([]);
    expect(getByThread("root-1")).toEqual([
      expect.objectContaining({
        agentId: "jane",
        state: "error",
      }),
    ]);
  });
});

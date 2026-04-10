/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

function createTempHistoryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agx-linear-runs-"));
}

describe("linear-run-store", () => {
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

  test("persists runs and reflects linked chat-run completion state", async () => {
    const { createLinearRun, updateLinearRun, listLinearRuns } = await import(
      "@/lib/linear-run-store"
    );
    const { createChatRun, saveMessages, updateChatRun } = await import("@/lib/history-store");

    const linearRun = await createLinearRun({
      projectId: "project-1",
      projectSlug: "alpha",
      issueId: "issue-1",
      issueIdentifier: "ENG-42",
      issueTitle: "Fix the Linear run flow",
      issueStatus: "In Progress",
      issueAssignee: "Mina",
      agentId: "agent-1",
      agentName: "Codex",
      mode: "scripted",
    });

    const chatRun = await createChatRun({
      id: "chat-run-1",
      threadId: linearRun.threadId,
      rootMessageId: "root-msg-1",
      userId: "user-1",
      projectSlug: "alpha",
      maxSteps: 8,
      activeParticipantIds: ["agent-1"],
    });

    await updateLinearRun({
      id: linearRun.id,
      chatRunId: chatRun.id,
      rootMessageId: "root-msg-1",
    });

    await saveMessages(linearRun.threadId, [
      {
        id: "root-msg-1",
        role: "user",
        participantId: null,
        content: "Follow up on the Linear run flow and make the session title readable in the UI",
        timestamp: Date.now(),
        rootMessageId: null,
        parentMessageId: null,
        depth: 0,
      },
    ]);

    await updateChatRun({
      id: chatRun.id,
      status: "completed",
      completedAt: chatRun.createdAt + 1500,
    });

    const runs = await listLinearRuns({
      issueId: "issue-1",
      projectId: "project-1",
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        id: linearRun.id,
        issueIdentifier: "ENG-42",
        chatRunId: "chat-run-1",
        rootMessageId: "root-msg-1",
        agentName: "Codex",
        mode: "scripted",
        sessionTitle: null,
        status: "success",
        durationMs: 1500,
      })
    );
  });

  test("surfaces startup failures even when no chat run was attached", async () => {
    const { createLinearRun, updateLinearRun, getLinearRun } = await import(
      "@/lib/linear-run-store"
    );

    const linearRun = await createLinearRun({
      issueId: "issue-2",
      issueIdentifier: "ENG-99",
      issueTitle: "Handle missing agents",
      issueStatus: "Todo",
      agentId: "agent-2",
      agentName: "Verifier",
    });

    await updateLinearRun({
      id: linearRun.id,
      status: "failed",
      error: "No active agents configured for this project",
    });

    const stored = await getLinearRun(linearRun.id);

    expect(stored).toEqual(
      expect.objectContaining({
        id: linearRun.id,
        mode: "chat",
        sessionTitle: null,
        status: "failed",
        lastError: "No active agents configured for this project",
      })
    );
  });

  test("derives a chat session title from the root user message", async () => {
    const { createLinearRun, updateLinearRun, getLinearRun } = await import(
      "@/lib/linear-run-store"
    );
    const { saveMessages } = await import("@/lib/history-store");

    const linearRun = await createLinearRun({
      issueId: "issue-3",
      issueIdentifier: "ENG-123",
      issueTitle: "Improve session list labels",
      issueStatus: "Todo",
      agentId: "agent-3",
      agentName: "Planner",
      mode: "chat",
    });

    await saveMessages(linearRun.threadId, [
      {
        id: "root-msg-3",
        role: "user",
        participantId: null,
        content: "Make the chat session title come from the first message instead of the status badge text.",
        timestamp: Date.now(),
        rootMessageId: null,
        parentMessageId: null,
        depth: 0,
      },
    ]);

    await updateLinearRun({
      id: linearRun.id,
      rootMessageId: "root-msg-3",
    });

    const stored = await getLinearRun(linearRun.id);

    expect(stored).toEqual(
      expect.objectContaining({
        id: linearRun.id,
        mode: "chat",
        sessionTitle: expect.stringMatching(
          /^Make the chat session title come from the first message/
        ),
      })
    );
  });
});

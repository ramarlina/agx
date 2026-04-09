/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockSweepStaleWorkingReactions = jest.fn();
const mockGetThreadStatusSnapshot = jest.fn();
const mockGetMessageThread = jest.fn();
const mockGetAttachmentsForMessages = jest.fn();
const mockLoadLogsByProcessPids = jest.fn();

jest.mock("@/lib/history-store", () => ({
  sweepStaleWorkingReactions: (...args: unknown[]) => mockSweepStaleWorkingReactions(...args),
  getThreadStatusSnapshot: (...args: unknown[]) => mockGetThreadStatusSnapshot(...args),
  getMessageThread: (...args: unknown[]) => mockGetMessageThread(...args),
  loadLogsByProcessPids: (...args: unknown[]) => mockLoadLogsByProcessPids(...args),
}));

jest.mock("@/lib/attachment-store", () => ({
  getAttachmentsForMessages: (...args: unknown[]) => mockGetAttachmentsForMessages(...args),
}));

describe("/api/history/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSweepStaleWorkingReactions.mockResolvedValue({ updated: 0 });
    mockGetMessageThread.mockResolvedValue({ threadId: "workspace-1" });
    mockGetAttachmentsForMessages.mockResolvedValue(new Map());
    mockGetThreadStatusSnapshot.mockResolvedValue({
      rootMessage: null,
      processes: [],
      lastUpdatedAt: null,
    });
    mockLoadLogsByProcessPids.mockResolvedValue([]);
  });

  test("returns 400 when rootMessageId is missing", async () => {
    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status");
    const response = await GET(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "rootMessageId is required" });
  });

  test("uses rootMessageId as primary lookup key", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Need an endpoint",
        timestamp: 1000,
      },
      processes: [],
      lastUpdatedAt: 1000,
    });

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1&format=json");
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        threadId: "workspace-1",
        rootMessageId: "root-1",
      })
    );
    expect(mockGetMessageThread).toHaveBeenCalledWith("root-1");
    expect(mockGetThreadStatusSnapshot).toHaveBeenCalledWith({
      threadId: "workspace-1",
      rootMessageId: "root-1",
      messageLimit: 10,
      processLimit: 10,
    });
  });

  test("returns 404 when rootMessageId does not resolve to a thread", async () => {
    mockGetMessageThread.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=missing-root");
    const response = await GET(request);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Root message not found" });
    expect(mockSweepStaleWorkingReactions).not.toHaveBeenCalled();
    expect(mockGetThreadStatusSnapshot).not.toHaveBeenCalled();
  });

  test("returns 404 when root message is not found", async () => {
    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1");
    const response = await GET(request);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Root message not found" });
    expect(mockSweepStaleWorkingReactions).toHaveBeenCalledWith("workspace-1");
    expect(mockGetThreadStatusSnapshot).toHaveBeenCalledWith({
      threadId: "workspace-1",
      rootMessageId: "root-1",
      messageLimit: 10,
      processLimit: 10,
    });
  });

  test("returns scoped thread status with attachments", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Need an endpoint",
        timestamp: 1000,
      },
      processes: [
        {
          processId: 4242,
          datetime: 1200,
          agent: "jane",
          responseTo: "Need an endpoint",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: "assistant-1",
          responseContent: "Working on it",
          status: "running",
        },
      ],
      lastUpdatedAt: 1200,
    });
    mockGetAttachmentsForMessages.mockResolvedValueOnce(
      new Map([
        [
          "root-1",
          [
            {
              id: "att-1",
              filename: "spec.md",
              mimeType: "text/markdown",
              size: 10,
              status: "uploaded",
            },
          ],
        ],
      ])
    );

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest(
      "http://localhost/api/history/status?rootMessageId=root-1&messageLimit=5&processLimit=7&format=json"
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threadId).toBe("workspace-1");
    expect(data.rootMessageId).toBe("root-1");
    expect(data.rootMessage.attachments).toEqual([
      {
        id: "att-1",
        filename: "spec.md",
        mimeType: "text/markdown",
        size: 10,
        status: "uploaded",
      },
    ]);
    expect(data.messages).toBeUndefined();
    expect(data.processes).toEqual([
      {
        processId: 4242,
        datetime: 1200,
        agent: "jane",
        responseTo: "Need an endpoint",
        responseToMessageId: "root-1",
        responseToSenderName: "user",
        responseToSenderRole: "user",
        responseMessageId: "assistant-1",
        responseContent: "Working on it",
        status: "running",
      },
    ]);
    expect(mockGetThreadStatusSnapshot).toHaveBeenCalledWith({
      threadId: "workspace-1",
      rootMessageId: "root-1",
      messageLimit: 5,
      processLimit: 7,
    });
    expect(mockGetAttachmentsForMessages).toHaveBeenCalledWith(["root-1"]);
  });

  test("returns untruncated markdown when format=md", async () => {
    const longResponseTo = "This is the full response target text that should not be truncated ".repeat(4).trim();
    const longResponseContent = "This is the full assistant response content that should be included ".repeat(5).trim();

    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Need an endpoint",
        timestamp: 1000,
      },
      processes: [
        {
          processId: 4242,
          datetime: 1200,
          agent: "jane",
          responseTo: longResponseTo,
          responseToMessageId: "assistant-1",
          responseToSenderName: "jane",
          responseToSenderRole: "assistant",
          responseMessageId: "assistant-2",
          responseContent: longResponseContent,
          status: "done",
        },
      ],
      lastUpdatedAt: 1200,
    });

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1");
    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(body).toContain("## Initial Request");
    expect(body).toContain("## Messages");
    expect(body).toContain("## Processes (1)");
    expect(body).toContain("- pid: 4242");
    expect(body).toContain("agent: jane");
    expect(body).toContain(longResponseTo);
    expect(body).toContain(longResponseContent);
    expect(body).toContain("respondingToSender: jane");
    expect(body).not.toContain("> **");
    expect(body).not.toContain("| Host PID |");
    expect(body).not.toContain("…");
  });

  test("returns markdown by default (no format param)", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Hello",
        timestamp: 1000,
      },
      processes: [],
      lastUpdatedAt: 1000,
    });

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
  });

  test("returns compact JSON by default for curl clients", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Hello",
        timestamp: 1000,
        threadStatus: "active",
        outcomeNote: null,
      },
      messages: [
        {
          id: "root-1",
          role: "user",
          participantId: null,
          content: "Hello",
          timestamp: 1000,
          parentMessageId: null,
          processId: null,
          status: null,
        },
      ],
      processes: [
        {
          processId: 4242,
          datetime: 1200,
          agent: "jane",
          responseTo: "Hello",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: null,
          responseContent: null,
          status: "running",
        },
      ],
      lastUpdatedAt: 1300,
    });

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1", {
      headers: { "user-agent": "curl/8.7.1" },
    });
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(
      expect.objectContaining({
        activeProcessCount: 1,
        lastMessageAt: 1300,
        messageCount: 1,
        threadId: "workspace-1",
        rootMessageId: "root-1",
        threadStatus: "active",
      }),
    );
  });

  test("includes logs section for running/failed processes in JSON", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Hello",
        timestamp: 1000,
      },
      processes: [
        {
          processId: 4242,
          datetime: 1200,
          agent: "jane",
          responseTo: "Hello",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: null,
          responseContent: null,
          status: "running",
        },
        {
          processId: 4243,
          datetime: 1300,
          agent: "flint",
          responseTo: "Hello",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: "a-2",
          responseContent: "done",
          status: "done",
        },
      ],
      lastUpdatedAt: 1300,
    });
    mockLoadLogsByProcessPids.mockResolvedValueOnce([
      { processId: 4242, agent: "jane", stream: "stdout", line: "starting up", timestamp: 1201 },
    ]);

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1&format=json");
    const response = await GET(request);
    const data = await response.json();

    expect(data.logs).toEqual([
      { processId: 4242, agent: "jane", stream: "stdout", line: "starting up", timestamp: 1201 },
    ]);
    // Only running process PID should be passed (not the done one)
    expect(mockLoadLogsByProcessPids).toHaveBeenCalledWith([4242]);
  });

  test("includes logs section in markdown output", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Hello",
        timestamp: 1000,
      },
      processes: [
        {
          processId: 5555,
          datetime: 1200,
          agent: "jane",
          responseTo: "Hello",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: null,
          responseContent: null,
          status: "failed",
        },
      ],
      lastUpdatedAt: 1200,
    });
    mockLoadLogsByProcessPids.mockResolvedValueOnce([
      { processId: 5555, agent: "jane", stream: "stderr", line: "error occurred", timestamp: 1201 },
    ]);

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1");
    const response = await GET(request);
    const body = await response.text();

    expect(body).toContain("## Failed");
    expect(body).toContain("- pid: 5555");
    expect(body).toContain("logs: |");
    expect(body).toContain("error occurred");
  });

  test("includes running section in markdown output", async () => {
    mockGetThreadStatusSnapshot.mockResolvedValueOnce({
      rootMessage: {
        id: "root-1",
        role: "user",
        participantId: null,
        content: "Hello",
        timestamp: 1000,
      },
      processes: [
        {
          processId: 7777,
          datetime: 1300,
          agent: "jane",
          responseTo: "Please implement this",
          responseToMessageId: "root-1",
          responseToSenderName: "user",
          responseToSenderRole: "user",
          responseMessageId: null,
          responseContent: "Working on it",
          status: "running",
        },
      ],
      lastUpdatedAt: 1300,
    });

    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest("http://localhost/api/history/status?rootMessageId=root-1");
    const response = await GET(request);
    const body = await response.text();

    expect(body).toContain("## Running");
    expect(body).toContain("- pid: 7777");
    expect(body).toContain("respondingToSender: user");
    expect(body).toContain("Please implement this");
  });

  test("clamps requested limits", async () => {
    const { GET } = await import("@/app/api/history/status/route");
    const request = new NextRequest(
      "http://localhost/api/history/status?rootMessageId=root-1&messageLimit=0&processLimit=999"
    );
    await GET(request);

    expect(mockGetThreadStatusSnapshot).toHaveBeenCalledWith({
      threadId: "workspace-1",
      rootMessageId: "root-1",
      messageLimit: 1,
      processLimit: 100,
    });
  });
});

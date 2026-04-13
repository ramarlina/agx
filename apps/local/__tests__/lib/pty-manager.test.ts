import { EventEmitter } from "events";

const mockFsExistsSync = jest.fn();
const mockFsChmodSync = jest.fn();
const mockNodePtySpawn = jest.fn();
const mockChildSpawn = jest.fn();
const nodePtyProcesses: ReturnType<typeof createMockNodePtyProcess>[] = [];

jest.mock("fs", () => {
  const api = {
    existsSync: (...args: unknown[]) => mockFsExistsSync(...args),
    chmodSync: (...args: unknown[]) => mockFsChmodSync(...args),
  };
  return {
    __esModule: true,
    default: api,
    ...api,
  };
});

jest.mock("node-pty", () => ({
  spawn: (...args: unknown[]) => mockNodePtySpawn(...args),
}));

jest.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockChildSpawn(...args),
}));

function createMockNodePtyProcess() {
  let onDataHandler: ((data: string) => void) | null = null;
  let onExitHandler: ((event: { exitCode: number }) => void) | null = null;

  return {
    onData: jest.fn((handler: (data: string) => void) => {
      onDataHandler = handler;
    }),
    onExit: jest.fn((handler: (event: { exitCode: number }) => void) => {
      onExitHandler = handler;
    }),
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    __emitData(data: string) {
      onDataHandler?.(data);
    },
    __emitExit(exitCode: number) {
      onExitHandler?.({ exitCode });
    },
  };
}

class MockCompatProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: jest.fn() };
  kill = jest.fn(() => {
    this.emit("exit", null);
  });
}

describe("pty-manager", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    mockFsExistsSync.mockReset();
    mockFsChmodSync.mockReset();
    mockNodePtySpawn.mockReset();
    mockChildSpawn.mockReset();
    nodePtyProcesses.length = 0;
    mockFsExistsSync.mockReturnValue(false);
    mockNodePtySpawn.mockImplementation(() => {
      const proc = createMockNodePtyProcess();
      nodePtyProcesses.push(proc);
      return proc;
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("replays buffered output to new subscribers", async () => {
    const { createSession, getSession, subscribeToSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-1", "/tmp");
    getSession("session-1");
    const proc = nodePtyProcesses[0];

    proc.__emitData("hello ");
    proc.__emitData("world");

    const onData = jest.fn();
    const unsubscribe = subscribeToSession("session-1", { onData });

    expect(onData).toHaveBeenCalledWith("hello world");

    unsubscribe();
    destroySession("session-1");
  });

  it("notifies subscribers when the session exits", async () => {
    const { createSession, getSession, subscribeToSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-2", "/tmp");
    getSession("session-2");
    const proc = nodePtyProcesses[0];

    const onExit = jest.fn();
    subscribeToSession("session-2", { onExit });

    proc.__emitExit(7);

    expect(onExit).toHaveBeenCalledWith({ exitCode: 7 });

    destroySession("session-2");
  });

  it("keeps detached live sessions until they are explicitly destroyed", async () => {
    const { createSession, getSession, subscribeToSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-3", "/tmp");
    const session = getSession("session-3");
    expect(session).toBeDefined();

    const unsubscribe = subscribeToSession("session-3", {});
    unsubscribe();

    expect(getSession("session-3")).toBeDefined();

    jest.advanceTimersByTime(24 * 60 * 60_000);

    expect(nodePtyProcesses[0]?.kill).not.toHaveBeenCalled();
    expect(getSession("session-3")).toBeDefined();

    destroySession("session-3");
    expect(nodePtyProcesses[0]?.kill).toHaveBeenCalledTimes(1);
    expect(getSession("session-3")).toBeUndefined();
  });

  it("keeps exited sessions available until they are explicitly removed", async () => {
    const { createSession, getSession, subscribeToSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-4", "/tmp");
    getSession("session-4");
    const proc = nodePtyProcesses[0];

    const unsubscribe = subscribeToSession("session-4", {});
    proc.__emitExit(0);
    unsubscribe();

    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(getSession("session-4")).toBeDefined();

    expect(proc.kill).not.toHaveBeenCalled();

    destroySession("session-4");
    expect(getSession("session-4")).toBeUndefined();
  });

  it("repairs the node-pty spawn helper permissions before spawning", async () => {
    mockFsExistsSync.mockImplementation((candidate: string) => candidate.includes("spawn-helper"));

    const { createSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-5", "/tmp");

    expect(mockFsChmodSync).toHaveBeenCalledWith(
      expect.stringContaining("spawn-helper"),
      0o755,
    );

    destroySession("session-5");
  });

  it("falls back to the compatibility backend when node-pty fails", async () => {
    const compatProcess = new MockCompatProcess();
    mockNodePtySpawn.mockImplementation(() => {
      throw new Error("posix_spawnp failed.");
    });
    mockChildSpawn.mockImplementation(() => compatProcess);

    const { createSession, getSession, subscribeToSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-6", "/tmp");
    const session = getSession("session-6");

    expect(session?.backend).toBe("compat");

    const onData = jest.fn();
    subscribeToSession("session-6", { onData });

    expect(onData).toHaveBeenCalledWith(
      expect.stringContaining("AGX terminal compatibility mode"),
    );

    compatProcess.stdout.emit("data", Buffer.from("hello from compat"));

    expect(onData).toHaveBeenCalledWith("hello from compat");

    destroySession("session-6");
    expect(compatProcess.kill).toHaveBeenCalledTimes(1);
  });

  it("falls back to compatibility mode when loading node-pty throws", async () => {
    const compatProcess = new MockCompatProcess();
    mockChildSpawn.mockImplementation(() => compatProcess);

    jest.doMock("node-pty", () => {
      throw new Error("native binary missing");
    });

    const { createSession, getSession, destroySession } = await import("@/lib/pty-manager");

    createSession("session-7", "/tmp");
    const session = getSession("session-7");

    expect(session?.backend).toBe("compat");
    expect(session?.outputBuffer).toContain("AGX terminal compatibility mode");

    destroySession("session-7");
    expect(compatProcess.kill).toHaveBeenCalledTimes(1);
  });
});

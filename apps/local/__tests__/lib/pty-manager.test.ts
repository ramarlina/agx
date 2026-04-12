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

  it("cleans up detached live sessions after the grace period", async () => {
    const { createSession, getSession, subscribeToSession } = await import("@/lib/pty-manager");

    createSession("session-3", "/tmp");
    const session = getSession("session-3");
    expect(session).toBeDefined();

    const unsubscribe = subscribeToSession("session-3", {});
    unsubscribe();

    expect(getSession("session-3")).toBeDefined();

    jest.advanceTimersByTime(5 * 60_000);

    expect(nodePtyProcesses[0]?.kill).toHaveBeenCalledTimes(1);
    expect(getSession("session-3")).toBeUndefined();
  });

  it("retains exited sessions only for the shorter exit window", async () => {
    const { createSession, getSession, subscribeToSession } = await import("@/lib/pty-manager");

    createSession("session-4", "/tmp");
    getSession("session-4");
    const proc = nodePtyProcesses[0];

    const unsubscribe = subscribeToSession("session-4", {});
    proc.__emitExit(0);
    unsubscribe();

    jest.advanceTimersByTime(59_000);
    expect(getSession("session-4")).toBeDefined();

    jest.advanceTimersByTime(1_000);
    expect(proc.kill).not.toHaveBeenCalled();
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
});

import React, { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import TerminalPane from "@/components/terminal/TerminalPane";

type MockState = {
  terminalInstances: Array<{
    cols: number;
    rows: number;
    loadAddon: jest.Mock;
    open: jest.Mock;
    write: jest.Mock;
    writeln: jest.Mock;
    dispose: jest.Mock;
    focus: jest.Mock;
    onData: jest.Mock;
  }>;
  fitAddonInstances: Array<{ fit: jest.Mock }>;
  webSocketInstances: MockWebSocket[];
};

function getMockState(): MockState {
  const globalState = globalThis as typeof globalThis & {
    __terminalPaneTestState?: MockState;
  };

  if (!globalState.__terminalPaneTestState) {
    globalState.__terminalPaneTestState = {
      terminalInstances: [],
      fitAddonInstances: [],
      webSocketInstances: [],
    };
  }

  return globalState.__terminalPaneTestState;
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  constructor(public readonly url: string) {
    getMockState().webSocketInstances.push(this);
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

jest.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon = jest.fn();
    open = jest.fn();
    write = jest.fn();
    writeln = jest.fn();
    dispose = jest.fn();
    focus = jest.fn();
    onData = jest.fn(() => ({ dispose: jest.fn() }));

    constructor() {
      getMockState().terminalInstances.push(this);
    }
  },
}));

jest.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = jest.fn();

    constructor() {
      getMockState().fitAddonInstances.push(this);
    }
  },
}));

describe("TerminalPane", () => {
  beforeEach(() => {
    jest.useFakeTimers();

    const mockState = getMockState();
    mockState.terminalInstances.length = 0;
    mockState.fitAddonInstances.length = 0;
    mockState.webSocketInstances.length = 0;

    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });

    Object.defineProperty(globalThis, "ResizeObserver", {
      writable: true,
      value: window.ResizeObserver,
    });

    Object.defineProperty(window, "WebSocket", {
      writable: true,
      value: MockWebSocket,
    });

    Object.defineProperty(globalThis, "WebSocket", {
      writable: true,
      value: MockWebSocket,
    });

    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });

    Object.defineProperty(globalThis, "requestAnimationFrame", {
      writable: true,
      value: window.requestAnimationFrame,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("creates only one websocket under Strict Mode", () => {
    render(
      <StrictMode>
        <TerminalPane tabId="tab-1" />
      </StrictMode>,
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const { webSocketInstances } = getMockState();
    expect(webSocketInstances).toHaveLength(1);
    expect(webSocketInstances[0]?.url).toBe("ws://localhost/ws/terminal");
  });

  it("waits for a connecting websocket to open before closing during cleanup", () => {
    const { unmount } = render(<TerminalPane tabId="tab-1" />);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const socket = getMockState().webSocketInstances[0];
    expect(socket).toBeDefined();
    expect(socket.close).not.toHaveBeenCalled();

    unmount();

    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();

    act(() => {
      socket.emitOpen();
    });

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("reconnects after an unexpected disconnect", () => {
    const onStatusChange = jest.fn();

    render(<TerminalPane tabId="tab-1" onStatusChange={onStatusChange} />);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const firstSocket = getMockState().webSocketInstances[0];
    act(() => {
      firstSocket.emitOpen();
      firstSocket.emitMessage({ type: "ready", id: "tab-1" });
    });

    firstSocket.close();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(getMockState().webSocketInstances).toHaveLength(2);
    expect(onStatusChange).toHaveBeenCalledWith("active");
  });

  it("does not reconnect after the shell exits", () => {
    const onStatusChange = jest.fn();

    render(<TerminalPane tabId="tab-1" onStatusChange={onStatusChange} />);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    const firstSocket = getMockState().webSocketInstances[0];
    act(() => {
      firstSocket.emitOpen();
      firstSocket.emitMessage({ type: "ready", id: "tab-1" });
      firstSocket.emitMessage({ type: "exit", exitCode: 0 });
    });

    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(getMockState().webSocketInstances).toHaveLength(1);
    expect(onStatusChange).toHaveBeenCalledWith("exited");
  });
});

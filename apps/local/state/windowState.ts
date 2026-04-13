/**
 * Window state persistence for native desktop feel.
 * Persists window bounds, sidebar widths, and scroll positions across sessions.
 */

const WINDOW_STATE_KEY = "agx:windowState";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface SidebarState {
  workspaceWidth: number;
  logPanelHeight: number;
  workspaceVisible: boolean;
  logPanelVisible: boolean;
  linearTicketPanelWidth: number;
  linearRunsPanelWidth: number;
  objectiveChatPanelWidth: number;
  objectiveListPanelWidth: number;
}

export interface ScrollState {
  lastThreadId: string | null;
  lastWorkspaceId: string | null;
}

export interface WindowState {
  bounds: WindowBounds | null;
  sidebar: SidebarState;
  scroll: ScrollState;
}

const DEFAULT_SIDEBAR: SidebarState = {
  workspaceWidth: 260,
  logPanelHeight: 200,
  workspaceVisible: true,
  logPanelVisible: false,
  linearTicketPanelWidth: 576,
  linearRunsPanelWidth: 224,
  objectiveChatPanelWidth: 440,
  objectiveListPanelWidth: 320,
};

const DEFAULT_SCROLL: ScrollState = {
  lastThreadId: null,
  lastWorkspaceId: null,
};

const DEFAULT_WINDOW_STATE: WindowState = {
  bounds: null,
  sidebar: DEFAULT_SIDEBAR,
  scroll: DEFAULT_SCROLL,
};

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readWindowState(): WindowState {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_WINDOW_STATE };
  }

  const raw = window.localStorage.getItem(WINDOW_STATE_KEY);
  if (!raw) {
    return { ...DEFAULT_WINDOW_STATE };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      bounds: parsed.bounds || null,
      sidebar: {
        ...DEFAULT_SIDEBAR,
        ...(parsed.sidebar || {}),
      },
      scroll: {
        ...DEFAULT_SCROLL,
        ...(parsed.scroll || {}),
      },
    };
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function writeWindowState(state: WindowState): void {
  if (!isStorageAvailable()) return;

  try {
    window.localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

// Window bounds
export function loadWindowBounds(): WindowBounds | null {
  return readWindowState().bounds;
}

export function persistWindowBounds(bounds: WindowBounds): void {
  const state = readWindowState();
  state.bounds = bounds;
  writeWindowState(state);
}

// Sidebar state
export function loadSidebarState(): SidebarState {
  return readWindowState().sidebar;
}

export function persistSidebarState(sidebar: Partial<SidebarState>): void {
  const state = readWindowState();
  state.sidebar = { ...state.sidebar, ...sidebar };
  writeWindowState(state);
}

export function loadWorkspaceWidth(): number {
  return loadSidebarState().workspaceWidth;
}

export function persistWorkspaceWidth(width: number): void {
  persistSidebarState({ workspaceWidth: width });
}

export function loadLogPanelHeight(): number {
  return loadSidebarState().logPanelHeight;
}

export function persistLogPanelHeight(height: number): void {
  persistSidebarState({ logPanelHeight: height });
}

export function loadWorkspaceVisible(): boolean {
  return loadSidebarState().workspaceVisible;
}

export function persistWorkspaceVisible(visible: boolean): void {
  persistSidebarState({ workspaceVisible: visible });
}

export function loadLogPanelVisible(): boolean {
  return loadSidebarState().logPanelVisible;
}

export function persistLogPanelVisible(visible: boolean): void {
  persistSidebarState({ logPanelVisible: visible });
}

// Scroll/navigation state
export function loadScrollState(): ScrollState {
  return readWindowState().scroll;
}

export function persistScrollState(scroll: Partial<ScrollState>): void {
  const state = readWindowState();
  state.scroll = { ...state.scroll, ...scroll };
  writeWindowState(state);
}

export function loadLastThreadId(): string | null {
  return loadScrollState().lastThreadId;
}

export function persistLastThreadId(threadId: string | null): void {
  persistScrollState({ lastThreadId: threadId });
}

export function loadLastWorkspaceId(): string | null {
  return loadScrollState().lastWorkspaceId;
}

export function persistLastWorkspaceId(workspaceId: string | null): void {
  persistScrollState({ lastWorkspaceId: workspaceId });
}

// Linear panel widths
export function loadLinearTicketPanelWidth(): number {
  return loadSidebarState().linearTicketPanelWidth;
}

export function persistLinearTicketPanelWidth(width: number): void {
  persistSidebarState({ linearTicketPanelWidth: width });
}

export function loadLinearRunsPanelWidth(): number {
  return loadSidebarState().linearRunsPanelWidth;
}

export function persistLinearRunsPanelWidth(width: number): void {
  persistSidebarState({ linearRunsPanelWidth: width });
}

export function loadObjectiveChatPanelWidth(): number {
  return loadSidebarState().objectiveChatPanelWidth;
}

export function persistObjectiveChatPanelWidth(width: number): void {
  persistSidebarState({ objectiveChatPanelWidth: width });
}

// Objective list panel width
export function loadObjectiveListPanelWidth(): number {
  return loadSidebarState().objectiveListPanelWidth;
}

export function persistObjectiveListPanelWidth(width: number): void {
  persistSidebarState({ objectiveListPanelWidth: width });
}

// Clear all window state (for logout/reset)
export function clearWindowState(): void {
  if (!isStorageAvailable()) return;
  window.localStorage.removeItem(WINDOW_STATE_KEY);
}

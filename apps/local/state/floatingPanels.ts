export interface FloatingPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type FloatingPanelState = Record<string, FloatingPanelBounds>;

const FLOATING_PANELS_STORAGE_KEY = "agx:floatingPanels";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readState(): FloatingPanelState {
  if (!canUseStorage()) return {};

  try {
    const raw = window.localStorage.getItem(FLOATING_PANELS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FloatingPanelState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state: FloatingPanelState): void {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(FLOATING_PANELS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function loadFloatingPanelBounds(panelId: string): FloatingPanelBounds | null {
  return readState()[panelId] ?? null;
}

export function persistFloatingPanelBounds(panelId: string, bounds: FloatingPanelBounds): void {
  const state = readState();
  state[panelId] = bounds;
  writeState(state);
}

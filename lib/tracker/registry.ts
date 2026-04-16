import type { TrackerAdapter } from "./tracker-adapter";

const adapters: Map<string, TrackerAdapter> = new Map();

export function registerAdapter(adapter: TrackerAdapter): void {
  if (adapters.has(adapter.type)) {
    throw new Error(`Tracker adapter "${adapter.type}" is already registered`);
  }
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: string): TrackerAdapter {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(
      `Unknown tracker type: "${type}". Available: ${listAdapterTypes().join(", ")}`
    );
  }
  return adapter;
}

export function getAdapterOrNull(type: string): TrackerAdapter | null {
  return adapters.get(type) ?? null;
}

export function listAdapterTypes(): string[] {
  return [...adapters.keys()];
}

export function listAdapters(): TrackerAdapter[] {
  return [...adapters.values()];
}
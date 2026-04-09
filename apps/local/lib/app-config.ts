const DEFAULT_LOCAL_APP_PORT = 41741;

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

export const LOCAL_APP_PORT = DEFAULT_LOCAL_APP_PORT;
export const LOCAL_APP_URL = `http://localhost:${LOCAL_APP_PORT}`;

export function getConfiguredAppBaseUrl(): string {
  return (
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrl(process.env.AGX_BOARD_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_AGX_BOARD_URL) ??
    LOCAL_APP_URL
  );
}

export function getConfiguredBoardBaseUrl(): string {
  return (
    normalizeBaseUrl(process.env.AGX_BOARD_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_AGX_BOARD_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    LOCAL_APP_URL
  );
}

export function getConfiguredLocalServerPort(): string {
  return process.env.PORT?.trim() || String(LOCAL_APP_PORT);
}

export function getAllowedOrigins(): string[] {
  const origins = new Set<string>([
    LOCAL_APP_URL,
    `http://127.0.0.1:${LOCAL_APP_PORT}`,
  ]);

  for (const value of [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.AGX_BOARD_URL,
    process.env.NEXT_PUBLIC_AGX_BOARD_URL,
  ]) {
    const normalized = normalizeBaseUrl(value);
    if (normalized) {
      origins.add(normalized);
    }
  }

  return Array.from(origins);
}

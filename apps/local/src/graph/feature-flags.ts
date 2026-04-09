function normalizeFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function isDualWriteEnabled(): boolean {
  return normalizeFlag(process.env.AGX_GRAPH_DUAL_WRITE, true);
}

export function isParityLoggingEnabled(): boolean {
  return normalizeFlag(process.env.AGX_GRAPH_PARITY_LOGGING, true);
}

export function isReadPathKillSwitchEnabled(): boolean {
  return normalizeFlag(process.env.AGX_GRAPH_READ_PATH_KILL_SWITCH, false);
}

export function isV2ReadPathEnabled(): boolean {
  if (isReadPathKillSwitchEnabled()) {
    return false;
  }

  const mode = (process.env.AGX_GRAPH_READ_PATH_MODE || "v1").trim().toLowerCase();
  return mode === "v2";
}

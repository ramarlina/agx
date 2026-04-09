import { CSSProperties } from "react";

export interface AnsiSegment {
  text: string;
  style?: CSSProperties;
}

interface StyleState {
  color?: string;
  fontStyle?: CSSProperties["fontStyle"];
  fontWeight?: CSSProperties["fontWeight"];
  textDecoration?: CSSProperties["textDecoration"];
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: "#94a3b8", // black (brightened for dark bg readability)
  31: "#f87171",
  32: "#4ade80",
  33: "#facc15",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#22d3ee",
  37: "#e2e8f0",
  90: "#64748b",
  91: "#ef4444",
  92: "#22c55e",
  93: "#eab308",
  94: "#3b82f6",
  95: "#a855f7",
  96: "#06b6d4",
  97: "#f8fafc",
};

const SGR_REGEX = /\u001b\[([0-9;]*)m/g;
const STANDALONE_SGR_REGEX = /(^|\s)\[((?:\d{1,3};)*\d{1,3})m(\s|$)/g;

function normalizeInput(input: string): string {
  // Some upstream transports strip ESC but keep `[35m` tokens. Remove only
  // standalone SGR-like tokens to prevent noisy artifacts in logs.
  return input.replace(STANDALONE_SGR_REGEX, (_match, prefix: string, _codes: string, suffix: string) => {
    if (prefix && suffix) return " ";
    return prefix || suffix || "";
  });
}

function applySgrCodes(state: StyleState, codeString: string): StyleState {
  const next: StyleState = { ...state };
  const parts = (codeString || "0")
    .split(";")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i];
    if (code === 0) {
      delete next.color;
      delete next.fontStyle;
      delete next.fontWeight;
      delete next.textDecoration;
      continue;
    }

    if (code === 1) {
      next.fontWeight = 700;
      continue;
    }
    if (code === 3) {
      next.fontStyle = "italic";
      continue;
    }
    if (code === 4) {
      next.textDecoration = "underline";
      continue;
    }
    if (code === 22) {
      delete next.fontWeight;
      continue;
    }
    if (code === 23) {
      delete next.fontStyle;
      continue;
    }
    if (code === 24) {
      delete next.textDecoration;
      continue;
    }
    if (code === 39) {
      delete next.color;
      continue;
    }

    if (code === 38) {
      const mode = parts[i + 1];
      if (mode === 5 && Number.isFinite(parts[i + 2])) {
        // ANSI 256-color approximation uses browser-supported HSL for color cube.
        const paletteValue = parts[i + 2];
        next.color = ansi256ToColor(paletteValue);
        i += 2;
      } else if (
        mode === 2 &&
        Number.isFinite(parts[i + 2]) &&
        Number.isFinite(parts[i + 3]) &&
        Number.isFinite(parts[i + 4])
      ) {
        const r = clampRgb(parts[i + 2]);
        const g = clampRgb(parts[i + 3]);
        const b = clampRgb(parts[i + 4]);
        next.color = `rgb(${r}, ${g}, ${b})`;
        i += 4;
      }
      continue;
    }

    if (ANSI_COLOR_MAP[code]) {
      next.color = ANSI_COLOR_MAP[code];
    }
  }

  return next;
}

function clampRgb(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function ansi256ToColor(value: number): string {
  const safe = Math.max(0, Math.min(255, value));
  if (safe < 16) {
    // Map core palette values onto existing color map where possible.
    const fallbackCodes = [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97];
    return ANSI_COLOR_MAP[fallbackCodes[safe]] || "#e2e8f0";
  }
  if (safe >= 232) {
    const gray = Math.round(((safe - 232) / 23) * 255);
    return `rgb(${gray}, ${gray}, ${gray})`;
  }

  const index = safe - 16;
  const r = Math.floor(index / 36);
  const g = Math.floor((index % 36) / 6);
  const b = index % 6;
  const toChannel = (v: number) => (v === 0 ? 0 : v * 40 + 55);
  return `rgb(${toChannel(r)}, ${toChannel(g)}, ${toChannel(b)})`;
}

export function parseAnsiSegments(input: string): AnsiSegment[] {
  if (!input) return [];

  const normalized = normalizeInput(input);
  const segments: AnsiSegment[] = [];
  let style: StyleState = {};
  let cursor = 0;

  for (const match of normalized.matchAll(SGR_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      const text = normalized.slice(cursor, start);
      segments.push({ text, style: Object.keys(style).length ? { ...style } : undefined });
    }
    style = applySgrCodes(style, match[1] || "0");
    cursor = start + match[0].length;
  }

  if (cursor < normalized.length) {
    segments.push({
      text: normalized.slice(cursor),
      style: Object.keys(style).length ? { ...style } : undefined,
    });
  }

  return mergeAdjacentSegments(segments);
}

function mergeAdjacentSegments(segments: AnsiSegment[]): AnsiSegment[] {
  if (!segments.length) return segments;
  const merged: AnsiSegment[] = [];

  for (const segment of segments) {
    if (!segment.text) continue;
    const last = merged[merged.length - 1];
    const sameStyle =
      !!last &&
      JSON.stringify(last.style || null) === JSON.stringify(segment.style || null);

    if (last && sameStyle) {
      last.text += segment.text;
    } else {
      merged.push({
        text: segment.text,
        style: segment.style ? { ...segment.style } : undefined,
      });
    }
  }

  return merged;
}

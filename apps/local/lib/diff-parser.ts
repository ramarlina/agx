// apps/local/lib/diff-parser.ts
export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  o: number | null;
  n: number | null;
  k: DiffLineKind;
  t: string;
}

export interface DiffHunk {
  head: string;
  section: string;
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const lines = patch.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      if (current) hunks.push(current);
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      current = { head: raw, section: m[3].trim(), lines: [] };
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("\\ ")) continue; // "\ No newline at end of file"

    const ch = raw[0];
    const text = raw.slice(1);
    if (ch === "+") {
      current.lines.push({ o: null, n: newLine, k: "add", t: text });
      newLine++;
    } else if (ch === "-") {
      current.lines.push({ o: oldLine, n: null, k: "del", t: text });
      oldLine++;
    } else {
      // context (space prefix) or empty line that we treat as context
      current.lines.push({ o: oldLine, n: newLine, k: "ctx", t: text });
      oldLine++;
      newLine++;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

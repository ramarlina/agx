// apps/local/components/prs/review/FilesPane.tsx
"use client";

import React from "react";
import type { GithubPrFile } from "@/lib/github-types";
import styles from "./review.module.css";

interface Props {
  files: GithubPrFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
};

const STATUS_COLOR: Record<string, string> = {
  A: "var(--add)",
  M: "var(--accent)",
  D: "var(--del)",
  R: "var(--cool)",
};

export function FilesPane({ files, selected, onSelect }: Props) {
  const totals = files.reduce(
    (acc, f) => ({ a: acc.a + f.additions, d: acc.d + f.deletions }),
    { a: 0, d: 0 },
  );

  return (
    <aside
      className={styles.filesSide}
      style={{
        flex: 1,
        borderRight: "1px solid var(--line)",
        background: "var(--bg-inset)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          borderBottom: "1px solid var(--line)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "10px 12px",
            background: "var(--bg-card)",
            color: "var(--fg)",
            borderBottom: "2px solid var(--accent)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Changes <span style={{ color: "var(--fg-mute)", marginLeft: 4 }}>{files.length}</span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderBottom: "1px solid var(--line)",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        <SummaryCell k="changed" v={String(files.length)} sub={`+${totals.a} −${totals.d}`} border />
        <SummaryCell k="lines" v={`+${totals.a}`} sub={`−${totals.d}`} />
      </div>

      <div className={styles.slim} style={{ flex: 1, overflow: "auto" }}>
        {files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            active={selected === f.path}
            onClick={() => onSelect(f.path)}
          />
        ))}
      </div>
    </aside>
  );
}

function SummaryCell({
  k,
  v,
  sub,
  border,
}: {
  k: string;
  v: string;
  sub: string;
  border?: boolean;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRight: border ? "1px solid var(--line)" : "none",
        background: "var(--bg-card)",
      }}
    >
      <div style={{ color: "var(--fg-mute)", marginBottom: 3 }}>{k}</div>
      <div style={{ color: "var(--fg)", fontSize: 13, letterSpacing: 0, fontWeight: 600 }}>
        {v}
      </div>
      <div style={{ color: "var(--fg-mute)", marginTop: 2, fontSize: 9, letterSpacing: 0, textTransform: "none" }}>
        {sub}
      </div>
    </div>
  );
}

function FileRow({
  file,
  active,
  onClick,
}: {
  file: GithubPrFile;
  active: boolean;
  onClick: () => void;
}) {
  const lastSlash = file.path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash) : "";
  const name = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
  const letter = STATUS_LETTER[file.status] ?? "M";
  const color = STATUS_COLOR[letter] ?? "var(--fg)";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "14px 1fr auto",
        gap: 8,
        padding: "7px 12px",
        cursor: "pointer",
        background: active ? "var(--bg-card)" : "transparent",
        borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          color,
          textAlign: "center",
        }}
      >
        {letter}
      </span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span
          style={{
            color: active ? "var(--fg)" : "var(--fg-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        {dir && (
          <span
            style={{
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {dir}/
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          display: "flex",
          gap: 6,
        }}
      >
        <span style={{ color: "var(--add)" }}>+{file.additions}</span>
        <span style={{ color: "var(--del)" }}>−{file.deletions}</span>
      </span>
    </div>
  );
}

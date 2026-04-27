// apps/local/components/prs/review/DiffPane.tsx
"use client";

import React, { useMemo } from "react";
import type { GithubPrFile, GithubPrComment } from "@/lib/github-types";
import { parseUnifiedDiff, type DiffHunk, type DiffLine } from "@/lib/diff-parser";
import { AgentChip } from "./AgentChip";
import styles from "./review.module.css";

interface Props {
  file: GithubPrFile;
  comments: GithubPrComment[];
}

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
};

export function DiffPane({ file, comments }: Props) {
  const hunks = useMemo(() => parseUnifiedDiff(file.patch), [file.patch]);

  const commentsByLine = useMemo(() => {
    const m = new Map<number, GithubPrComment[]>();
    for (const c of comments) {
      if (c.path !== file.path || c.line == null) continue;
      const arr = m.get(c.line) ?? [];
      arr.push(c);
      m.set(c.line, arr);
    }
    return m;
  }, [comments, file.path]);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <DiffHeader file={file} />
      <SubToolbar threadCount={comments.filter((c) => c.path === file.path).length} />
      <div
        className={styles.slim}
        style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}
      >
        {hunks.length === 0 ? (
          <div
            style={{
              padding: "32px 16px",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            No diff available for this file.
          </div>
        ) : (
          hunks.map((h, i) => (
            <Hunk key={i} hunk={h} commentsByLine={commentsByLine} />
          ))
        )}
      </div>
    </main>
  );
}

function DiffHeader({ file }: { file: GithubPrFile }) {
  const letter = STATUS_LETTER[file.status] ?? "M";
  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-raised)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <span
        style={{
          padding: "2px 6px",
          borderRadius: 3,
          border: "1px solid var(--accent)",
          color: "var(--accent)",
          fontSize: 10,
          letterSpacing: "0.12em",
        }}
      >
        {letter}
      </span>
      <span style={{ color: "var(--fg)", fontSize: 13, fontWeight: 500 }}>
        {file.path}
      </span>
      <span style={{ color: "var(--fg-mute)" }}>·</span>
      <span style={{ color: "var(--add)" }}>+{file.additions}</span>
      <span style={{ color: "var(--del)" }}>−{file.deletions}</span>
    </div>
  );
}

function SubToolbar({ threadCount }: { threadCount: number }) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-card)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--fg-mute)",
      }}
    >
      <span>view: unified</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
        {threadCount > 0 && (
          <span style={{ color: "var(--warm)" }}>
            ◆ {threadCount} thread{threadCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
    </div>
  );
}

function Hunk({
  hunk,
  commentsByLine,
}: {
  hunk: DiffHunk;
  commentsByLine: Map<number, GithubPrComment[]>;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--line)" }}>
      <div
        style={{
          padding: "6px 16px",
          background: "var(--bg-inset)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg-mute)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ color: "var(--cool)" }}>{hunk.head}</span>
        {hunk.section && (
          <>
            <span style={{ color: "var(--fg-ghost)" }}>·</span>
            <span style={{ color: "var(--fg-dim)" }}>{hunk.section}</span>
          </>
        )}
      </div>
      {hunk.lines.map((l, i) => {
        const threads = l.n != null ? commentsByLine.get(l.n) : undefined;
        return (
          <React.Fragment key={i}>
            <DiffLineRow line={l} />
            {threads?.map((t) => <InlineThread key={t.id} comment={t} />)}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const isAdd = line.k === "add";
  const isDel = line.k === "del";
  const bg = isAdd ? "var(--add-bg)" : isDel ? "var(--del-bg)" : "transparent";
  const gutBg = isAdd ? "var(--add-gut)" : isDel ? "var(--del-gut)" : "transparent";
  const sigil = isAdd ? "+" : isDel ? "−" : " ";
  const sigilColor = isAdd ? "var(--add)" : isDel ? "var(--del)" : "var(--fg-ghost)";
  const txtColor = isAdd ? "var(--fg)" : "var(--fg-dim)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 44px 16px 1fr",
        minHeight: 20,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: "20px",
        background: bg,
      }}
    >
      <span
        style={{
          textAlign: "right",
          padding: "0 8px",
          color: "var(--fg-mute)",
          background: gutBg,
          borderRight: "1px solid var(--line)",
          fontSize: 10,
        }}
      >
        {line.o ?? ""}
      </span>
      <span
        style={{
          textAlign: "right",
          padding: "0 8px",
          color: "var(--fg-mute)",
          background: gutBg,
          borderRight: "1px solid var(--line)",
          fontSize: 10,
        }}
      >
        {line.n ?? ""}
      </span>
      <span
        style={{
          textAlign: "center",
          color: sigilColor,
          fontWeight: 600,
          background: gutBg,
        }}
      >
        {sigil}
      </span>
      <span
        style={{
          padding: "0 12px",
          whiteSpace: "pre",
          color: txtColor,
        }}
      >
        {line.t}
      </span>
    </div>
  );
}

function InlineThread({ comment }: { comment: GithubPrComment }) {
  const time = new Date(comment.createdAt).toLocaleString();
  return (
    <div
      style={{
        margin: "4px 0 4px 88px",
        border: "1px solid var(--line-strong)",
        borderRadius: 5,
        background: "var(--bg-card)",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-mute)",
        }}
      >
        <AgentChip name={comment.authorLogin} provider="claude" size={16} />
        <span style={{ color: "var(--fg)", fontSize: 11 }}>
          {comment.authorLogin}
        </span>
        <span style={{ marginLeft: "auto" }}>{time}</span>
      </div>
      <div
        style={{
          padding: "10px 12px",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--fg-dim)",
          whiteSpace: "pre-wrap",
        }}
      >
        {comment.body}
      </div>
    </div>
  );
}

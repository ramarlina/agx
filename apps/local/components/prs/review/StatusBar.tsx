// apps/local/components/prs/review/StatusBar.tsx
"use client";

import React from "react";
import type { GithubPr } from "@/lib/github-types";

interface Props {
  pr: GithubPr;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  threadCount: number;
}

export function StatusBar({
  pr,
  fileCount,
  totalAdditions,
  totalDeletions,
  threadCount,
}: Props) {
  return (
    <footer
      style={{
        height: 26,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 14,
        borderTop: "1px solid var(--line)",
        background: "var(--bg-raised)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--fg-mute)",
      }}
    >
      <span style={{ color: "var(--accent)" }}>● {pr.state}</span>
      <span>
        {pr.headRef} → {pr.baseRef}
      </span>
      <span style={{ color: "var(--fg-ghost)" }}>·</span>
      <span>
        {fileCount} files · +{totalAdditions} −{totalDeletions}
      </span>
      <span style={{ color: "var(--fg-ghost)" }}>·</span>
      <span>
        {threadCount} thread{threadCount === 1 ? "" : "s"}
      </span>
      <span style={{ marginLeft: "auto" }}>{pr.repoId}</span>
    </footer>
  );
}

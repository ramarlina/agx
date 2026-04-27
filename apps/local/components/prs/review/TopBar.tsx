// apps/local/components/prs/review/TopBar.tsx
"use client";

import React from "react";
import type { GithubPr } from "@/lib/github-types";
import styles from "./review.module.css";

interface Props {
  pr: GithubPr;
}

export function TopBar({ pr }: Props) {
  return (
    <header
      style={{
        height: 44,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-raised)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
          color: "var(--fg)",
          fontWeight: 700,
          borderRight: "1px solid var(--line)",
          height: "100%",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.02em",
            fontSize: 14,
          }}
        >
          AGX
        </span>
        <span style={{ color: "var(--fg-mute)", fontSize: 10, marginLeft: 4 }}>
          review
        </span>
      </div>

      <PillCell label="Repository" value={pr.repoId} caret />
      <PillCell label="Branch" value={pr.headRef} caret accent />
      <PillCell label="Base" value={`← ${pr.baseRef}`} caret />
      <PillCell label="PR" value={`#${pr.number}`} />

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 14px",
        }}
      >
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className={`${styles.btn} ${styles.btnGhost}`}
        >
          ↗ open on github
        </a>
      </div>
    </header>
  );
}

function PillCell({
  label,
  value,
  caret,
  accent,
}: {
  label: string;
  value: string;
  caret?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        height: "100%",
        borderRight: "1px solid var(--line)",
        padding: "0 16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minWidth: 180,
      }}
    >
      <div
        style={{
          color: "var(--fg-mute)",
          fontSize: 9,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          marginBottom: 2,
          fontFamily: "var(--font-mono)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: accent ? "var(--accent)" : "var(--fg)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 240,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {value}
        </span>
        {caret && (
          <span style={{ color: "var(--fg-ghost)", fontSize: 10 }}>⌄</span>
        )}
      </div>
    </div>
  );
}

// apps/local/components/prs/review/CommitRail.tsx
"use client";

import React from "react";
import type { GithubPr } from "@/lib/github-types";
import styles from "./review.module.css";

interface Props {
  pr: GithubPr;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

export function CommitRail({
  pr,
  fileCount,
  totalAdditions,
  totalDeletions,
}: Props) {
  const stateLabel = pr.state === "merged"
    ? "merged"
    : pr.state === "closed"
      ? "closed"
      : pr.draft
        ? "draft"
        : "open";

  return (
    <aside
      className={styles.commitSide}
      style={{
        borderLeft: "1px solid var(--line)",
        background: "var(--bg-inset)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-mute)",
            marginBottom: 10,
          }}
        >
          Review · #{pr.number}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
            marginBottom: 10,
          }}
        >
          {pr.title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Row k="branch" v={pr.headRef} accent />
          <Row k="base" v={pr.baseRef} />
          <Row k="state" v={stateLabel} />
          <Row k="files" v={`${fileCount} · +${totalAdditions} −${totalDeletions}`} />
          {pr.ciStatus && <Row k="ci" v={pr.ciStatus} />}
        </div>
      </div>

      <div
        className={styles.slim}
        style={{
          padding: "14px 16px",
          flex: 1,
          overflow: "auto",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-mute)",
            marginBottom: 10,
          }}
        >
          Description
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--fg-dim)",
            whiteSpace: "pre-wrap",
          }}
        >
          {pr.body || "(no description)"}
        </div>
      </div>
    </aside>
  );
}

function Row({
  k,
  v,
  accent,
}: {
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px 1fr",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <span style={{ color: "var(--fg-mute)" }}>{k}</span>
      <span
        style={{
          color: accent ? "var(--accent)" : "var(--fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </span>
    </div>
  );
}

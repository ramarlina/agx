// apps/local/components/prs/review/ReviewLayout.tsx
"use client";

import React, { useMemo, useState } from "react";
import type {
  GithubPr,
  GithubPrFile,
  GithubPrComment,
} from "@/lib/github-types";
import { TopBar } from "./TopBar";
import { FilesPane } from "./FilesPane";
import { DiffPane } from "./DiffPane";
import { CommitRail } from "./CommitRail";
import { StatusBar } from "./StatusBar";
import styles from "./review.module.css";

interface Props {
  pr: GithubPr;
  files: GithubPrFile[];
  comments: GithubPrComment[];
  rightPane?: React.ReactNode;
}

export function ReviewLayout({ pr, files, comments, rightPane }: Props) {
  const [selected, setSelected] = useState<string | null>(
    files[0]?.path ?? null,
  );

  const selectedFile =
    files.find((f) => f.path === selected) ?? files[0] ?? null;

  const totals = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({
          a: acc.a + f.additions,
          d: acc.d + f.deletions,
        }),
        { a: 0, d: 0 },
      ),
    [files],
  );

  return (
    <div className={styles.root}>
      <TopBar pr={pr} />
      <div className={styles.reviewGrid}>
        <FilesPane
          files={files}
          selected={selected}
          onSelect={setSelected}
        />
        {selectedFile ? (
          <DiffPane file={selectedFile} comments={comments} />
        ) : (
          <main
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--fg-mute)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            No files in this PR.
          </main>
        )}
        {rightPane ?? (
          <CommitRail
            pr={pr}
            fileCount={files.length}
            totalAdditions={totals.a}
            totalDeletions={totals.d}
          />
        )}
      </div>
      <StatusBar
        pr={pr}
        fileCount={files.length}
        totalAdditions={totals.a}
        totalDeletions={totals.d}
        threadCount={comments.length}
      />
    </div>
  );
}

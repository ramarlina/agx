// apps/local/components/prs/review/ReviewLayout.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
  loadPrReviewFilesPaneWidth,
  loadPrReviewRightPaneWidth,
  persistPrReviewFilesPaneWidth,
  persistPrReviewRightPaneWidth,
} from "@/state/windowState";
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
  const [filesWidth, setFilesWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(380);

  useEffect(() => {
    setFilesWidth(loadPrReviewFilesPaneWidth() || 300);
    setRightWidth(loadPrReviewRightPaneWidth() || 380);
  }, []);

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

  const right = rightPane ?? (
    <CommitRail
      pr={pr}
      fileCount={files.length}
      totalAdditions={totals.a}
      totalDeletions={totals.d}
    />
  );

  return (
    <div className={styles.root}>
      <div className={styles.reviewBody}>
        <div className={styles.leftCol}>
          <TopBar pr={pr} />
          <div className={styles.midRow}>
            <div style={{ width: filesWidth, flex: "0 0 auto", minWidth: 0, display: "flex" }}>
              <FilesPane
                files={files}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
            <ResizeHandle
              ariaLabel="Resize files pane"
              onResize={(delta) =>
                setFilesWidth((w) => {
                  const next = Math.max(200, Math.min(560, w + delta));
                  persistPrReviewFilesPaneWidth(next);
                  return next;
                })
              }
            />
            <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
              {selectedFile ? (
                <DiffPane file={selectedFile} comments={comments} />
              ) : (
                <main
                  style={{
                    flex: 1,
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
            </div>
          </div>
          <StatusBar
            pr={pr}
            fileCount={files.length}
            totalAdditions={totals.a}
            totalDeletions={totals.d}
            threadCount={comments.length}
          />
        </div>
        <ResizeHandle
          ariaLabel="Resize right pane"
          onResize={(delta) =>
            setRightWidth((w) => {
              const next = Math.max(260, Math.min(720, w - delta));
              persistPrReviewRightPaneWidth(next);
              return next;
            })
          }
        />
        <div
          className={styles.rightPane}
          style={{ width: rightWidth, borderLeft: "1px solid var(--card-border)" }}
        >
          {right}
        </div>
      </div>
    </div>
  );
}

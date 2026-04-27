// apps/local/__tests__/components/prs/review/DiffPane.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { DiffPane } from "@/components/prs/review/DiffPane";
import type { GithubPrFile, GithubPrComment } from "@/lib/github-types";

const file: GithubPrFile = {
  prId: "p#1",
  path: "a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: "@@ -1,1 +1,1 @@\n-old\n+new",
  lastSyncedAt: 0,
};

const comments: GithubPrComment[] = [
  {
    id: "c1",
    prId: "p#1",
    kind: "review_comment",
    authorLogin: "bob",
    body: "looks risky",
    path: "a.ts",
    line: 1,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe("DiffPane", () => {
  it("renders file path, hunk header, and diff lines", () => {
    render(<DiffPane file={file} comments={comments} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("@@ -1,1 +1,1 @@")).toBeInTheDocument();
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument();
  });

  it("renders inline comment thread under the targeted line", () => {
    render(<DiffPane file={file} comments={comments} />);
    expect(screen.getByText("looks risky")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("shows an empty-state when patch is null", () => {
    render(
      <DiffPane file={{ ...file, patch: null }} comments={[]} />,
    );
    expect(screen.getByText(/no diff available/i)).toBeInTheDocument();
  });
});

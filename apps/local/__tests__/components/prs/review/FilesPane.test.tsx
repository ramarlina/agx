// apps/local/__tests__/components/prs/review/FilesPane.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilesPane } from "@/components/prs/review/FilesPane";
import type { GithubPrFile } from "@/lib/github-types";

const files: GithubPrFile[] = [
  {
    prId: "p#1",
    path: "lib/scheduler/queue.ts",
    status: "modified",
    additions: 18,
    deletions: 6,
    changes: 24,
    patch: null,
    lastSyncedAt: 0,
  },
  {
    prId: "p#1",
    path: "docs/changelog/1.4.56.md",
    status: "added",
    additions: 12,
    deletions: 0,
    changes: 12,
    patch: null,
    lastSyncedAt: 0,
  },
];

describe("FilesPane", () => {
  it("renders each file with name, dir, and counts", () => {
    render(
      <FilesPane files={files} selected="lib/scheduler/queue.ts" onSelect={() => {}} />,
    );
    expect(screen.getByText("queue.ts")).toBeInTheDocument();
    expect(screen.getByText("lib/scheduler/")).toBeInTheDocument();
    expect(screen.getByText("+18")).toBeInTheDocument();
    expect(screen.getAllByText("−6").length).toBeGreaterThan(0);
    expect(screen.getByText("1.4.56.md")).toBeInTheDocument();
    expect(screen.getByText("docs/changelog/")).toBeInTheDocument();
  });

  it("calls onSelect with the file path when a row is clicked", () => {
    const onSelect = jest.fn();
    render(<FilesPane files={files} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("queue.ts"));
    expect(onSelect).toHaveBeenCalledWith("lib/scheduler/queue.ts");
  });

  it("shows totals in the summary strip", () => {
    render(<FilesPane files={files} selected={null} onSelect={() => {}} />);
    expect(screen.getAllByText(/\+30/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/−6/).length).toBeGreaterThan(0);
  });
});

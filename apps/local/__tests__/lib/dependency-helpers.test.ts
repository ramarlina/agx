/**
 * @jest-environment node
 */

import { formatDependencyBlockedReason, isDependencyBlockedReason } from "@/lib/dependency-helpers";

describe("dependency helpers", () => {
  it("returns an empty message when no dependencies are provided", () => {
    expect(formatDependencyBlockedReason([])).toBe("");
  });

  it("formats the first few dependencies and includes statuses", () => {
    const dependencies = [
      { id: "abc", title: "Build foundation", status: "queued" },
      { id: "def", slug: "task-def", status: "blocked" },
    ];

    expect(formatDependencyBlockedReason(dependencies)).toBe(
      "Waiting on dependencies: Build foundation (queued), task-def (blocked)"
    );
  });

  it("caps the displayed dependencies at the configured limit", () => {
    const dependencies = Array.from({ length: 5 }, (_, index) => ({ id: `task-${index}` }));
    expect(formatDependencyBlockedReason(dependencies)).toBe(
      "Waiting on dependencies: task-0, task-1, task-2 +2 more"
    );
  });

  describe("isDependencyBlockedReason", () => {
    it("returns true when the reason starts with the dependency prefix", () => {
      expect(isDependencyBlockedReason("Waiting on dependencies: foo")).toBe(true);
    });

    it("returns false when the prefix is missing", () => {
      expect(isDependencyBlockedReason("Other reason")).toBe(false);
    });

    it("returns false for null or undefined", () => {
      expect(isDependencyBlockedReason(null)).toBe(false);
      expect(isDependencyBlockedReason(undefined)).toBe(false);
    });
  });
});

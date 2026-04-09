import { deriveTaskObjective, sanitizeTaskObjective } from "@/src/graph/objective";

describe("graph objective helpers", () => {
  it("strips frontmatter and leading heading from markdown objectives", () => {
    const raw = [
      "---",
      "status: in_progress",
      "stage: INTAKE",
      "project: agx",
      "---",
      '# Add "global" chat interface to agx',
      "",
      "add a global chat interface to agx",
    ].join("\n");

    expect(sanitizeTaskObjective(raw)).toBe("add a global chat interface to agx");
  });

  it("keeps heading text when markdown only includes an h1", () => {
    expect(sanitizeTaskObjective("# Launch beta")).toBe("Launch beta");
  });

  it("prefers description over content when deriving objective", () => {
    expect(
      deriveTaskObjective({
        title: "Task title",
        description: "Build the API route",
        content: "---\nstatus: queued\n---\n# Old title\nLegacy body",
      }),
    ).toBe("Build the API route");
  });

  it("falls back to title when objective inputs are empty", () => {
    expect(
      deriveTaskObjective({
        title: "Task title",
        description: "  ",
        content: "",
      }),
    ).toBe("Task title");
  });
});

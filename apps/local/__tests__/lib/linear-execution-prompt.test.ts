import {
  buildLinearExecutionPrompt,
  renderLinearExecutionPromptTemplate,
} from "@/lib/linear-execution-prompt";

describe("buildLinearExecutionPrompt", () => {
  it("builds a reusable Linear executor prompt with zero-config defaults", () => {
    const result = buildLinearExecutionPrompt({
      issue: {
        identifier: "AGX-123",
        title: "Fix the broken sync",
        status: "In Progress",
        assignee: "Agx Agent",
      },
      project: {
        name: "AGX Game Vault",
        slug: "agx-game-vault",
        repos: [
          {
            name: "app",
            path: "/Users/mendrika/Projects/Agents/agx-game",
            notes: "primary source repo",
          },
        ],
      },
    });

    expect(result.prompt).toBe("Work on this Linear ticket: AGX-123 - Fix the broken sync");
    expect(result.promptPrefix).toContain("LINEAR TASK EXECUTION");
    expect(result.promptPrefix).toContain("Knowledge base root: ~/.agx/vault/agx-game-vault");
    expect(result.promptPrefix).toContain(
      "Issue knowledge path: ~/.agx/vault/agx-game-vault/issues/AGX-123/"
    );
    expect(result.promptPrefix).toContain("Suggested isolated worktree: /tmp/agx-agx-123");
    expect(result.promptPrefix).toContain(
      "- app | path: /Users/mendrika/Projects/Agents/agx-game | notes: primary source repo"
    );
    expect(result.promptPrefix).toContain("Use knowledge base terminology");
  });

  it("accepts injected runtime overrides for advanced setups", () => {
    const result = buildLinearExecutionPrompt({
      issue: {
        identifier: "LIN-9",
        title: "Tighten release flow",
      },
      project: {
        name: "Release Ops",
      },
      runtime: {
        knowledgeBaseRoot: "/custom/kb/release-ops",
        issueKnowledgePath: "/custom/kb/release-ops/issues/LIN-9",
        isolatedWorktreePath: "/tmp/custom-lin-9",
      },
    });

    expect(result.promptPrefix).toContain("Knowledge base root: /custom/kb/release-ops");
    expect(result.promptPrefix).toContain(
      "Issue knowledge path: /custom/kb/release-ops/issues/LIN-9"
    );
    expect(result.promptPrefix).toContain("Suggested isolated worktree: /tmp/custom-lin-9");
    expect(result.promptPrefix).toContain("Project: Release Ops");
  });

  it("renders saved run script templates with injected ticket and project placeholders", () => {
    const prompt = renderLinearExecutionPromptTemplate(
      "Review {{ticket.identifier}} for {{project.slug}} and write notes to {{knowledge_base.issue_path}}.",
      {
        issue: {
          identifier: "AGX-321",
          title: "Investigate flaky checks",
          status: "Todo",
          assignee: "Mendrika",
        },
        project: {
          slug: "agx-cloud",
        },
      }
    );

    expect(prompt).toBe(
      "Review AGX-321 for agx-cloud and write notes to ~/.agx/vault/agx-cloud/issues/AGX-321/."
    );
  });
});

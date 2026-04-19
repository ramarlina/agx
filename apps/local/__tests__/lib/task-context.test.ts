/**
 * @jest-environment node
 */

import { computeCommentsDigest, buildTaskPrompt, TaskLearnings } from "@/lib/task-context";
import type { Task, TaskComment } from "@/lib/db-adapter.interface";

describe("task context helpers", () => {
  const baseComment: TaskComment = {
    id: "comment-1",
    task_id: "task-1",
    author_type: "user",
    author_id: "user-1",
    content: "hi",
    created_at: "2026-02-06T00:00:00.000Z",
  };

  test("computeCommentsDigest returns expected hash for deterministic history", () => {
    const digest = computeCommentsDigest([baseComment]);
    expect(digest).toBe("c8ef14963c6dc1ea109137fb49468003e4a3f651f74fca80e0aeaf27ac6c3a3f");
  });

  test("computeCommentsDigest changes when comments list grows", () => {
    const secondComment: TaskComment = {
      id: "comment-2",
      task_id: "task-1",
      author_type: "user",
      author_id: "user-1",
      content: "more context",
      created_at: "2026-02-06T00:05:00.000Z",
    };

    const initialDigest = computeCommentsDigest([baseComment]);
    const extendedDigest = computeCommentsDigest([baseComment, secondComment]);
    expect(extendedDigest).not.toBe(initialDigest);
  });

  test("buildTaskPrompt embeds comments, stage prompt, and learnings", () => {
    const task: Task = {
      id: "task-1",
      user_id: "user-1",
      content: "---\nstage: ideation\nproject: alpha\nengine: claude\nprovider: claude\nmodel: claude-3.5\nswarm: false\n---\n# Test Task\n\nDo the things.",
      description: "Do the things.",
      title: "Test Task",
      slug: "test-task",
      stage: "ideation",
      project: "alpha",
      engine: "claude",
      provider: "claude",
      model: "claude-3.5",
      swarm: false,
      status: "queued",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const comments: TaskComment[] = [
      baseComment,
      {
        id: "comment-2",
        task_id: "task-1",
        author_type: "agent",
        content: "[execution/decision]\ncommand: agx run",
        created_at: "2026-02-06T00:06:00.000Z",
      },
    ];
    const learnings: TaskLearnings = {
      task: [{ id: "learning-1", user_id: "user-1", scope: "task", content: "Task-level insight", created_at: "2026-02-06T00:10:00.000Z" }],
      project: [{ id: "learning-2", user_id: "user-1", scope: "project", scope_id: "alpha", content: "Project-wide note", created_at: "2026-02-06T00:12:00.000Z" }],
      global: [{ id: "learning-3", scope: "global", content: "Global wisdom", created_at: "2026-02-06T00:15:00.000Z" }],
    };

    const prompt = buildTaskPrompt({
      task,
      comments,
      learnings,
      stage_config: { prompt: "Focus on safety" },
      project_context: {
        project: {
          id: "proj-123",
          name: "Alpha",
          slug: "alpha",
          description: "Alpha service",
          metadata: { stack: "Next.js", env: "prod" },
          ci_cd_info: "GitHub Actions",
          created_at: "2026-02-05T00:00:00.000Z",
          updated_at: "2026-02-06T00:00:00.000Z",
        },
        repos: [
          {
            id: "repo-1",
            project_id: "proj-123",
            name: "alpha-web",
            path: "~/Projects/alpha/web",
            git_url: "https://github.com/example/alpha-web",
            notes: "Primary frontend",
            created_at: "2026-02-05T01:00:00.000Z",
            updated_at: "2026-02-05T01:00:00.000Z",
          },
        ],
        workspace_map: [
          {
            location: "Repositories/frontend",
            path: "~/Projects/alpha/web",
            purpose: "Primary frontend",
          },
        ],
        learnings: ["Keep Feature Flag X disabled in prod"],
      },
      user_settings: null,
    });

    expect(prompt).toContain("STAGE PROMPT");
    expect(prompt).toContain("Focus on safety");
    expect(prompt).toContain("COMMENTS");
    expect(prompt).toContain("(user)");
    expect(prompt).not.toContain("[execution/decision]");
    expect(prompt).toContain("Do not use AGX MCP tools or AGX MCP servers for this task.");
    expect(prompt).toContain("Task-level insight");
    expect(prompt).toContain("Global wisdom");
    expect(prompt).toContain("PROJECT CONTEXT");
    expect(prompt).toContain("REPOSITORY MAP");
    expect(prompt).toContain("alpha-web");
    expect(prompt).toContain("PROJECT KNOWLEDGE");
    expect(prompt).toContain("Keep Feature Flag X disabled in prod");
  });

  test("buildTaskPrompt falls back to stage config for model settings", () => {
    const task: Task = {
      id: "task-2",
      content: "Task without specific provider",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const prompt = buildTaskPrompt({
      task,
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_config: {
        prompt: "Stage prompt",
        provider: "stage-provider",
        model: "stage-model",
        swarm: true,
      },
      project_context: null,
      user_settings: null,
    });

    expect(prompt).toContain("Provider: stage-provider");
    expect(prompt).toContain("Model: stage-model");
    expect(prompt).toContain("Swarm: true");
  });

  test("buildTaskPrompt prefers description over markdown content body", () => {
    const task: Task = {
      id: "task-3",
      content: "---\nstage: ideation\n---\n# Legacy title\n\nlegacy-content-body",
      description: "description-priority-body",
      title: "Task Three",
      stage: "ideation",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const prompt = buildTaskPrompt({
      task,
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_config: { prompt: null },
      project_context: null,
      user_settings: null,
    });

    expect(prompt).toContain("description-priority-body");
    expect(prompt).not.toContain("legacy-content-body");
  });

  test("buildTaskPrompt renders workspace map before task content", () => {
    const task: Task = {
      id: "task-workspace",
      content: "Use the mapped repo",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const prompt = buildTaskPrompt({
      task,
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_config: { prompt: null },
      project_context: {
        project: {
          id: "proj-workspace",
          name: "Workspace Demo",
          slug: "workspace-demo",
          description: "Workspace-aware project",
          metadata: null,
          ci_cd_info: null,
          created_at: "2026-02-05T00:00:00.000Z",
          updated_at: "2026-02-06T00:00:00.000Z",
        },
        repos: [],
        workspace_map: [
          {
            location: "Repositories/frontend",
            path: "~/Projects/alpha/web",
            purpose: "Primary frontend",
          },
        ],
        learnings: [],
      },
      user_settings: null,
    });

    expect(prompt).toContain("WORKSPACE MAP");
    expect(prompt).toContain("| Location | Path | Purpose |");
    expect(prompt).toContain("| Repositories/frontend | ~/Projects/alpha/web | Primary frontend |");
    expect(prompt.indexOf("PROJECT CONTEXT")).toBeLessThan(prompt.indexOf("WORKSPACE MAP"));
    expect(prompt.indexOf("WORKSPACE MAP")).toBeLessThan(prompt.indexOf("TASK\nUse the mapped repo"));
  });

  test("buildTaskPrompt omits workspace map when all entries are unmapped", () => {
    const task: Task = {
      id: "task-4",
      content: "Task without mapped workspace entries",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const prompt = buildTaskPrompt({
      task,
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_config: { prompt: null },
      project_context: {
        project: {
          id: "proj-456",
          name: "Bravo",
          slug: "bravo",
          description: null,
          metadata: null,
          ci_cd_info: null,
          created_at: "2026-02-05T00:00:00.000Z",
          updated_at: "2026-02-06T00:00:00.000Z",
        },
        repos: [],
        workspace_map: [
          {
            location: "Repositories/backend",
            path: null,
            purpose: "Backend API",
          },
        ],
        learnings: [],
      },
      user_settings: null,
    });

    expect(prompt).not.toContain("WORKSPACE MAP");
    expect(prompt).toContain("REPOSITORY MAP");
  });

  test("buildTaskPrompt escapes markdown-breaking workspace map values", () => {
    const task: Task = {
      id: "task-5",
      content: "Task with markdown-sensitive workspace entries",
      created_at: "2026-02-06T00:00:00.000Z",
      updated_at: "2026-02-06T00:00:00.000Z",
    };

    const prompt = buildTaskPrompt({
      task,
      comments: [],
      learnings: { task: [], project: [], global: [] },
      stage_config: { prompt: null },
      project_context: {
        project: {
          id: "proj-789",
          name: "Charlie",
          slug: "charlie",
          description: null,
          metadata: null,
          ci_cd_info: null,
          created_at: "2026-02-05T00:00:00.000Z",
          updated_at: "2026-02-06T00:00:00.000Z",
        },
        repos: [],
        workspace_map: [
          {
            location: "Docs|specs",
            path: "~/Projects/charlie/specs",
            purpose: "Architecture\nNotes | decisions",
          },
        ],
        learnings: [],
      },
      user_settings: null,
    });

    expect(prompt).toContain("| Docs\\|specs | ~/Projects/charlie/specs | Architecture<br />Notes \\| decisions |");
  });
});

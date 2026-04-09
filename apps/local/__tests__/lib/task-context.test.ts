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
    expect(prompt).toContain("Project-wide note");
    expect(prompt).toContain("Global wisdom");
    expect(prompt).toContain("PROJECT CONTEXT");
    expect(prompt).toContain("REPOSITORY MAP");
    expect(prompt).toContain("alpha-web");
    expect(prompt).toContain("PROJECT LEARNINGS");
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
});

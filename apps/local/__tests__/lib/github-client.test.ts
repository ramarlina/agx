/** @jest-environment node */
import { GithubClient } from "@/lib/github-client";
import type { GithubTokens } from "@/lib/github-types";

const tokens: GithubTokens = {
  accessToken: "token",
  refreshToken: null,
  expiresAt: null,
  login: "tester",
  scopes: ["repo"],
};

function makeFetch(responses: Array<{ url: RegExp; body: unknown; status?: number }>) {
  return async (url: string, _init?: RequestInit): Promise<Response> => {
    for (const r of responses) {
      if (r.url.test(url)) {
        return new Response(JSON.stringify(r.body), {
          status: r.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ message: "not mocked" }), { status: 500 });
  };
}

test("listPullRequests maps REST response to GithubPr[]", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      {
        url: /\/repos\/foo\/bar\/pulls/,
        body: [
          {
            id: 1,
            number: 7,
            title: "t",
            body: "fixes AGX-1",
            state: "open",
            draft: false,
            user: { login: "alice" },
            head: { ref: "agx/AGX-1", sha: "abc" },
            base: { ref: "main" },
            html_url: "https://example/pr/7",
            assignees: [{ login: "alice" }],
            requested_reviewers: [{ login: "bob" }],
            labels: [{ name: "feature" }],
            created_at: "2026-04-17T10:00:00Z",
            updated_at: "2026-04-17T11:00:00Z",
            merged_at: null,
            closed_at: null,
          },
        ],
      },
    ]),
  });
  const prs = await client.listPullRequests({ owner: "foo", name: "bar" });
  expect(prs).toHaveLength(1);
  expect(prs[0].id).toBe("foo/bar#7");
  expect(prs[0].headRef).toBe("agx/AGX-1");
  expect(prs[0].reviewers.map((r) => r.login)).toEqual(["bob"]);
});

test("listPullRequestComments returns issue + review comments", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      {
        url: /\/repos\/foo\/bar\/issues\/7\/comments/,
        body: [
          {
            id: 100,
            user: { login: "alice" },
            body: "lgtm",
            created_at: "2026-04-17T10:00:00Z",
            updated_at: "2026-04-17T10:00:00Z",
          },
        ],
      },
      {
        url: /\/repos\/foo\/bar\/pulls\/7\/comments/,
        body: [
          {
            id: 200,
            user: { login: "bob" },
            body: "extract regex",
            path: "src/a.ts",
            line: 42,
            created_at: "2026-04-17T10:05:00Z",
            updated_at: "2026-04-17T10:05:00Z",
          },
        ],
      },
    ]),
  });
  const comments = await client.listPullRequestComments({
    owner: "foo",
    name: "bar",
    number: 7,
  });
  expect(comments).toHaveLength(2);
  expect(comments.map((c) => c.kind).sort()).toEqual(["issue_comment", "review_comment"]);
  expect(comments.find((c) => c.kind === "review_comment")?.line).toBe(42);
});

test("401 surfaces as AuthError", async () => {
  const client = new GithubClient({
    tokens,
    fetchImpl: makeFetch([
      { url: /\/repos\//, body: { message: "Bad credentials" }, status: 401 },
    ]),
  });
  await expect(client.listPullRequests({ owner: "foo", name: "bar" })).rejects.toThrow(
    /auth/i,
  );
});

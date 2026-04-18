/** @jest-environment node */
import {
  extractTrackerIds,
  resolvePrLink,
  ID_PATTERN,
} from "@/lib/github-link-resolver";

test("regex rejects mid-word and lowercase-prefix", () => {
  expect("abc-123".match(ID_PATTERN)).toBeNull();
  expect("FOOBAR1-2BAR".match(ID_PATTERN)).toBeNull();
  expect("FOO-1".match(ID_PATTERN)?.[0]).toBe("FOO-1");
  expect("fix: AGX-42 and LIN-7".match(new RegExp(ID_PATTERN, "g"))).toEqual([
    "AGX-42",
    "LIN-7",
  ]);
});

test("extractTrackerIds walks fields in order", () => {
  const ids = extractTrackerIds({
    headRef: "agx/AGX-1-fix",
    title: "fix: addresses LIN-2",
    body: "closes AGX-3",
  });
  expect(ids.map((i) => i.id)).toEqual(["AGX-1", "LIN-2", "AGX-3"]);
  expect(ids.map((i) => i.source)).toEqual(["branch", "title", "body"]);
});

test("resolvePrLink returns first resolvable id", async () => {
  const resolver = async (id: string) =>
    id === "LIN-2" ? { targetType: "linear_issue" as const, targetId: "LIN-2" } : null;
  const result = await resolvePrLink(
    { headRef: "no-match", title: "LIN-2 and AGX-1", body: "AGX-1" },
    [resolver],
  );
  expect(result).toEqual({
    targetType: "linear_issue",
    targetId: "LIN-2",
    linkSource: "title",
  });
});

test("resolvePrLink returns null when nothing resolves", async () => {
  const resolver = async () => null;
  const result = await resolvePrLink(
    { headRef: "feat/x", title: "no ids", body: "" },
    [resolver],
  );
  expect(result).toBeNull();
});

test("first field with a resolvable id wins", async () => {
  const resolver = async (id: string) =>
    id === "AGX-9" ? { targetType: "agx_task" as const, targetId: "AGX-9" } : null;
  const result = await resolvePrLink(
    { headRef: "branch-with-AGX-9", title: "also AGX-9", body: "yet again AGX-9" },
    [resolver],
  );
  expect(result?.linkSource).toBe("branch");
});

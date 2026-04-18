/** @jest-environment node */

jest.mock("@/lib/tracker/tracker-item-store", () => ({
  listCachedTrackerItems: jest.fn(),
}));

jest.mock("@/lib/task-identifier-store", () => ({
  findAgxTaskByIdentifier: jest.fn(),
}));

import { listCachedTrackerItems } from "@/lib/tracker/tracker-item-store";
import { findAgxTaskByIdentifier } from "@/lib/task-identifier-store";
import {
  linearIssueResolver,
  agxTaskResolver,
} from "@/lib/github-resolvers";

const listMock = listCachedTrackerItems as jest.MockedFunction<
  typeof listCachedTrackerItems
>;
const findAgxMock = findAgxTaskByIdentifier as jest.MockedFunction<
  typeof findAgxTaskByIdentifier
>;

beforeEach(() => {
  listMock.mockReset();
  findAgxMock.mockReset();
});

describe("linearIssueResolver", () => {
  test("returns linear_issue target on exact identifier match", async () => {
    listMock.mockResolvedValueOnce({
      issues: [
        { identifier: "LIN-7", id: "uuid-a" } as any,
        { identifier: "LIN-70", id: "uuid-b" } as any,
      ],
      pageInfo: { hasNextPage: false, endCursor: null } as any,
    });
    const result = await linearIssueResolver("LIN-7");
    expect(result).toEqual({ targetType: "linear_issue", targetId: "LIN-7" });
  });

  test("is case-insensitive", async () => {
    listMock.mockResolvedValueOnce({
      issues: [{ identifier: "AGX-42", id: "uuid-c" } as any],
      pageInfo: { hasNextPage: false, endCursor: null } as any,
    });
    const result = await linearIssueResolver("agx-42");
    expect(result).toEqual({ targetType: "linear_issue", targetId: "AGX-42" });
  });

  test("returns null when no exact match despite partial LIKE hits", async () => {
    listMock.mockResolvedValueOnce({
      issues: [
        { identifier: "LIN-70", id: "uuid-b" } as any,
        { identifier: "LIN-71", id: "uuid-c" } as any,
      ],
      pageInfo: { hasNextPage: false, endCursor: null } as any,
    });
    const result = await linearIssueResolver("LIN-7");
    expect(result).toBeNull();
  });

  test("returns null when store returns empty", async () => {
    listMock.mockResolvedValueOnce({
      issues: [],
      pageInfo: { hasNextPage: false, endCursor: null } as any,
    });
    expect(await linearIssueResolver("LIN-999")).toBeNull();
  });
});

describe("agxTaskResolver", () => {
  test("returns agx_task target on identifier match", async () => {
    findAgxMock.mockResolvedValueOnce({ id: "uuid-task-1" });
    const result = await agxTaskResolver("TSK-42");
    expect(result).toEqual({ targetType: "agx_task", targetId: "TSK-42" });
    expect(findAgxMock).toHaveBeenCalledWith("TSK-42");
  });

  test("is case-insensitive — normalizes to upper-case for lookup and target id", async () => {
    findAgxMock.mockResolvedValueOnce({ id: "uuid-task-2" });
    const result = await agxTaskResolver("tsk-7");
    expect(result).toEqual({ targetType: "agx_task", targetId: "TSK-7" });
    expect(findAgxMock).toHaveBeenCalledWith("TSK-7");
  });

  test("returns null when there is no matching task", async () => {
    findAgxMock.mockResolvedValueOnce(null);
    expect(await agxTaskResolver("TSK-404")).toBeNull();
  });
});

import { ConcurrentModificationError } from "@/lib/errors";

describe("ConcurrentModificationError", () => {
  test("includes entity info and versions in message", () => {
    const err = new ConcurrentModificationError("task", "t-1", 3, 5);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConcurrentModificationError");
    expect(err.entityType).toBe("task");
    expect(err.entityId).toBe("t-1");
    expect(err.expectedVersion).toBe(3);
    expect(err.actualVersion).toBe(5);
    expect(err.message).toContain("expected version 3");
    expect(err.message).toContain("found 5");
  });

  test("handles missing actual version", () => {
    const err = new ConcurrentModificationError("task", "t-2", 1);
    expect(err.actualVersion).toBeUndefined();
    expect(err.message).toContain("row not updated");
  });
});

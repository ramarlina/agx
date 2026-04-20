/**
 * @jest-environment node
 */

import { createProjectPayload } from "@/components/ProjectModal";
import {
  findInvalidProjectRepoDraft,
  formatInvalidProjectRepoDraftMessage,
} from "@/components/project-repo-validation";

describe("project repo validation", () => {
  test("ignores a fully blank starter row", () => {
    const repos = [{ name: "", path: "", notes: "" }];
    const payload = createProjectPayload(
      { name: "AGX", description: "" },
      repos
    );

    expect(findInvalidProjectRepoDraft(repos)).toBeNull();
    expect(payload.repos).toBeUndefined();
  });

  test("rejects a local path without a folder name", () => {
    const repos = [{ name: "", path: "/tmp/agx", notes: "" }];
    const invalidRepo = findInvalidProjectRepoDraft(repos);

    expect(invalidRepo).toEqual(
      expect.objectContaining({
        index: 0,
        issue: "missing_name",
      })
    );
    expect(formatInvalidProjectRepoDraftMessage(invalidRepo!)).toBe(
      'Folder name is required for local path "/tmp/agx"'
    );
    expect(() =>
      createProjectPayload({ name: "AGX", description: "" }, repos)
    ).toThrow('Folder name is required for local path "/tmp/agx"');
  });

  test("rejects a folder name without a local path", () => {
    const repos = [{ name: "Backend", path: "", notes: "" }];
    const invalidRepo = findInvalidProjectRepoDraft(repos);

    expect(invalidRepo).toEqual(
      expect.objectContaining({
        index: 0,
        issue: "missing_path",
      })
    );
    expect(formatInvalidProjectRepoDraftMessage(invalidRepo!)).toBe(
      'Local path is required for folder "Backend"'
    );
    expect(() =>
      createProjectPayload({ name: "AGX", description: "" }, repos)
    ).toThrow('Local path is required for folder "Backend"');
  });
});

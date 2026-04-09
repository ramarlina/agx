/**
 * @jest-environment node
 */

import { filterSuggestions } from "@/hooks/useMentionAutocomplete";

describe("useMentionAutocomplete ticket suggestions", () => {
  test("includes cached Linear tickets when the query matches an identifier", () => {
    const suggestions = filterSuggestions(
      [],
      "agx-10",
      10,
      [],
      [],
      [
        {
          id: "issue-1",
          identifier: "AGX-101",
          title: "Add copy link action",
          status: "Todo",
          url: null,
          assignee: null,
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ]
    );

    expect(suggestions).toEqual([
      {
        kind: "ticket",
        group: "Tickets",
        issue: {
          id: "issue-1",
          identifier: "AGX-101",
          title: "Add copy link action",
          status: "Todo",
          url: null,
          assignee: null,
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      },
    ]);
  });
});

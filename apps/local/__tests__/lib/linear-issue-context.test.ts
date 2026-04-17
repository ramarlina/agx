/**
 * @jest-environment node
 */

import type { JSONContent } from "@tiptap/core";
import {
  buildTrackerItemContextPrefix,
  extractMentionedTrackerItemIds,
} from "@/lib/chat/tracker-item-context";

describe("tracker item mention context", () => {
  test("extracts explicitly mentioned ticket ids from the composer document", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "trackerItemMention",
              attrs: {
                id: "issue-1",
                identifier: "AGX-101",
              },
            },
            { type: "text", text: " and " },
            {
              type: "trackerItemMention",
              attrs: {
                id: "issue-2",
                identifier: "AGX-102",
              },
            },
          ],
        },
      ],
    };

    expect(extractMentionedTrackerItemIds(doc)).toEqual(["issue-1", "issue-2"]);
  });

  test("formats cached tracker item context for prompt injection", () => {
    const prefix = buildTrackerItemContextPrefix([
      {
        id: "issue-1",
        identifier: "AGX-101",
        title: "Add copy link action",
        url: "https://linear.app/agx/issue/AGX-101/add-copy-link-action",
        status: "Todo",
        assignee: "Alex",
        assigneeId: "user-1",
        assigneeEmail: "alex@example.com",
        isAssignedToMe: true,
        teamId: "team-1",
        teamName: "AGX",
        teamKey: "AGX",
        cycleId: "cycle-1",
        cycleName: "Cycle 42",
        cycleNumber: 42,
        description: "Need to add a copy-link action to the row toolbar.",
        updatedAt: "2026-04-07T00:00:00.000Z",
        pulledAt: "2026-04-07T00:05:00.000Z",
      },
    ]);

    expect(prefix).toContain("Referenced tickets");
    expect(prefix).toContain('identifier="AGX-101"');
    expect(prefix).toContain("Need to add a copy-link action");
  });
});

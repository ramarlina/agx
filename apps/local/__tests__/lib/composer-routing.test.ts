/**
 * @jest-environment node
 */

import type { JSONContent } from "@tiptap/core";
import {
  extractComposerRouting,
  mergeComposerRouting,
  normalizeComposerRouting,
  orderParticipantIds,
} from "@/lib/chat/composer-routing";

describe("composer routing", () => {
  test("extracts pinned agent and explicit agent mentions from the composer doc", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "participantMention",
              attrs: {
                id: "agent-alpha",
                name: "Alpha",
                mode: "sequential",
                kind: "agent",
              },
            },
            { type: "text", text: " then " },
            {
              type: "participantMention",
              attrs: {
                id: "agent-beta",
                name: "Beta",
                mode: "parallel",
                kind: "agent",
              },
            },
            { type: "text", text: " and " },
            {
              type: "participantMention",
              attrs: {
                id: "project-1",
                name: "Growth",
                mode: "sequential",
                kind: "project",
              },
            },
          ],
        },
      ],
    };

    expect(extractComposerRouting(doc, "agent-pinned")).toEqual({
      pinnedParticipantId: "agent-pinned",
      mentionedParticipantIds: ["agent-alpha", "agent-beta"],
      parallelParticipantIds: ["agent-beta"],
    });
  });

  test("normalizes explicit routing metadata and makes parallel imply mention", () => {
    expect(
      normalizeComposerRouting({
        pinnedParticipantId: " agent-pinned ",
        mentionedParticipantIds: ["agent-alpha", "", "agent-alpha"],
        parallelParticipantIds: ["agent-beta", "agent-alpha"],
      })
    ).toEqual({
      pinnedParticipantId: "agent-pinned",
      mentionedParticipantIds: ["agent-alpha", "agent-beta"],
      parallelParticipantIds: ["agent-beta", "agent-alpha"],
    });
  });

  test("moves the pinned agent to the front without duplicating participants", () => {
    expect(
      orderParticipantIds(["agent-a", "agent-b", "agent-c"], "agent-b")
    ).toEqual(["agent-b", "agent-a", "agent-c"]);
  });

  test("merges typed mentions with explicit composer routing", () => {
    const merged = mergeComposerRouting(
      {
        mentioned: new Set(["agent-a"]),
        parallel: new Set<string>(),
      },
      {
        pinnedParticipantId: "agent-c",
        mentionedParticipantIds: ["agent-b"],
        parallelParticipantIds: ["agent-c"],
      }
    );

    expect(Array.from(merged.mentioned)).toEqual(["agent-a", "agent-b", "agent-c"]);
    expect(Array.from(merged.parallel)).toEqual(["agent-c"]);
  });
});

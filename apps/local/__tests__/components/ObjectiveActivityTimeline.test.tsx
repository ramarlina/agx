import { render, screen, waitFor } from "@testing-library/react";
import { ObjectiveActivityTimeline } from "@/components/projects/ObjectiveActivityTimeline";

jest.mock("@/components/chat-ui/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => (
    <div
      data-testid="mock-markdown"
      dangerouslySetInnerHTML={{
        __html: content
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>'),
      }}
    />
  ),
}));

describe("ObjectiveActivityTimeline", () => {
  beforeEach(() => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          activities: [
            {
              id: "activity-1",
              source: "scheduled-task:test",
              objectiveLabel: "Get 100 visitors daily",
              createdAt: "2026-04-13T12:00:00.000Z",
              type: "status-update",
              body: "**Daily visitor check** with [report](https://example.com/report)",
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
          hasMore: false,
        }),
      }),
    });
  });

  test("renders markdown in the collapsed activity preview", async () => {
    render(
      <ObjectiveActivityTimeline
        projectId="project-1"
        objectiveId="objective-1"
      />
    );

    await waitFor(() => expect(screen.getByText("Daily visitor check")).toBeInTheDocument());

    expect(screen.getByText("Daily visitor check").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "report" })).toHaveAttribute(
      "href",
      "https://example.com/report"
    );
  });
});

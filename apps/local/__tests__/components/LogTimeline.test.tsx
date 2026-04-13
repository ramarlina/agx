import { render, screen } from "@testing-library/react";
import LogTimeline from "@/components/LogTimeline";

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

describe("LogTimeline", () => {
  test("renders comment content as markdown in the timeline", () => {
    render(
      <LogTimeline
        comments={[
          {
            id: "comment-1",
            task_id: "task-1",
            author_type: "agent",
            content: "See **bold** text and [docs](https://example.com).",
            created_at: "2026-04-13T12:00:00.000Z",
          },
        ]}
        onAddComment={async () => {}}
      />,
    );

    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
  });
});

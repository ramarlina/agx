import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TicketRow } from "@/components/tracker/TicketRow";

jest.mock("@/components/tracker/NoteSticker", () => ({
  NoteSticker: ({ value }: { value: string }) => <div data-testid="note-sticker">{value}</div>,
}));

describe("TicketRow", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("waits for the saved note to load before opening the sticker", async () => {
    let resolveFetch: ((value: { json: () => Promise<{ content: string }> }) => void) | null = null;
    global.fetch = jest.fn(
      () =>
        new Promise<{ json: () => Promise<{ content: string }> }>((resolve) => {
          resolveFetch = resolve;
        })
    ) as jest.Mock;

    render(
      <TicketRow
        item={{
          id: "issue-1",
          trackerId: "linear",
          trackerType: "linear",
          identifier: "AGX-1",
          title: "Persist notes",
          status: "Todo",
          statusCategory: "todo",
          labels: [],
          createdAt: "2026-04-17T00:00:00.000Z",
          updatedAt: "2026-04-17T00:00:00.000Z",
          url: "https://example.com/issues/AGX-1",
        }}
        selected={false}
        onSelect={() => {}}
        projectSlug="agx"
      />
    );

    fireEvent.click(screen.getByLabelText("Add note"));

    expect(screen.queryByTestId("note-sticker")).not.toBeInTheDocument();

    resolveFetch?.({
      json: async () => ({ content: "Persisted note" }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("note-sticker")).toHaveTextContent("Persisted note");
    });
  });
});

import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NoteSticker } from "@/components/tracker/NoteSticker";

jest.mock("react-dom", () => {
  const actual = jest.requireActual("react-dom");
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

const setContentMock = jest.fn();
const focusMock = jest.fn();
let currentMarkdown = "";

jest.mock("@tiptap/react", () => ({
  useEditor: () => ({
    storage: {
      markdown: {
        getMarkdown: () => currentMarkdown,
      },
    },
    commands: {
      setContent: setContentMock,
      focus: focusMock,
    },
    isFocused: false,
  }),
  EditorContent: () => <div data-testid="editor-content" />,
}));

describe("NoteSticker", () => {
  beforeEach(() => {
    currentMarkdown = "";
    setContentMock.mockClear();
    focusMock.mockClear();
  });

  test("syncs the editor when the saved note value arrives after mount", async () => {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 10,
      left: 20,
      bottom: 30,
      right: 40,
      width: 20,
      height: 20,
      toJSON: () => ({}),
    });
    document.body.appendChild(anchor);

    const anchorRef = createRef<HTMLElement>();
    anchorRef.current = anchor;

    const noop = () => {};
    const { rerender } = render(
      <NoteSticker anchorRef={anchorRef} value="" onChange={noop} onClose={noop} onSave={noop} />
    );

    rerender(
      <NoteSticker anchorRef={anchorRef} value="Persisted note" onChange={noop} onClose={noop} onSave={noop} />
    );

    await waitFor(() => {
      expect(setContentMock).toHaveBeenCalledWith("Persisted note");
    });
  });
});

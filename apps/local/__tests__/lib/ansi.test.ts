import { parseAnsiSegments } from "@/lib/ansi";

describe("parseAnsiSegments", () => {
  test("renders plain text as a single unstyled segment", () => {
    const segments = parseAnsiSegments("hello world");
    expect(segments).toEqual([{ text: "hello world", style: undefined }]);
  });

  test("applies magenta and italic ANSI styles", () => {
    const segments = parseAnsiSegments("\u001b[35m\u001b[3mthinking\u001b[0m");
    expect(segments).toEqual([
      {
        text: "thinking",
        style: { color: "#c084fc", fontStyle: "italic" },
      },
    ]);
  });

  test("resets styles after 0m", () => {
    const segments = parseAnsiSegments("\u001b[31merr\u001b[0m ok");
    expect(segments).toEqual([
      { text: "err", style: { color: "#f87171" } },
      { text: " ok", style: undefined },
    ]);
  });

  test("strips standalone broken sgr fragments when ESC is missing", () => {
    const segments = parseAnsiSegments("alpha [0m beta [35m gamma");
    expect(segments).toEqual([{ text: "alpha beta gamma", style: undefined }]);
  });
});

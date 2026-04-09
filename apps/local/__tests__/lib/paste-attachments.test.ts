/**
 * @jest-environment jsdom
 */

import {
  clipboardMayContainImageAttachments,
  getClipboardAttachmentFiles,
  normalizeAttachmentFiles,
  readClipboardAttachmentFiles,
} from "@/lib/chat/paste-attachments";

function createClipboardData({
  text = "",
  files = [],
  items = [],
}: {
  text?: string;
  files?: File[];
  items?: DataTransferItem[];
}) {
  return {
    files,
    items,
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

describe("getClipboardAttachmentFiles", () => {
  it("extracts image files from clipboard items", () => {
    const image = new File(["png"], "", { type: "image/png" });
    const item = {
      kind: "file",
      type: "image/png",
      getAsFile: () => image,
    } as DataTransferItem;

    const result = getClipboardAttachmentFiles(createClipboardData({ items: [item] }));

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("image/png");
    expect(result[0]?.name).toBe("pasted-image-1.png");
  });

  it("lets long text pastes fall through to the editor", () => {
    const image = new File(["png"], "copied.png", { type: "image/png" });
    const item = {
      kind: "file",
      type: "image/png",
      getAsFile: () => image,
    } as DataTransferItem;

    const result = getClipboardAttachmentFiles(
      createClipboardData({
        text: `${"Long copied text ".repeat(20)}\nwith multiple lines`,
        items: [item],
      })
    );

    expect(result).toEqual([]);
  });

  it("leaves short plain-text pastes to the editor", () => {
    const result = getClipboardAttachmentFiles(
      createClipboardData({
        text: "short pasted text",
      })
    );

    expect(result).toEqual([]);
  });
});

describe("clipboardMayContainImageAttachments", () => {
  it("flags image clipboard payloads before the editor handles the paste", () => {
    const item = {
      kind: "file",
      type: "image/png",
      getAsFile: () => null,
    } as DataTransferItem;

    expect(clipboardMayContainImageAttachments(createClipboardData({ items: [item] }))).toBe(true);
  });

  it("does not hijack regular text paste", () => {
    expect(
      clipboardMayContainImageAttachments(
        createClipboardData({
          text: "just some text",
        })
      )
    ).toBe(false);
  });
});

describe("readClipboardAttachmentFiles", () => {
  it("falls back to async clipboard reads for image blobs", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const clipboardReader = {
      read: jest.fn().mockResolvedValue([
        {
          types: ["image/png"],
          getType: jest.fn().mockResolvedValue(blob),
        },
      ]),
    };

    const result = await readClipboardAttachmentFiles(
      createClipboardData({
        items: [
          {
            kind: "string",
            type: "image/png",
            getAsFile: () => null,
          } as DataTransferItem,
        ],
      }),
      clipboardReader
    );

    expect(clipboardReader.read).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("image/png");
    expect(result[0]?.name).toBe("pasted-image-1.png");
  });

  it("returns direct clipboard files without using the async clipboard API", async () => {
    const image = new File(["png"], "clipboard.png", { type: "image/png" });
    const clipboardReader = {
      read: jest.fn(),
    };

    const result = await readClipboardAttachmentFiles(
      createClipboardData({
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => image,
          } as DataTransferItem,
        ],
      }),
      clipboardReader
    );

    expect(clipboardReader.read).not.toHaveBeenCalled();
    expect(result).toEqual([image]);
  });
});

describe("normalizeAttachmentFiles", () => {
  it("keeps an existing filename", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const [normalized] = normalizeAttachmentFiles([file]);

    expect(normalized).toBe(file);
    expect(normalized?.name).toBe("notes.txt");
  });
});

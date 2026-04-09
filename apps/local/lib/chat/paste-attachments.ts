const TEXT_PASTE_LENGTH_THRESHOLD = 200;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/zip": "zip",
  "application/gzip": "gz",
};

type ClipboardLike = Pick<DataTransfer, "files" | "items" | "getData">;

interface ClipboardBlobLike {
  size: number;
  type: string;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

interface ClipboardItemLike {
  readonly types: readonly string[];
  getType(type: string): Promise<ClipboardBlobLike>;
}

interface ClipboardReaderLike {
  read(): Promise<ClipboardItemLike[]>;
}

function shouldLetEditorHandleTextPaste(text: string): boolean {
  const plainText = text.trim();
  if (!plainText) return false;
  return plainText.length >= TEXT_PASTE_LENGTH_THRESHOLD || plainText.includes("\n");
}

function buildFallbackFilename(file: File, index: number): string {
  const extension = MIME_EXTENSION_MAP[file.type] ?? "bin";
  const prefix = file.type.startsWith("image/") ? "pasted-image" : "attachment";
  return `${prefix}-${index + 1}.${extension}`;
}

function ensureFileName(file: File, index: number): File {
  const name = file.name.trim();
  if (name) return file;
  return new File([file], buildFallbackFilename(file, index), {
    type: file.type,
    lastModified: file.lastModified,
  });
}

export function normalizeAttachmentFiles(files: File[]): File[] {
  return files.map((file, index) => ensureFileName(file, index));
}

function isClipboardItemImageType(type: string): boolean {
  return type.startsWith("image/");
}

function getClipboardText(clipboardData: ClipboardLike | null): string {
  if (!clipboardData) return "";
  return clipboardData.getData("text/plain");
}

function shouldReadAttachmentsFromClipboard(clipboardData: ClipboardLike | null): boolean {
  const plainText = getClipboardText(clipboardData);
  if (shouldLetEditorHandleTextPaste(plainText)) {
    return false;
  }

  const itemTypes = Array.from(clipboardData?.items ?? []).map((item) => item.type);
  return (
    Array.from(clipboardData?.files ?? []).length > 0 ||
    Array.from(clipboardData?.items ?? []).some((item) => item.kind === "file") ||
    itemTypes.some(isClipboardItemImageType)
  );
}

export function getClipboardAttachmentFiles(clipboardData: ClipboardLike | null): File[] {
  if (!clipboardData) return [];

  // Some apps place both rich-text clipboard metadata and an image blob on the clipboard.
  // When the payload is clearly text-heavy, let the editor handle the paste instead of
  // hijacking it as an attachment upload.
  if (!shouldReadAttachmentsFromClipboard(clipboardData)) {
    return [];
  }

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const files = itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboardData.files ?? []);

  if (files.length === 0) return [];

  return normalizeAttachmentFiles(files);
}

export function clipboardMayContainImageAttachments(clipboardData: ClipboardLike | null): boolean {
  return shouldReadAttachmentsFromClipboard(clipboardData);
}

export async function readClipboardAttachmentFiles(
  clipboardData: ClipboardLike | null,
  clipboardReader?: ClipboardReaderLike | null
): Promise<File[]> {
  const directFiles = getClipboardAttachmentFiles(clipboardData);
  if (directFiles.length > 0) {
    return directFiles;
  }

  if (!shouldReadAttachmentsFromClipboard(clipboardData) || !clipboardReader?.read) {
    return [];
  }

  try {
    const clipboardItems = await clipboardReader.read();
    const files: File[] = [];

    for (const item of clipboardItems) {
      const imageTypes = item.types.filter(isClipboardItemImageType);
      for (const type of imageTypes) {
        const blob = await item.getType(type);
        const filePart =
          blob instanceof Blob
            ? blob
            : blob.arrayBuffer
              ? await blob.arrayBuffer()
              : null;
        if (!filePart) continue;
        files.push(
          new File([filePart], "", {
            type: blob.type || type,
            lastModified: Date.now(),
          })
        );
      }
    }

    return normalizeAttachmentFiles(files);
  } catch {
    return [];
  }
}

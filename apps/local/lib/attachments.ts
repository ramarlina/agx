// Attachment validation utilities

const MIME_ALLOWLIST = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  // Archives
  "application/zip",
  "application/gzip",
  // Office
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".vbs", ".vbe", ".js", ".jse", ".ws", ".wsf", ".wsc", ".wsh",
  ".ps1", ".ps2", ".psc1", ".psc2", ".reg", ".inf", ".lnk",
  ".dll", ".sys", ".drv",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_MESSAGE_SIZE = 50 * 1024 * 1024; // 50MB per message

export interface ValidationError {
  file: string;
  reason: string;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s.\-()]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

export function validateFile(file: { name: string; size: number; type: string }): ValidationError | null {
  const ext = file.name.includes(".")
    ? "." + file.name.split(".").pop()!.toLowerCase()
    : "";

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { file: file.name, reason: `File type "${ext}" is not allowed` };
  }

  if (file.type && !MIME_ALLOWLIST.has(file.type)) {
    return { file: file.name, reason: `File type "${file.type}" is not supported` };
  }

  if (!file.type && !MIME_ALLOWLIST.has("application/octet-stream")) {
    // Allow files without MIME type if extension is not blocked
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return { file: file.name, reason: `File is too large (${sizeMB}MB). Maximum is 10MB` };
  }

  if (file.size === 0) {
    return { file: file.name, reason: "File is empty" };
  }

  return null;
}

export function validateMessageAttachments(files: Array<{ name: string; size: number; type: string }>): ValidationError | null {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_MESSAGE_SIZE) {
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    return { file: "(total)", reason: `Total attachment size (${sizeMB}MB) exceeds 50MB limit` };
  }
  return null;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

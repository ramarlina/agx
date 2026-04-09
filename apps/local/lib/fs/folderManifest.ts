import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { FolderManifest } from "@/types/fileMention";

/**
 * Format bytes into a human-readable size summary string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Generate a lightweight manifest for a folder.
 *
 * Lists direct children (one level deep), counts files and subdirectories,
 * and provides a human-readable size summary of direct children.
 *
 * This is intentionally shallow to avoid injecting large context by default.
 * Callers who want full recursive contents should use readFileForContext or
 * a dedicated deep-tree expansion path.
 */
export async function getFolderManifest(folderPath: string): Promise<FolderManifest> {
  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return { childCount: 0, sizeSummary: "0 B", children: [] };
  }

  let totalSize = 0;
  let fileCount = 0;
  let dirCount = 0;
  const children: FolderManifest["children"] = [];

  await Promise.all(
    entries.map(async (name) => {
      try {
        const s = await stat(join(folderPath, name));
        const type: "file" | "folder" = s.isDirectory() ? "folder" : "file";
        if (type === "folder") {
          dirCount++;
        } else {
          fileCount++;
          totalSize += s.size;
        }
        children.push({ name, type, size: s.isFile() ? s.size : undefined });
      } catch {
        // Skip entries we can't stat (permissions, broken links, etc.)
      }
    })
  );

  // Sort: folders first, then by name
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    childCount: fileCount + dirCount,
    sizeSummary: formatSize(totalSize),
    children,
  };
}

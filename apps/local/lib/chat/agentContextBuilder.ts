/**
 * agentContextBuilder — utilities for assembling agent context payloads.
 *
 * Resolves @/path file mentions to their contents and builds structured
 * context blocks that can be injected into an agent message.
 */

import type { FilePathAttachment } from "@/hooks/useComposerAttachments";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileContextBlock {
  type: "file";
  path: string;
  label: string;
  /** Resolved file contents, or null when unavailable */
  content: string | null;
  /** Human-readable error if the file could not be read */
  error?: string;
}

export interface AgentContextPayload {
  /** Inline file context blocks derived from @/path mentions */
  fileContextBlocks: FileContextBlock[];
  /**
   * A preformatted context string ready to prepend to the user message.
   * Empty string when there are no file attachments.
   */
  contextPrefix: string;
}

// ─── File content resolver ────────────────────────────────────────────────────

/**
 * Fetch file contents for all pending file-path attachments via the
 * /api/file-read endpoint.
 *
 * Gracefully handles unreadable or missing files — those entries will have
 * `content: null` and a populated `error` field instead of throwing.
 */
export async function resolveFileAttachments(
  attachments: FilePathAttachment[]
): Promise<FileContextBlock[]> {
  if (attachments.length === 0) return [];

  const paths = attachments.map((a) => a.path);

  let results: Array<{ path: string; content: string | null; error?: string }>;

  try {
    const res = await fetch("/api/file-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      // Return all attachments as errors rather than throwing
      return attachments.map((a) => ({
        type: "file",
        path: a.path,
        label: a.label,
        content: null,
        error: message,
      }));
    }

    const data = (await res.json()) as {
      results: Array<{ path: string; content: string | null; error?: string }>;
    };
    results = data.results;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch file contents";
    return attachments.map((a) => ({
      type: "file",
      path: a.path,
      label: a.label,
      content: null,
      error: message,
    }));
  }

  // Map results back to FileContextBlock[], preserving the label from the attachment
  const resultByPath = new Map(results.map((r) => [r.path, r]));

  return attachments.map((a) => {
    const result = resultByPath.get(a.path);
    return {
      type: "file",
      path: a.path,
      label: a.label,
      content: result?.content ?? null,
      error: result?.error,
    };
  });
}

// ─── Context prefix builder ───────────────────────────────────────────────────

/**
 * Build a text prefix that injects file contents into the agent's context.
 * Files that failed to load are noted with an error annotation rather than
 * being silently omitted.
 *
 * Format:
 * ```
 * <file path="...">
 * ...contents...
 * </file>
 * ```
 */
export function buildContextPrefix(blocks: FileContextBlock[]): string {
  if (blocks.length === 0) return "";

  const parts = blocks.map((block) => {
    if (block.error || block.content === null) {
      return `<file path="${block.path}" error="${block.error ?? "unreadable"}" />`;
    }
    return `<file path="${block.path}">\n${block.content}\n</file>`;
  });

  return parts.join("\n\n") + "\n\n";
}

// ─── High-level builder ───────────────────────────────────────────────────────

/**
 * Resolve file attachments and build the full agent context payload.
 *
 * Usage:
 * ```ts
 * const ctx = await buildAgentContext(filePathAttachments);
 * const fullMessage = ctx.contextPrefix + userMessage;
 * ```
 */
export async function buildAgentContext(
  attachments: FilePathAttachment[]
): Promise<AgentContextPayload> {
  const fileContextBlocks = await resolveFileAttachments(attachments);
  const contextPrefix = buildContextPrefix(fileContextBlocks);

  return { fileContextBlocks, contextPrefix };
}

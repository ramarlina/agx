import fs from "fs/promises";
import path from "path";
import os from "os";
import type { GroupMessage, Participant } from "./types";

export interface ThreadRef {
  threadId: string;
  title: string;
  summary: string;
  filePath: string;
}

export interface ExportThreadRequest {
  rootMessageId: string;
  title: string;
  messages: GroupMessage[];
  participants: Participant[];
}

const MAX_CHARS = 100_000;
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function exportThreadToMarkdown(req: ExportThreadRequest): Promise<ThreadRef> {
  const { rootMessageId, title, messages, participants } = req;
  const participantMap = new Map(participants.map((p) => [p.id, p]));

  // Sort messages by timestamp (newest first for walking backward)
  const sortedMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp);

  let content = "";
  let totalChars = 0;
  const blocks: string[] = [];

  // Header
  const header = `# Thread: ${title}\n\n`;
  totalChars += header.length;

  // Walk backward from newest message
  for (const msg of sortedMessages) {
    const name = msg.role === "user" 
      ? "You" 
      : participantMap.get(msg.participantId!)?.name || msg.participantId || "Assistant";
    
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const block = `**${name}** (${timestamp}):\n${msg.content}\n\n---\n\n`;
    
    if (totalChars + block.length > MAX_CHARS) {
      blocks.unshift(`\n... (truncated to last ${MAX_CHARS} chars) ...\n\n`);
      break;
    }
    
    blocks.unshift(block);
    totalChars += block.length;
  }

  const fullContent = header + blocks.join("");
  const filename = `agx-thread-ref-${rootMessageId}.md`;
  const filePath = path.join(os.tmpdir(), filename);

  await fs.writeFile(filePath, fullContent, "utf-8");

  // Cleanup old files
  void cleanupOldExports();

  // Generate a brief summary (first 100 chars of last message or title)
  const lastMsg = sortedMessages[0];
  const summary = lastMsg 
    ? (lastMsg.content.slice(0, 100).replace(/\n/g, " ") + (lastMsg.content.length > 100 ? "..." : ""))
    : title;

  return {
    threadId: rootMessageId,
    title,
    summary,
    filePath,
  };
}

async function cleanupOldExports() {
  try {
    const tmpDir = os.tmpdir();
    const files = await fs.readdir(tmpDir);
    const now = Date.now();

    for (const file of files) {
      if (!file.startsWith("agx-thread-ref-") || !file.endsWith(".md")) continue;
      
      const filePath = path.join(tmpDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtimeMs > CLEANUP_AGE_MS) {
        await fs.unlink(filePath).catch((err) => console.error(`[thread-export] failed to unlink ${filePath}:`, err));
      }
    }
  } catch (err) {
    console.error("Failed to cleanup old thread exports:", err);
  }
}
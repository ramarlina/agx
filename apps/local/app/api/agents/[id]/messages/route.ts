import { NextRequest } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { pragmaSet } from "@/lib/sqlite-compat";
import path from "path";
import os from "os";
import { existsSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_DIR =
  process.env.AGX_GROUP_CHAT_DIR?.trim() ||
  path.join(os.homedir(), ".agx", "group-chat");
const DB_PATH = path.join(HISTORY_DIR, "history.sqlite");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  if (!existsSync(DB_PATH)) {
    return Response.json({ messages: [], stats: { total_messages: 0, threads_participated: 0 } });
  }

  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    pragmaSet(db, "journal_mode = WAL");

    // Get agent's messages with root content (thread title) and the preceding message in the thread
    const messages = db
      .prepare(
        `SELECT m.thread_id, m.id, m.role, m.participant_id, m.content, m.timestamp,
                m.root_message_id,
                root.content as root_content,
                prev.content as prev_content,
                prev.participant_id as prev_participant_id
         FROM messages m
         LEFT JOIN messages root ON root.id = m.root_message_id AND root.thread_id = m.thread_id
         LEFT JOIN messages prev ON prev.thread_id = m.thread_id
           AND prev.timestamp = (
             SELECT MAX(p.timestamp) FROM messages p
             WHERE p.thread_id = m.thread_id
               AND (p.root_message_id = m.root_message_id OR p.id = m.root_message_id)
               AND p.timestamp < m.timestamp
           )
         WHERE m.participant_id = ?
         ORDER BY m.timestamp DESC
         LIMIT 100`
      )
      .all(agentId) as Array<{
        thread_id: string;
        id: string;
        role: string;
        participant_id: string | null;
        content: string;
        timestamp: number;
        root_message_id: string | null;
        root_content: string | null;
        prev_content: string | null;
        prev_participant_id: string | null;
      }>;

    const statsRow = db
      .prepare(
        `SELECT COUNT(*) as total_messages,
                COUNT(DISTINCT root_message_id) as threads_participated
         FROM messages
         WHERE participant_id = ?`
      )
      .get(agentId) as { total_messages: number; threads_participated: number } | undefined;

    db.close();

    return Response.json({
      messages: messages.map((m) => ({
        threadId: m.thread_id,
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        rootMessageId: m.root_message_id,
        threadTitle: m.root_content ? m.root_content.slice(0, 120) : null,
        prevContent: m.prev_content ? m.prev_content.slice(0, 200) : null,
        prevParticipantId: m.prev_participant_id,
      })),
      stats: statsRow ?? { total_messages: 0, threads_participated: 0 },
    });
  } catch {
    return Response.json({ messages: [], stats: { total_messages: 0, threads_participated: 0 } });
  }
}

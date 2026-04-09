import { NextResponse } from "next/server";
import { exportThreadToMarkdown } from "@/lib/thread-export";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { rootMessageId, title, messages, participants } = body;

    if (!rootMessageId || !messages || !participants) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const ref = await exportThreadToMarkdown({
      rootMessageId,
      title,
      messages,
      participants,
    });

    return NextResponse.json(ref);
  } catch (error) {
    console.error("Thread export failed:", error);
    return NextResponse.json(
      { error: "Failed to export thread" },
      { status: 500 }
    );
  }
}
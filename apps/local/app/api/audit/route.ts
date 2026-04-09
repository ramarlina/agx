import { NextRequest, NextResponse } from "next/server";

// GET /api/audit - Get audit logs for the current user
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      logs: [],
      pagination: { limit: 0, offset: 0, hasMore: false },
      warning: "Audit endpoint is unavailable in this runtime.",
    },
    { status: 501 }
  );
}

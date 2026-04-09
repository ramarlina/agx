import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(req: NextRequest) {
  const rawPath = req.nextUrl.searchParams.get("path");
  const target = rawPath?.trim() || os.homedir();

  try {
    const resolved = path.resolve(target);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolved);

    return NextResponse.json({
      current: resolved,
      parent: parent !== resolved ? parent : null,
      dirs,
    });
  } catch {
    return NextResponse.json(
      { error: "Cannot read directory", current: target, parent: null, dirs: [] },
      { status: 400 }
    );
  }
}

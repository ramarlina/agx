import { NextResponse } from "next/server";
import { readLatestRecap } from "@/src/linear-recap/storage";
import { getDefaultRunner } from "@/src/linear-recap/runner";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const latest = await readLatestRecap(id);
  const runner = getDefaultRunner();
  const jobState = runner.get(id);

  return NextResponse.json({
    content: latest?.content ?? null,
    generatedAt: latest?.generatedAt.toISOString() ?? null,
    filePath: latest?.filePath ?? null,
    status: jobState?.status ?? "idle",
    error: jobState?.error ?? null,
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const runner = getDefaultRunner();
  const state = runner.enqueue(id);
  return NextResponse.json({
    status: state.status,
    startedAt: new Date(state.startedAt).toISOString(),
  });
}

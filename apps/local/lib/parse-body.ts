import { NextResponse } from "next/server";

type ParseBodySuccess<T> = { ok: true; body: T };
type ParseBodyFailure = { ok: false; response: NextResponse };
type ParseBodyResult<T> = ParseBodySuccess<T> | ParseBodyFailure;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseBody<T = any>(
  request: Request,
): Promise<ParseBodyResult<T>> {
  try {
    const body = await request.json();
    return { ok: true, body: body as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or missing request body" },
        { status: 400 },
      ),
    };
  }
}

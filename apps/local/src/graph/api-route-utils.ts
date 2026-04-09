import { NextResponse } from "next/server";
import { z } from "zod";

import { ConflictResponseSchema } from "@/src/graph/api-schemas";
import { GraphVersionConflictError } from "@/src/graph/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTaskId(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || !UUID_RE.test(normalized)) return null;
  return normalized;
}

export function normalizeNodeId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<
  | { ok: true; data: z.infer<T> }
  | { ok: false; response: NextResponse }
> {
  const rawBody = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid request payload",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

export function jsonWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json(schema.parse(value), init);
}

export function graphConflictResponse(error: GraphVersionConflictError): NextResponse {
  return jsonWithSchema(
    ConflictResponseSchema,
    {
      error: error.message,
      expectedVersion: error.expectedVersion,
      actualVersion: error.actualVersion,
      currentGraphVersion: error.actualVersion,
    },
    { status: 409 },
  );
}

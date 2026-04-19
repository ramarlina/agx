import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { SchemaNotReadyError } from "@/lib/notifications";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return value;
}

export async function readJsonRecord(request: NextRequest): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  try {
    const body = await request.json();
    if (!isRecord(body)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid payload" }, { status: 400 }),
      };
    }

    return { ok: true, body };
  } catch (error) {
    logger.error("[webhooks] body parse failed", logger.formatError(error));
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 }),
    };
  }
}

export function parseCreateWebhookInput(body: Record<string, unknown>) {
  const url = asOptionalString(body.url);
  const events = asStringArray(body.events);
  const name = asOptionalString(body.name);
  const enabled = asOptionalBoolean(body.enabled);

  if (typeof url !== "string") {
    return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 });
  }

  if (!events) {
    return NextResponse.json({ error: "events must be an array of strings" }, { status: 400 });
  }

  if (name === undefined && body.name !== undefined) {
    return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
  }

  if (enabled === undefined && body.enabled !== undefined) {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  return {
    url,
    events,
    ...(name !== undefined ? { name } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  };
}

export function parseUpdateWebhookInput(body: Record<string, unknown>) {
  const hasKnownField = ["url", "events", "name", "enabled"].some((key) => key in body);
  if (!hasKnownField) {
    return NextResponse.json(
      { error: "Provide at least one of url, events, name, or enabled" },
      { status: 400 }
    );
  }

  const updates: {
    url?: string | null;
    events?: string[] | null;
    name?: string | null;
    enabled?: boolean;
  } = {};

  if ("url" in body) {
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a string" }, { status: 400 });
    }
    updates.url = body.url;
  }

  if ("events" in body) {
    const events = asStringArray(body.events);
    if (!events) {
      return NextResponse.json({ error: "events must be an array of strings" }, { status: 400 });
    }
    updates.events = events;
  }

  if ("name" in body) {
    const name = asOptionalString(body.name);
    if (name === undefined) {
      return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
    }
    updates.name = name;
  }

  if ("enabled" in body) {
    const enabled = asOptionalBoolean(body.enabled);
    if (enabled === undefined) {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    updates.enabled = enabled;
  }

  return updates;
}

export function handleWebhookRouteError(action: string, error: unknown) {
  logger.error(`[webhooks] failed to ${action}`, logger.formatError(error));

  if (error instanceof SchemaNotReadyError) {
    return NextResponse.json(
      {
        error: "Webhook schema is not available. Run DB migrations to create notification_webhooks.",
        code: "SCHEMA_NOT_READY",
      },
      { status: 503 }
    );
  }

  if (error instanceof Error) {
    if (
      error.message === "Webhook not found"
    ) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (
      error.message.includes("At least one supported event is required") ||
      error.message.includes("Webhook URL") ||
      error.message === "No changes provided"
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 });
}

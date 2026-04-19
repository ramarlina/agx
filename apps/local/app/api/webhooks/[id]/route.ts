import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  deleteNotificationWebhook,
  getNotificationWebhook,
  updateNotificationWebhook,
} from "@/lib/notifications";
import {
  handleWebhookRouteError,
  parseUpdateWebhookInput,
  readJsonRecord,
} from "../shared";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const webhook = await getNotificationWebhook(LOCAL_USER.id, id);
    if (!webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    return NextResponse.json({ webhook });
  } catch (error) {
    return handleWebhookRouteError("fetch webhook", error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = await readJsonRecord(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const input = parseUpdateWebhookInput(parsed.body);
  if (input instanceof Response) {
    return input;
  }

  try {
    const existing = await getNotificationWebhook(LOCAL_USER.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    const webhook = await updateNotificationWebhook(LOCAL_USER.id, id, input);
    return NextResponse.json({ webhook });
  } catch (error) {
    return handleWebhookRouteError("update webhook", error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const existing = await getNotificationWebhook(LOCAL_USER.id, id);
    if (!existing) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    await deleteNotificationWebhook(LOCAL_USER.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleWebhookRouteError("delete webhook", error);
  }
}

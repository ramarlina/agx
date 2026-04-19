import { NextRequest, NextResponse } from "next/server";
import { LOCAL_USER } from "@/lib/auth-mode";
import {
  createNotificationWebhook,
  listNotificationWebhooks,
} from "@/lib/notifications";
import {
  handleWebhookRouteError,
  parseCreateWebhookInput,
  readJsonRecord,
} from "./shared";

export async function GET(_request: NextRequest) {
  try {
    const webhooks = await listNotificationWebhooks(LOCAL_USER.id);
    return NextResponse.json({ webhooks });
  } catch (error) {
    return handleWebhookRouteError("list webhooks", error);
  }
}

export async function POST(request: NextRequest) {
  const parsed = await readJsonRecord(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const input = parseCreateWebhookInput(parsed.body);
  if (input instanceof Response) {
    return input;
  }

  try {
    const webhook = await createNotificationWebhook(LOCAL_USER.id, input);
    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    return handleWebhookRouteError("create webhook", error);
  }
}

import { createAdminDbClient } from '@/lib/db-adapter';
import { logger } from '@/lib/logger';
import type { TaskStage, TaskStatus } from '@/lib/db-adapter.interface';
import {
  NotificationEventType,
  NOTIFICATION_EVENT_VALUES,
} from './constants';

type NotificationWebhookRaw = Record<string, any>;

export interface NotificationWebhookRecord {
  id: string;
  user_id: string;
  url: string;
  name: string | null;
  events: NotificationEventType[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationWebhookCreateInput {
  url: string;
  events: (string | NotificationEventType)[];
  name?: string | null;
  enabled?: boolean;
}

export interface NotificationWebhookUpdateInput {
  url?: string | null;
  events?: (string | NotificationEventType)[] | null;
  name?: string | null;
  enabled?: boolean;
}

export interface NotificationEventPayload {
  taskId: string;
  userId: string;
  eventType: NotificationEventType;
  title?: string | null;
  slug?: string | null;
  stage?: TaskStage | null;
  previousStage?: TaskStage | null;
  nextStage?: TaskStage | null;
  status?: TaskStatus | null;
  error?: string | null;
  timestamp?: string;
  details?: Record<string, unknown>;
}

export class SchemaNotReadyError extends Error {}

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as any).code;
  const message = typeof (error as any).message === 'string' ? (error as any).message : '';
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes(`relation \"${relation}\" does not exist`) ||
    message.includes(`Could not find the table 'agx.${relation}'`) ||
    message.includes(`Could not find the table 'public.${relation}'`)
  );
}

export function normalizeEvents(input: (string | NotificationEventType)[] | undefined | null): NotificationEventType[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<NotificationEventType>();
  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (NOTIFICATION_EVENT_VALUES.includes(trimmed as NotificationEventType)) {
      seen.add(trimmed as NotificationEventType);
    }
  }
  return Array.from(seen);
}

export function mapWebhookRecord(raw: NotificationWebhookRaw): NotificationWebhookRecord {
  const events = Array.isArray(raw.events)
    ? raw.events
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value): value is NotificationEventType =>
          NOTIFICATION_EVENT_VALUES.includes(value as NotificationEventType)
        )
    : [];

  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    url: String(raw.url),
    name: raw.name != null ? String(raw.name) : null,
    events,
    enabled: raw.enabled !== false,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

async function handleRelationError(relation: string, error: unknown): Promise<never> {
  if (isMissingRelationError(error, relation)) {
    throw new SchemaNotReadyError(`Missing relation: ${relation}`);
  }
  throw error;
}

export async function listNotificationWebhooks(userId: string): Promise<NotificationWebhookRecord[]> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from('notification_webhooks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    await handleRelationError('notification_webhooks', error);
  }

  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map(mapWebhookRecord);
}

export async function getNotificationWebhook(
  userId: string,
  webhookId: string
): Promise<NotificationWebhookRecord | null> {
  const db = createAdminDbClient();
  const { data, error } = await db
    .from('notification_webhooks')
    .select('*')
    .eq('user_id', userId)
    .eq('id', webhookId)
    .maybeSingle();

  if (error) {
    if ((error as any)?.code === 'PGRST116') {
      return null;
    }
    await handleRelationError('notification_webhooks', error);
  }

  if (!data) return null;
  return mapWebhookRecord(data);
}

export async function createNotificationWebhook(
  userId: string,
  input: NotificationWebhookCreateInput
): Promise<NotificationWebhookRecord> {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) {
    throw new Error('Webhook URL is required');
  }

  const events = normalizeEvents(input.events);
  if (!events.length) {
    throw new Error('At least one supported event is required');
  }

  const payload = {
    user_id: userId,
    url,
    name: input.name ? input.name.trim() : null,
    events,
    enabled: input.enabled !== false,
  };

  const db = createAdminDbClient();
  const { data, error } = await db
    .from('notification_webhooks')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    await handleRelationError('notification_webhooks', error);
  }

  if (!data) {
    throw new Error('Failed to create webhook');
  }

  return mapWebhookRecord(data);
}

export async function updateNotificationWebhook(
  userId: string,
  webhookId: string,
  input: NotificationWebhookUpdateInput
): Promise<NotificationWebhookRecord> {
  const updates: Record<string, unknown> = {};

  if (input.url !== undefined) {
    const url = input.url ? input.url.trim() : '';
    if (!url) {
      throw new Error('Webhook URL cannot be empty');
    }
    updates.url = url;
  }

  if (input.name !== undefined) {
    updates.name = input.name ? input.name.trim() : null;
  }

  if (input.events !== undefined) {
    const events = normalizeEvents(input.events || undefined);
    if (!events.length) {
      throw new Error('At least one supported event is required');
    }
    updates.events = events;
  }

  if (input.enabled !== undefined) {
    updates.enabled = input.enabled;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No changes provided');
  }

  const db = createAdminDbClient();
  const { data, error } = await db
    .from('notification_webhooks')
    .update(updates)
    .eq('id', webhookId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    await handleRelationError('notification_webhooks', error);
  }

  if (!data) {
    throw new Error('Webhook not found');
  }

  return mapWebhookRecord(data);
}

export async function deleteNotificationWebhook(userId: string, webhookId: string): Promise<void> {
  const db = createAdminDbClient();
  const { error } = await db
    .from('notification_webhooks')
    .delete()
    .eq('id', webhookId)
    .eq('user_id', userId);

  if (error) {
    await handleRelationError('notification_webhooks', error);
  }
}

export async function notifyTaskEvent(payload: NotificationEventPayload): Promise<void> {
  if (!payload.userId) return;

  let endpoints: NotificationWebhookRecord[] = [];
  try {
    endpoints = await listNotificationWebhooks(payload.userId);
  } catch (error) {
    if (error instanceof SchemaNotReadyError) {
      console.debug('[notifications] notification_webhooks schema not ready, skipping');
      return;
    }
    logger.error('[notifications] failed to load webhooks', logger.formatError(error));
    return;
  }

  const targets = endpoints.filter(
    (endpoint) => endpoint.enabled && endpoint.events.includes(payload.eventType)
  );

  if (!targets.length) return;

  const timestamp = payload.timestamp || new Date().toISOString();
  const body = {
    eventType: payload.eventType,
    taskId: payload.taskId,
    userId: payload.userId,
    title: payload.title || null,
    slug: payload.slug || null,
    stage: payload.stage || null,
    previousStage: payload.previousStage || null,
    nextStage: payload.nextStage || null,
    status: payload.status || null,
    error: payload.error || null,
    timestamp,
    details: payload.details || {},
  };

  await Promise.all(
    targets.map(async (endpoint) => {
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          logger.error(
            `[notifications] webhook ${endpoint.url} responded with ${response.status}`
          );
        }
      } catch (error) {
        logger.error(`[notifications] failed to send to ${endpoint.url}`, logger.formatError(error));
      }
    })
  );
}

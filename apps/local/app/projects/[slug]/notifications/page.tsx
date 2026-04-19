"use client";

import { use, useEffect, useMemo, useState } from "react";
import { Bell, Loader2, Save, Trash2 } from "lucide-react";
import { useProjectsWithAgents } from "@/hooks/useProjects";
import { NOTIFICATION_EVENT_OPTIONS } from "@/lib/notifications/constants";
import type { NotificationWebhookRecord } from "@/lib/notifications";

type WebhookDraft = {
  url: string;
  name: string;
  events: string[];
  enabled: boolean;
};

function formatApiError(fallback: string, error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function draftFromWebhook(webhook: NotificationWebhookRecord): WebhookDraft {
  return {
    url: webhook.url,
    name: webhook.name ?? "",
    events: [...webhook.events],
    enabled: webhook.enabled,
  };
}

async function readApiResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Request failed"
    );
  }
  return data;
}

function EventChecklist({
  selected,
  disabled = false,
  onChange,
}: {
  selected: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {NOTIFICATION_EVENT_OPTIONS.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <label
            key={option.value}
            className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
              checked
                ? "border-[var(--foreground)]/20 bg-[var(--app-shell-elevated)]"
                : "border-[var(--app-shell-border)] bg-[var(--app-shell-pane)]"
            } ${disabled ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-[var(--app-shell-border-strong)]"
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange([...selected, option.value]);
                  return;
                }
                onChange(selected.filter((value) => value !== option.value));
              }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--foreground)]">
                {option.label}
              </span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function WebhookCard({
  webhook,
  onSave,
  onDelete,
}: {
  webhook: NotificationWebhookRecord;
  onSave: (
    webhookId: string,
    draft: WebhookDraft
  ) => Promise<void>;
  onDelete: (webhookId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WebhookDraft>(() => draftFromWebhook(webhook));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftFromWebhook(webhook));
    setError(null);
  }, [webhook]);

  const isDirty = useMemo(() => {
    const original = draftFromWebhook(webhook);
    return JSON.stringify(original) !== JSON.stringify(draft);
  }, [draft, webhook]);

  return (
    <article className="rounded-2xl border border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {webhook.name || webhook.url}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Created {new Date(webhook.created_at).toLocaleString()}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-[var(--app-shell-border)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={saving || deleting}
            onChange={(event) =>
              setDraft((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          Enabled
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Display name
          </span>
          <input
            type="text"
            value={draft.name}
            disabled={saving || deleting}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Production alerts"
            className="w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground)]/30"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Webhook URL
          </span>
          <input
            type="url"
            value={draft.url}
            disabled={saving || deleting}
            onChange={(event) =>
              setDraft((current) => ({ ...current, url: event.target.value }))
            }
            placeholder="https://hooks.example.com/agx"
            className="w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground)]/30"
          />
        </label>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Events
        </p>
        <EventChecklist
          selected={draft.events}
          disabled={saving || deleting}
          onChange={(events) => setDraft((current) => ({ ...current, events }))}
        />
      </div>

      {error ? (
        <p className="mt-3 text-sm text-rose-500">{error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!isDirty || saving || deleting}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await onSave(webhook.id, draft);
            } catch (saveError) {
              setError(formatApiError("Failed to save webhook", saveError));
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--background)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </button>
        <button
          type="button"
          disabled={!isDirty || saving || deleting}
          onClick={() => {
            setDraft(draftFromWebhook(webhook));
            setError(null);
          }}
          className="rounded-xl border border-[var(--app-shell-border)] px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:border-[var(--app-shell-border-strong)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          disabled={saving || deleting}
          onClick={async () => {
            if (!window.confirm(`Delete webhook "${webhook.name || webhook.url}"?`)) {
              return;
            }
            setDeleting(true);
            setError(null);
            try {
              await onDelete(webhook.id);
            } catch (deleteError) {
              setError(formatApiError("Failed to delete webhook", deleteError));
              setDeleting(false);
            }
          }}
          className="ml-auto inline-flex items-center gap-2 rounded-xl border border-rose-500/20 px-3 py-2 text-sm text-rose-500 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete
        </button>
      </div>
    </article>
  );
}

export default function NotificationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { projects } = useProjectsWithAgents();
  const project = projects.find((entry) => entry.slug === slug);

  const [webhooks, setWebhooks] = useState<NotificationWebhookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<WebhookDraft>({
    name: "",
    url: "",
    events: ["task.completed"],
    enabled: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadWebhooks() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/webhooks");
        const data = await readApiResponse(response);
        if (!cancelled) {
          setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(formatApiError("Failed to load webhooks", loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadWebhooks();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <section className="rounded-3xl border border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] p-6 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--app-shell-elevated)] text-[var(--foreground)]">
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold text-[var(--foreground)]">
                Notifications
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
                Manage outbound webhooks for task events. These endpoints are user-scoped and
                apply across all of your AGX work, not just <span className="text-[var(--foreground)]">{project.name}</span>.
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                Delivery is best-effort and at-most-once. Slow endpoints time out after 10 seconds.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Add webhook
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Start with a generic endpoint. Slack formatting and signing can follow later.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Display name
              </span>
              <input
                type="text"
                value={createDraft.name}
                disabled={creating}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="PagerDuty bridge"
                className="w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground)]/30"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Webhook URL
              </span>
              <input
                type="url"
                value={createDraft.url}
                disabled={creating}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://hooks.example.com/agx"
                className="w-full rounded-xl border border-[var(--app-shell-border)] bg-[var(--app-shell-elevated)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground)]/30"
              />
            </label>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Events
            </p>
            <EventChecklist
              selected={createDraft.events}
              disabled={creating}
              onChange={(events) =>
                setCreateDraft((current) => ({ ...current, events }))
              }
            />
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={createDraft.enabled}
              disabled={creating}
              onChange={(event) =>
                setCreateDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            Enabled immediately
          </label>

          {error ? <p className="mt-4 text-sm text-rose-500">{error}</p> : null}

          <div className="mt-5">
            <button
              type="button"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                setError(null);
                try {
                  const response = await fetch("/api/webhooks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      url: createDraft.url,
                      events: createDraft.events,
                      name: createDraft.name || null,
                      enabled: createDraft.enabled,
                    }),
                  });
                  const data = await readApiResponse(response);
                  setWebhooks((current) => [data.webhook, ...current]);
                  setCreateDraft({
                    name: "",
                    url: "",
                    events: ["task.completed"],
                    enabled: true,
                  });
                } catch (createError) {
                  setError(formatApiError("Failed to create webhook", createError));
                } finally {
                  setCreating(false);
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Create webhook
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Configured endpoints
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Edit delivery targets, event subscriptions, and enabled state.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-3xl border border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] px-6 py-16 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading webhooks...
            </div>
          ) : null}

          {!loading && webhooks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[var(--app-shell-border)] bg-[var(--app-shell-pane)] px-6 py-12 text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">
                No webhooks configured yet
              </p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Add your first endpoint above to start receiving task notifications.
              </p>
            </div>
          ) : null}

          {!loading
            ? webhooks.map((webhook) => (
                <WebhookCard
                  key={webhook.id}
                  webhook={webhook}
                  onSave={async (webhookId, draft) => {
                    const response = await fetch(`/api/webhooks/${webhookId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        url: draft.url,
                        name: draft.name || null,
                        events: draft.events,
                        enabled: draft.enabled,
                      }),
                    });
                    const data = await readApiResponse(response);
                    setWebhooks((current) =>
                      current.map((entry) =>
                        entry.id === webhookId ? data.webhook : entry
                      )
                    );
                  }}
                  onDelete={async (webhookId) => {
                    const response = await fetch(`/api/webhooks/${webhookId}`, {
                      method: "DELETE",
                    });
                    await readApiResponse(response);
                    setWebhooks((current) =>
                      current.filter((entry) => entry.id !== webhookId)
                    );
                  }}
                />
              ))
            : null}
        </section>
      </div>
    </div>
  );
}

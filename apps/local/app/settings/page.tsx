"use client";

import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import DatabaseStatus from "@/components/settings/DatabaseStatus";

type Settings = {
  default_provider?: string | null;
  models?: Record<string, string>;
  provenance?: string;
  changed_at?: string;
};

const PROVIDERS = ["gemini", "claude", "ollama", "codex", "zai"] as const;

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const defaultProvider = settings?.default_provider || "gemini";
  const defaultModel = useMemo(() => {
    const models = settings?.models || {};
    return models[defaultProvider] || "";
  }, [settings, defaultProvider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/user-settings", { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!cancelled) setSettings(data.settings || { default_provider: "gemini", models: {} });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateProvider = (provider: string) => {
    setSettings((s) => ({ ...(s || {}), default_provider: provider }));
  };

  const updateModel = (model: string) => {
    setSettings((s) => {
      const next = { ...(s || {}) };
      const models = { ...(next.models || {}) };
      models[defaultProvider] = model;
      next.models = models;
      return next;
    });
  };

  const onSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        default_provider: defaultProvider,
        default_model: defaultModel,
        models: settings?.models || {},
        provenance: "web",
      };
      const res = await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSettings(data.settings || payload);
    } catch (e: any) {
      setError(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-start justify-between gap-6 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Default provider/model used by the CLI and the board.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={loading || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="card p-6">
          {loading ? (
            <div className="text-sm text-[var(--muted-foreground)]">Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-2">
                    Default Provider
                  </label>
                  <select
                    className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm"
                    value={defaultProvider}
                    onChange={(e) => updateProvider(e.target.value)}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-2">
                    Default Model ({defaultProvider})
                  </label>
                  <input
                    className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--background)] px-3 py-2 text-sm"
                    value={defaultModel}
                    placeholder="e.g. claude-sonnet-4, gemini-2.5-pro, llama3.2:3b, glm-4.5-air"
                    onChange={(e) => updateModel(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-6 text-xs text-[var(--muted-foreground)]">
                <div>Provenance: {settings?.provenance || "unknown"}</div>
                <div>Changed at: {settings?.changed_at || "unknown"}</div>
              </div>
            </>
          )}
        </div>
        <div className="mt-8">
          <DatabaseStatus />
        </div>
      </div>
    </Layout>
  );
}

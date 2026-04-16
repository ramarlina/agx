"use client";

import React from "react";
import type { TrackerConnection } from "@/lib/tracker/types";
import { TrackerIcon } from "./TrackerIcon";

interface TrackerSetupProps {
  trackerType: string;
  projectId: string;
  connected: boolean;
  onConnect: () => void;
  onConnectWithKey: (apiKey: string) => Promise<{ ok: boolean; error?: string }>;
  loading?: boolean;
}

/**
 * Tracker-agnostic setup/connect component.
 * Shows connection status and provides connect/disconnect actions.
 * Phase 1: delegates to existing LinearSetup for the 'linear' tracker type.
 * Phase 2: renders tracker-specific setup UIs per adapter.
 */
export default function TrackerSetup({
  trackerType,
  projectId,
  connected,
  onConnect,
  onConnectWithKey,
  loading = false,
}: TrackerSetupProps) {
  const [apiKey, setApiKey] = React.useState("");
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground" />
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <TrackerIcon trackerType={trackerType} className="h-4 w-4" />
        <span className="capitalize">{trackerType}</span> is connected
      </div>
    );
  }

  const handleKeyConnect = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setKeyError(null);
    const result = await onConnectWithKey(apiKey.trim());
    setSaving(false);
    if (!result.ok) {
      setKeyError(result.error ?? "Failed to connect");
    } else {
      setApiKey("");
      setShowKeyInput(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-8">
      <TrackerIcon trackerType={trackerType} className="h-8 w-8" />
      <h3 className="text-lg font-semibold capitalize">Connect {trackerType}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        Connect your {trackerType} workspace to enable issue tracking and agent workflows.
      </p>

      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={onConnect}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Connect with OAuth
        </button>

        <button
          onClick={() => setShowKeyInput(!showKeyInput)}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {showKeyInput ? "Hide API key input" : "Connect with API key"}
        </button>

        {showKeyInput && (
          <div className="flex flex-col gap-2 mt-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API key"
              className="px-3 py-2 border rounded-md text-sm bg-background"
              onKeyDown={(e) => e.key === "Enter" && handleKeyConnect()}
            />
            {keyError && (
              <p className="text-xs text-destructive">{keyError}</p>
            )}
            <button
              onClick={handleKeyConnect}
              disabled={saving || !apiKey.trim()}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium hover:bg-secondary/90 disabled:opacity-50"
            >
              {saving ? "Connecting..." : "Connect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
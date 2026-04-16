"use client";

import type { ComponentType } from "react";
import { getAdapterOrNull } from "@/lib/tracker/registry";
import { LinearIcon } from "@/lib/tracker/adapters/linear/linear-icon";

interface TrackerIconProps {
  trackerType: string;
  className?: string;
}

/**
 * Dynamically renders the icon for a given tracker type.
 * Falls back to a generic icon if the adapter is not registered.
 */
export function TrackerIcon({ trackerType, className }: TrackerIconProps) {
  const adapter = getAdapterOrNull(trackerType);
  if (!adapter) {
    return <GenericTrackerIcon className={className} />;
  }
  const Icon = adapter.icon as ComponentType<{ className?: string }>;
  return <Icon className={className} />;
}

/**
 * Fallback icon for unknown tracker types.
 */
function GenericTrackerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  );
}

/**
 * Get the adapter icon component for server-side rendering.
 * Returns the Linear icon by default (most common case in Phase 1).
 */
export function getTrackerIconComponent(trackerType: string): ComponentType<{ className?: string }> {
  const adapter = getAdapterOrNull(trackerType);
  if (adapter) {
    return adapter.icon as ComponentType<{ className?: string }>;
  }
  return LinearIcon;
}
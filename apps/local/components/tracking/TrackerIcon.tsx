"use client";

import type { ComponentType } from "react";
import { LinearIcon } from "@/lib/tracker/adapters/linear/linear-icon";
import { JiraIcon } from "@/lib/tracker/adapters/jira/jira-icon";

/** Client-side icon map — the adapter registry is server-only. */
const TRACKER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  linear: LinearIcon,
  jira: JiraIcon,
};

interface TrackerIconProps {
  trackerType: string;
  className?: string;
}

/**
 * Renders the icon for a given tracker type.
 * Falls back to a generic clipboard icon for unknown types.
 */
export function TrackerIcon({ trackerType, className }: TrackerIconProps) {
  const Icon = TRACKER_ICONS[trackerType];
  if (Icon) {
    return <Icon className={className} />;
  }
  return <GenericTrackerIcon className={className} />;
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
 * Get the icon component for a tracker type.
 * Returns the Linear icon as fallback.
 */
export function getTrackerIconComponent(trackerType: string): ComponentType<{ className?: string }> {
  return TRACKER_ICONS[trackerType] ?? LinearIcon;
}
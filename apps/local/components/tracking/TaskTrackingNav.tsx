"use client";

import Link from "next/link";
import { Plus, AlertTriangle } from "lucide-react";
import { TrackerIcon } from "./TrackerIcon";

interface TrackerEntry {
  type: string;
  connected: boolean;
  connectedAt: string;
}

interface TaskTrackingNavProps {
  projectSlug: string;
  trackerConnections: TrackerEntry[];
  activeTrackerType?: string | null;
  /** Currently active project view — used for highlight state */
  isTrackingActive: boolean;
  onLinkClick?: () => void;
}

/** Display name mapping for known tracker types */
const TRACKER_LABELS: Record<string, string> = {
  linear: "Linear",
  jira: "Jira",
  intercom: "Intercom",
  freshdesk: "Freshdesk",
  github: "GitHub Issues",
};

function getTrackerLabel(type: string): string {
  return TRACKER_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Expandable "Task Tracking" sidebar nav section.
 *
 * States:
 * - No trackers connected: shows only "+ Connect"
 * - One tracker connected: shows just that tracker (no "+ Connect" — keep it clean)
 * - Multiple trackers: shows each tracker + "+ Connect"
 * - Auth expired: shows warning badge on the affected tracker
 */
export function TaskTrackingNav({
  projectSlug,
  trackerConnections,
  activeTrackerType,
  isTrackingActive,
  onLinkClick,
}: TaskTrackingNavProps) {
  // Sort by connectedAt (oldest first) for stable ordering
  const sorted = [...trackerConnections].sort(
    (a, b) => new Date(a.connectedAt).getTime() - new Date(b.connectedAt).getTime()
  );
  const connectedTrackers = sorted.filter((t) => t.connected);
  const disconnectedTrackers = sorted.filter((t) => !t.connected);
  const showConnectLink = true;

  return (
    <>
      {/* No trackers connected — just show + Connect */}
      {connectedTrackers.length === 0 && disconnectedTrackers.length === 0 && (
        <div className="workspace-sidebar__workspace-item">
          <Link
            href={`/projects/${projectSlug}/tracking/connect`}
            onClick={onLinkClick}
            className={`workspace-sidebar__nav-item ${isTrackingActive ? "workspace-sidebar__nav-item--active" : ""}`}
          >
            <Plus size={14} className="flex-shrink-0 text-[var(--muted-foreground)]" />
            <span className="workspace-sidebar__workspace-title text-sm text-[var(--muted-foreground)]">Connect Tracker</span>
          </Link>
        </div>
      )}

      {/* Connected trackers — one entry per tracker */}
      {connectedTrackers.map((tracker) => {
        const isActive = isTrackingActive && activeTrackerType === tracker.type;
        return (
          <div key={tracker.type} className="workspace-sidebar__workspace-item">
            <Link
              href={`/projects/${projectSlug}/tracking/${tracker.type}`}
              onClick={onLinkClick}
              className={`workspace-sidebar__nav-item ${isActive ? "workspace-sidebar__nav-item--active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              <TrackerIcon trackerType={tracker.type} className="flex-shrink-0 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <span className="workspace-sidebar__workspace-title text-sm">{getTrackerLabel(tracker.type)}</span>
            </Link>
          </div>
        );
      })}

      {/* Disconnected trackers (auth expired) — show with warning */}
      {disconnectedTrackers.map((tracker) => (
        <div key={tracker.type} className="workspace-sidebar__workspace-item">
          <Link
            href={`/projects/${projectSlug}/tracking/${tracker.type}`}
            onClick={onLinkClick}
            className="workspace-sidebar__nav-item"
          >
            <TrackerIcon trackerType={tracker.type} className="flex-shrink-0 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <span className="workspace-sidebar__workspace-title text-sm">{getTrackerLabel(tracker.type)}</span>
            <span className="ml-auto shrink-0" title="Connection issue — click to reconnect">
              <AlertTriangle size={12} className="text-yellow-500" />
            </span>
          </Link>
        </div>
      ))}

      {/* + Connect — shown when 0 or 2+ trackers connected */}
      {showConnectLink && (connectedTrackers.length > 0 || disconnectedTrackers.length > 0) && (
        <div className="workspace-sidebar__workspace-item">
          <Link
            href={`/projects/${projectSlug}/tracking/connect`}
            onClick={onLinkClick}
            className="workspace-sidebar__nav-item"
          >
            <Plus size={14} className="flex-shrink-0 text-[var(--muted-foreground)]" />
            <span className="workspace-sidebar__workspace-title text-sm text-[var(--muted-foreground)]">Connect</span>
          </Link>
        </div>
      )}
    </>
  );
}

"use client";

import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { UI_POLL_OFFLINE_CHECK_MS, UI_RECONNECT_DELAY_MS } from "@/lib/constants/timing";

interface OfflineIndicatorProps {
  /** Custom check interval in milliseconds (default: 30000) */
  checkInterval?: number;
  /** Custom endpoint to check (default: /api/health) */
  checkEndpoint?: string;
  /** Show reconnecting status when coming back online */
  showReconnecting?: boolean;
}

/**
 * Offline indicator that shows when the app loses connection to the backend.
 * Displays a subtle banner at the top of the screen.
 */
export function OfflineIndicator({
  checkInterval = UI_POLL_OFFLINE_CHECK_MS,
  checkEndpoint = "/api/health",
  showReconnecting = true,
}: OfflineIndicatorProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastOnlineTime, setLastOnlineTime] = useState<Date | null>(null);

  useEffect(() => {
    let checkTimer: NodeJS.Timeout;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = UI_RECONNECT_DELAY_MS;

    const checkConnection = async () => {
      try {
        const response = await fetch(checkEndpoint, {
          method: "HEAD",
          cache: "no-store",
        });

        if (response.ok) {
          setIsOnline(true);
          setIsReconnecting(false);
          setLastOnlineTime(new Date());
          reconnectAttempts = 0;
        } else {
          setIsOnline(false);
        }
      } catch {
        setIsOnline(false);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastOnlineTime(new Date());
    };

    const handleOnline = () => {
      setIsReconnecting(true);
      checkConnection();
    };

    // Listen for browser online/offline events
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    // Periodic health checks
    checkTimer = setInterval(checkConnection, checkInterval);

    // Initial check
    checkConnection();

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearInterval(checkTimer);
    };
  }, [checkEndpoint, checkInterval]);

  // Don't render anything when online
  if (isOnline && !isReconnecting) {
    return null;
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium animate-fade-in-down"
      style={{
        background: isOnline
          ? "var(--success-muted)"
          : "var(--destructive-muted)",
        color: isOnline ? "var(--success)" : "var(--destructive)",
        borderBottom: `1px solid ${isOnline ? "var(--status-completed-border)" : "var(--status-failed-border)"}`,
      }}
    >
      {isOnline ? (
        <>
          <Wifi size={14} />
          <span>Reconnected</span>
        </>
      ) : (
        <>
          <WifiOff size={14} />
          <span>Offline</span>
          {lastOnlineTime && (
            <span className="opacity-70">
              — Last synced {formatTimeAgo(lastOnlineTime)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Add the animation keyframe to globals.css or inline
const styles = `
@keyframes fade-in-down {
  from {
    opacity: 0;
    transform: translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;

// Inject styles if not already present
if (typeof document !== "undefined") {
  const styleId = "offline-indicator-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = styles;
    document.head.appendChild(style);
  }
}
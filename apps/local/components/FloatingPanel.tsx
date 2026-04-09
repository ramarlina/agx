"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { loadFloatingPanelBounds, persistFloatingPanelBounds, type FloatingPanelBounds } from "@/state/floatingPanels";

interface FloatingPanelProps {
  panelId: string;
  titleBar: React.ReactNode;
  children: React.ReactNode;
  defaultBounds: FloatingPanelBounds;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  bodyClassName?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getViewportBounds() {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function normalizeBounds(
  bounds: FloatingPanelBounds,
  minWidth: number,
  minHeight: number,
): FloatingPanelBounds {
  const viewport = getViewportBounds();
  const maxWidth = Math.max(minWidth, viewport.width - 16);
  const maxHeight = Math.max(minHeight, viewport.height - 16);
  const width = clamp(bounds.width, minWidth, maxWidth);
  const height = clamp(bounds.height, minHeight, maxHeight);

  return {
    x: clamp(bounds.x, 8, Math.max(8, viewport.width - width - 8)),
    y: clamp(bounds.y, 8, Math.max(8, viewport.height - height - 8)),
    width,
    height,
  };
}

export default function FloatingPanel({
  panelId,
  titleBar,
  children,
  defaultBounds,
  minWidth = 320,
  minHeight = 220,
  className,
  bodyClassName,
}: FloatingPanelProps) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);

  const initialBounds = useMemo(
    () => normalizeBounds(loadFloatingPanelBounds(panelId) ?? defaultBounds, minWidth, minHeight),
    [defaultBounds, minHeight, minWidth, panelId],
  );

  const [bounds, setBounds] = useState<FloatingPanelBounds>(initialBounds);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBounds(normalizeBounds(loadFloatingPanelBounds(panelId) ?? defaultBounds, minWidth, minHeight));
    setHydrated(true);
  }, [defaultBounds, minHeight, minWidth, panelId]);

  useEffect(() => {
    if (!hydrated) return;
    persistFloatingPanelBounds(panelId, bounds);
  }, [bounds, hydrated, panelId]);

  useEffect(() => {
    const onResize = () => {
      setBounds((current) => normalizeBounds(current, minWidth, minHeight));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minHeight, minWidth]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (dragRef.current) {
        const nextBounds = normalizeBounds(
          {
            ...bounds,
            x: dragRef.current.originX + (event.clientX - dragRef.current.startX),
            y: dragRef.current.originY + (event.clientY - dragRef.current.startY),
          },
          minWidth,
          minHeight,
        );
        setBounds(nextBounds);
        return;
      }

      if (resizeRef.current) {
        const nextBounds = normalizeBounds(
          {
            ...bounds,
            width: resizeRef.current.originWidth + (event.clientX - resizeRef.current.startX),
            height: resizeRef.current.originHeight + (event.clientY - resizeRef.current.startY),
          },
          minWidth,
          minHeight,
        );
        setBounds(nextBounds);
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [bounds, minHeight, minWidth]);

  const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [data-no-panel-drag='true']")) {
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: bounds.x,
      originY: bounds.y,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  };

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originWidth: bounds.width,
      originHeight: bounds.height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
  };

  return (
    <div
      className={className}
      style={{
        position: "fixed",
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 40,
      }}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl backdrop-blur-md">
        <div
          onMouseDown={handleDragStart}
          className="cursor-grab active:cursor-grabbing border-b border-[var(--border)] bg-[var(--card-bg)]/95"
        >
          {titleBar}
        </div>
        <div className={bodyClassName}>{children}</div>
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
          aria-hidden="true"
        >
          <div className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-sm border-r-2 border-b-2 border-[var(--muted-foreground)]/50" />
        </div>
      </div>
    </div>
  );
}

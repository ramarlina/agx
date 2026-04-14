"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useInputCapabilities } from "@/hooks/useInputCapabilities";
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
  const { isTouchLayout } = useInputCapabilities();
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<FloatingPanelBounds | null>(null);

  const initialBounds = useMemo(
    () => normalizeBounds(loadFloatingPanelBounds(panelId) ?? defaultBounds, minWidth, minHeight),
    [defaultBounds, minHeight, minWidth, panelId],
  );

  const [bounds, setBounds] = useState<FloatingPanelBounds>(initialBounds);
  const [hydrated, setHydrated] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Keep boundsRef in sync for use during drag/resize
  boundsRef.current = bounds;

  useEffect(() => {
    setBounds(normalizeBounds(loadFloatingPanelBounds(panelId) ?? defaultBounds, minWidth, minHeight));
    setHydrated(true);
  }, [defaultBounds, minHeight, minWidth, panelId]);

  useEffect(() => {
    if (!hydrated) return;
    persistFloatingPanelBounds(panelId, bounds);
  }, [bounds, hydrated, panelId]);

  useEffect(() => {
    if (isTouchLayout) {
      return;
    }

    const onResize = () => {
      setBounds((current) => normalizeBounds(current, minWidth, minHeight));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isTouchLayout, minHeight, minWidth]);

  // Attach drag/resize listeners only when actively dragging — no dependency on bounds
  useEffect(() => {
    if (isTouchLayout || !isDragging) {
      return;
    }

    const applyBoundsToDOM = (b: FloatingPanelBounds) => {
      const el = panelRef.current;
      if (!el) return;
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${b.width}px`;
      el.style.height = `${b.height}px`;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (dragRef.current) {
        const current = boundsRef.current!;
        const next = normalizeBounds(
          {
            ...current,
            x: dragRef.current.originX + (event.clientX - dragRef.current.startX),
            y: dragRef.current.originY + (event.clientY - dragRef.current.startY),
          },
          minWidth,
          minHeight,
        );
        boundsRef.current = next;
        applyBoundsToDOM(next);
        return;
      }

      if (resizeRef.current) {
        const current = boundsRef.current!;
        const next = normalizeBounds(
          {
            ...current,
            width: resizeRef.current.originWidth + (event.clientX - resizeRef.current.startX),
            height: resizeRef.current.originHeight + (event.clientY - resizeRef.current.startY),
          },
          minWidth,
          minHeight,
        );
        boundsRef.current = next;
        applyBoundsToDOM(next);
      }
    };

    const onMouseUp = () => {
      // Commit final position to React state (single re-render)
      if (boundsRef.current) {
        setBounds(boundsRef.current);
      }
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setIsDragging(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, isTouchLayout, minHeight, minWidth]);

  const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchLayout) {
      return;
    }

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
    setIsDragging(true);
  };

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchLayout) {
      return;
    }

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
    setIsDragging(true);
  };

  return (
    <div
      ref={panelRef}
      className={className}
      style={{
        position: "fixed",
        left: isTouchLayout ? "50%" : bounds.x,
        right: isTouchLayout ? "auto" : undefined,
        top: isTouchLayout ? "max(16px, 8vh)" : bounds.y,
        width: isTouchLayout ? `min(${Math.max(bounds.width, minWidth)}px, calc(100vw - 32px))` : bounds.width,
        height: isTouchLayout ? `min(${Math.max(bounds.height, minHeight)}px, calc(100vh - 48px))` : bounds.height,
        transform: isTouchLayout ? "translateX(-50%)" : undefined,
        zIndex: 40,
      }}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-2xl backdrop-blur-md">
        <div
          onMouseDown={handleDragStart}
          className={`${isTouchLayout ? "cursor-default" : "cursor-grab active:cursor-grabbing"} border-b border-[var(--border)] bg-[var(--card-bg)]/95`}
        >
          {titleBar}
        </div>
        <div className={bodyClassName}>{children}</div>
        {!isTouchLayout ? (
          <div
            onMouseDown={handleResizeStart}
            className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
            aria-hidden="true"
          >
            <div className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-sm border-r-2 border-b-2 border-[var(--muted-foreground)]/50" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

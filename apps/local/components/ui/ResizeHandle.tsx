"use client";

import React, { useCallback, useRef } from "react";

export function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const lastX = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onResizeRef.current(delta);
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      className="group relative z-10 w-0 shrink-0 cursor-col-resize"
      onMouseDown={handleMouseDown}
    >
      <div className="absolute inset-y-0 -left-1 w-2 transition-colors group-hover:bg-[var(--primary)]/40" />
    </div>
  );
}

"use client";

import React, { useEffect, useRef } from "react";

interface NoteStickerProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: (value: string) => void;
}

export function NoteSticker({ value, onChange, onClose, onSave }: NoteStickerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onSave(value);
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSave(value);
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [value, onClose, onSave]);

  return (
    <div
      ref={containerRef}
      className="absolute left-4 z-50 mt-0.5 w-72 rounded-lg border border-amber-400/30 bg-amber-50/95 shadow-lg backdrop-blur-sm dark:bg-amber-950/90 dark:border-amber-500/30"
      style={{ top: "100%" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="h-2 w-full rounded-t-lg bg-amber-400/60 dark:bg-amber-600/60" />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          onSave(value);
          onClose();
        }}
        placeholder="Add a note…"
        rows={4}
        className="w-full resize-none rounded-b-lg bg-transparent px-3 py-2 text-xs text-amber-900 placeholder-amber-400 outline-none dark:text-amber-100 dark:placeholder-amber-600"
      />
    </div>
  );
}

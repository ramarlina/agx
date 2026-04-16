'use client';

import React, { useEffect, useRef } from 'react';

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
      if (e.key === 'Escape') {
        onSave(value);
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [value, onClose, onSave]);

  return (
    <div
      ref={containerRef}
      className='absolute left-1/2 top-full z-50 mt-1 w-72 -translate-x-1/2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl backdrop-blur-md'
      onClick={(e) => e.stopPropagation()}
    >
      <div className='h-1.5 w-full rounded-t-lg bg-[var(--primary)]/40' />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          onSave(value);
          onClose();
        }}
        placeholder='Add a note…'
        rows={5}
        className='w-full resize-none rounded-b-lg bg-transparent px-3 py-2.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/50 outline-none'
      />
    </div>
  );
}

"use client";

import React from "react";
import { X } from "lucide-react";

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21] as const;

interface FibonacciPickerProps {
  value?: number | null;
  onSelect: (value: number | null) => void;
}

export function FibonacciPicker({ value, onSelect }: FibonacciPickerProps) {
  return (
    <div className="flex items-center gap-1">
      {FIBONACCI.map((n) => (
        <button
          key={n}
          type="button"
          className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition-colors ${
            value === n
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--background)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
          }`}
          onClick={() => onSelect(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
        onClick={() => onSelect(null)}
        title="Clear estimate"
      >
        <X size={10} />
        Clear
      </button>
    </div>
  );
}

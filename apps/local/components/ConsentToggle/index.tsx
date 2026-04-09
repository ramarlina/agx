"use client";

import React from "react";

export interface ConsentToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const ConsentToggle: React.FC<ConsentToggleProps> = ({
  id = "home-search-consent",
  checked,
  onChange,
  disabled = false,
}) => {
  const descId = `${id}-desc`;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="flex items-start gap-3 cursor-pointer select-none"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={descId}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 cursor-pointer"
        />
        <span className="text-sm font-medium text-[var(--foreground)]">
          Allow home directory search
        </span>
      </label>
      <p
        id={descId}
        className="ml-7 text-xs text-[var(--muted-foreground)] leading-relaxed"
      >
        When enabled, file suggestions may include files from your home
        directory&nbsp;(~). Only files matching your configured workspace roots
        are searched by default. Home search scans a broader set of
        directories and may surface personal files — enable only if you intend
        to reference files outside your workspace roots.
      </p>
    </div>
  );
};

export default ConsentToggle;

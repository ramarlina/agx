"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";

export interface ComboOption {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  disabled?: boolean;
}

export default function SearchCombo({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.meta?.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = useMemo(() => options.find((o) => o.id === value), [options, value]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
          setQuery("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        disabled={disabled}
        className="input w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        {selected ? (
          <span className="truncate">{selected.label}</span>
        ) : (
          <span className="text-[var(--muted-foreground)] truncate">{placeholder}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 min-w-full w-max max-w-[28rem] rounded-2xl overflow-hidden right-0"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <Search className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-xs text-[var(--muted-foreground)] text-center">No matches</div>
            )}
            {filtered.map((opt) => {
              const isSelected = opt.id === value;
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  disabled={opt.disabled}
                  className={`
                    w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors
                    ${opt.disabled ? "opacity-35 cursor-not-allowed" : ""}
                    ${isSelected ? "bg-[var(--primary)]/10" : "hover:bg-[var(--muted)]/40"}
                  `}
                >
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border ${
                    isSelected
                      ? "bg-[var(--primary)] border-[var(--primary)]"
                      : "border-[var(--border)]"
                  }`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{opt.label}</span>
                      {opt.meta && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--muted)]/50 text-[var(--muted-foreground)]">
                          {opt.meta}
                        </span>
                      )}
                    </div>
                    {opt.description && (
                      <p className="text-xs text-[var(--muted-foreground)] mt-0.5 line-clamp-1">{opt.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

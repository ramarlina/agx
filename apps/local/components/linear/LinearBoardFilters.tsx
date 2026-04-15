"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelectProps {
  label: string;
  value: string;
  options: FilterOption[];
  activeClasses: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export interface FilterPopdownProps extends FilterSelectProps {
  emptyLabel?: string;
}

export interface MultiFilterPopdownProps {
  label: string;
  values: string[];
  options: FilterOption[];
  activeClasses: string;
  onChange: (value: string[]) => void;
  emptyLabel?: string;
}

export function FilterSelect({
  label,
  value,
  options,
  activeClasses,
  onChange,
  disabled = false,
}: FilterSelectProps) {
  const isActive = value.trim().length > 0;

  return (
    <div className="relative">
      <select
        aria-label={label}
        className={`max-w-[160px] appearance-none rounded-full border bg-transparent px-2.5 py-0.5 pr-6 text-[11px] font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${label}-${option.value || "all"}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-current"
      />
    </div>
  );
}

export function IssueStatusSelect({
  status,
  options,
  onChange,
  disabled = false,
  updating = false,
}: {
  status: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  updating?: boolean;
}) {
  return (
    <div className="relative">
      <select
        aria-label="Ticket status"
        className="max-w-[160px] appearance-none rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1 pr-8 text-xs font-medium text-[var(--foreground)] outline-none transition-colors hover:border-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        value={status}
        disabled={disabled || updating}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`ticket-status-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {updating ? (
        <RefreshCw
          size={12}
          className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 animate-spin text-[var(--muted-foreground)]"
        />
      ) : null}
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
      />
    </div>
  );
}

export function FilterPopdown({
  label,
  value,
  options,
  activeClasses,
  onChange,
  emptyLabel,
}: FilterPopdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const isActive = value.trim().length > 0;
  const buttonLabel = selectedOption?.label ?? emptyLabel ?? label;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [value]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[180px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="max-w-[132px] truncate">{buttonLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-lg backdrop-blur-sm"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={`${label}-${option.value || "all"}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => onChange(option.value)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-[var(--card-border)]"
                  }`}
                >
                  {isSelected ? <Check size={10} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function MultiFilterPopdown({
  label,
  values,
  options,
  activeClasses,
  onChange,
  emptyLabel,
}: MultiFilterPopdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selectedOptions = options.filter(
    (option) => option.value && values.includes(option.value)
  );
  const isActive = selectedOptions.length > 0;
  const buttonLabel = (() => {
    if (selectedOptions.length === 0) {
      return emptyLabel ?? label;
    }
    if (selectedOptions.length === options.length) {
      return emptyLabel ?? label;
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0]?.label ?? (emptyLabel ?? label);
    }
    const lowerLabel = label.toLowerCase();
    return `${selectedOptions.length} ${lowerLabel}${lowerLabel.endsWith("s") ? "es" : "s"}`;
  })();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const toggleValue = useCallback(
    (nextValue: string) => {
      if (!nextValue) {
        onChange([]);
        return;
      }

      const nextValues = values.includes(nextValue)
        ? values.filter((value) => value !== nextValue)
        : [...values, nextValue];
      onChange(nextValues);
    },
    [onChange, values]
  );

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-[180px] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
          isActive
            ? activeClasses
            : "border-[var(--card-border)] text-[var(--muted-foreground)] hover:bg-[var(--card-bg)]"
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="max-w-[132px] truncate">{buttonLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`${label} options`}
          aria-multiselectable="true"
          className="absolute left-0 top-full z-50 mt-1 min-w-[240px] overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-lg backdrop-blur-sm"
        >
          <button
            type="button"
            role="option"
            aria-selected={!isActive}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
              !isActive
                ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => onChange([])}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                !isActive
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-[var(--card-border)]"
              }`}
            >
              {!isActive ? <Check size={10} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{emptyLabel ?? label}</span>
          </button>
          {selectedOptions.length > 0 ? (
            <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              Selected
            </div>
          ) : null}
          {options.filter((option) => option.value).map((option) => {
            const isSelected = values.includes(option.value);
            return (
              <button
                key={`${label}-${option.value}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-[var(--background)] font-medium text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                }`}
                onClick={() => toggleValue(option.value)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-[var(--card-border)]"
                  }`}
                >
                  {isSelected ? <Check size={10} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

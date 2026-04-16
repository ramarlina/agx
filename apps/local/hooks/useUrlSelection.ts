"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type UrlSelectionValue = string | null | undefined;
export type UrlSelectionUpdates = Record<string, UrlSelectionValue>;
type SelectionSearchParamsLike = {
  get(name: string): string | null;
  toString(): string;
};

function normalizeSelectionValue(value: UrlSelectionValue): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function readUrlSelectionValue(
  searchParams: Pick<SelectionSearchParamsLike, "get">,
  key: string,
): string | null {
  const value = searchParams.get(key)?.trim() ?? "";
  return value || null;
}

function applySelectionResetRules(
  searchParams: SelectionSearchParamsLike,
  updates: UrlSelectionUpdates,
): UrlSelectionUpdates {
  const nextUpdates: UrlSelectionUpdates = { ...updates };
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(updates, key);

  if (hasOwn("issue") && !hasOwn("run")) {
    const currentIssue = readUrlSelectionValue(searchParams, "issue");
    const nextIssue = normalizeSelectionValue(updates.issue);
    if (nextIssue !== currentIssue) {
      nextUpdates.run = null;
    }
  }

  if (hasOwn("job") && !hasOwn("run")) {
    const currentJob = readUrlSelectionValue(searchParams, "job");
    const nextJob = normalizeSelectionValue(updates.job);
    if (nextJob !== currentJob) {
      nextUpdates.run = null;
    }
  }

  if (hasOwn("open") && !hasOwn("message")) {
    const currentOpen = readUrlSelectionValue(searchParams, "open");
    const nextOpen = normalizeSelectionValue(updates.open);
    if (nextOpen !== currentOpen) {
      nextUpdates.message = null;
    }
  }

  // Selecting a group clears issue and run selections
  if (hasOwn("group") && !hasOwn("issue")) {
    const currentGroup = readUrlSelectionValue(searchParams, "group");
    const nextGroup = normalizeSelectionValue(updates.group);
    if (nextGroup !== currentGroup) {
      nextUpdates.issue = null;
      nextUpdates.run = null;
    }
  }

  // Selecting an issue clears group selection
  if (hasOwn("issue") && !hasOwn("group")) {
    const currentIssue = readUrlSelectionValue(searchParams, "issue");
    const nextIssue = normalizeSelectionValue(updates.issue);
    if (nextIssue !== currentIssue) {
      nextUpdates.group = null;
    }
  }

  return nextUpdates;
}

export function buildSelectionHref(
  pathname: string,
  searchParams: SelectionSearchParamsLike,
  updates: UrlSelectionUpdates,
): string {
  const normalizedUpdates = applySelectionResetRules(searchParams, updates);
  const nextParams = new URLSearchParams(searchParams.toString());

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    const normalizedValue = normalizeSelectionValue(value);
    if (!normalizedValue) {
      nextParams.delete(key);
    } else {
      nextParams.set(key, normalizedValue);
    }
  }

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function useUrlSelection() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getSelection = useCallback(
    (key: string) => readUrlSelectionValue(searchParams, key),
    [searchParams],
  );

  const buildHref = useCallback(
    (updates: UrlSelectionUpdates, nextPathname?: string) =>
      buildSelectionHref(nextPathname ?? pathname, searchParams, updates),
    [pathname, searchParams],
  );

  const pushSelection = useCallback(
    (updates: UrlSelectionUpdates, nextPathname?: string) => {
      router.push(buildHref(updates, nextPathname));
    },
    [buildHref, router],
  );

  const replaceSelection = useCallback(
    (updates: UrlSelectionUpdates, nextPathname?: string) => {
      router.replace(buildHref(updates, nextPathname));
    },
    [buildHref, router],
  );

  return {
    pathname,
    searchParams,
    getSelection,
    buildHref,
    pushSelection,
    replaceSelection,
  };
}

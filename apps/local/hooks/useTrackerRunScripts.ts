"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadTrackerRunScripts,
  persistTrackerRunScripts,
  type TrackerRunScript,
} from "@/state/trackerRunScripts";

interface SaveTrackerRunScriptInput {
  id?: string;
  name: string;
  prompt: string;
}

function buildTimestamp(): string {
  return new Date().toISOString();
}

function sortScripts(scripts: TrackerRunScript[]): TrackerRunScript[] {
  return [...scripts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function useTrackerRunScripts(trackerType: string, projectSlug?: string | null) {
  const [scripts, setScripts] = useState<TrackerRunScript[]>([]);
  const [activeScriptId, setActiveScriptIdState] = useState<string | null>(null);

  useEffect(() => {
    const state = loadTrackerRunScripts(trackerType, projectSlug);
    setScripts(state.scripts);
    setActiveScriptIdState(state.activeScriptId);
  }, [trackerType, projectSlug]);

  const persistState = useCallback(
    (nextScripts: TrackerRunScript[], nextActiveScriptId: string | null) => {
      setScripts(nextScripts);
      setActiveScriptIdState(nextActiveScriptId);
      persistTrackerRunScripts(trackerType, projectSlug, {
        scripts: nextScripts,
        activeScriptId: nextActiveScriptId,
      });
    },
    [trackerType, projectSlug]
  );

  const setActiveScriptId = useCallback(
    (nextActiveScriptId: string | null) => {
      const normalizedId =
        nextActiveScriptId && scripts.some((script) => script.id === nextActiveScriptId)
          ? nextActiveScriptId
          : null;
      persistState(scripts, normalizedId);
    },
    [persistState, scripts]
  );

  const saveScript = useCallback(
    (input: SaveTrackerRunScriptInput): TrackerRunScript => {
      const now = buildTimestamp();
      const name = input.name.trim();
      const prompt = input.prompt.trim();
      if (!name || !prompt) {
        throw new Error("Run script name and prompt are required.");
      }

      const existing = input.id ? scripts.find((script) => script.id === input.id) : null;
      const nextScript: TrackerRunScript = existing
        ? {
            ...existing,
            name,
            prompt,
            updatedAt: now,
          }
        : {
            id: crypto.randomUUID(),
            name,
            prompt,
            createdAt: now,
            updatedAt: now,
          };

      const nextScripts = sortScripts(
        existing
          ? scripts.map((script) => (script.id === existing.id ? nextScript : script))
          : [nextScript, ...scripts]
      );
      persistState(nextScripts, nextScript.id);
      return nextScript;
    },
    [persistState, scripts]
  );

  const deleteScript = useCallback(
    (scriptId: string) => {
      const nextScripts = scripts.filter((script) => script.id !== scriptId);
      const nextActiveScriptId = activeScriptId === scriptId ? null : activeScriptId;
      persistState(nextScripts, nextActiveScriptId);
    },
    [activeScriptId, persistState, scripts]
  );

  const activeScript = useMemo(
    () => scripts.find((script) => script.id === activeScriptId) ?? null,
    [activeScriptId, scripts]
  );

  return {
    scripts,
    activeScriptId,
    activeScript,
    setActiveScriptId,
    saveScript,
    deleteScript,
  };
}

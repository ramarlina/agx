"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadLinearRunScripts,
  persistLinearRunScripts,
  type LinearRunScript,
} from "@/state/linearRunScripts";

interface SaveLinearRunScriptInput {
  id?: string;
  name: string;
  prompt: string;
}

function buildTimestamp(): string {
  return new Date().toISOString();
}

function sortScripts(scripts: LinearRunScript[]): LinearRunScript[] {
  return [...scripts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function useLinearRunScripts(projectSlug?: string | null) {
  const [scripts, setScripts] = useState<LinearRunScript[]>([]);
  const [activeScriptId, setActiveScriptIdState] = useState<string | null>(null);

  useEffect(() => {
    const state = loadLinearRunScripts(projectSlug);
    setScripts(state.scripts);
    setActiveScriptIdState(state.activeScriptId);
  }, [projectSlug]);

  const persistState = useCallback(
    (nextScripts: LinearRunScript[], nextActiveScriptId: string | null) => {
      setScripts(nextScripts);
      setActiveScriptIdState(nextActiveScriptId);
      persistLinearRunScripts(projectSlug, {
        scripts: nextScripts,
        activeScriptId: nextActiveScriptId,
      });
    },
    [projectSlug]
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
    (input: SaveLinearRunScriptInput): LinearRunScript => {
      const now = buildTimestamp();
      const name = input.name.trim();
      const prompt = input.prompt.trim();
      if (!name || !prompt) {
        throw new Error("Run script name and prompt are required.");
      }

      const existing = input.id ? scripts.find((script) => script.id === input.id) : null;
      const nextScript: LinearRunScript = existing
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

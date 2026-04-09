"use client";

import { useCallback, useEffect, useState } from "react";

// ── Project Skills ──────────────────────────────────────────────────────────

export interface ProjectSkillEntry {
  id: string;
  project_id: string;
  file: string;
  condition?: string;
  created_at: string;
}

export function useProjectSkills(projectId: string | null) {
  const [skills, setSkills] = useState<ProjectSkillEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    if (!projectId) { setSkills([]); setIsLoading(false); return; }
    try {
      const res = await fetch(`/api/projects/${projectId}/skills`);
      if (!res.ok) return;
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch { /* silent */ } finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void fetchSkills(); }, [fetchSkills]);

  const addSkill = useCallback(async (file: string, condition?: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, condition }),
      });
      if (res.ok) await fetchSkills();
    } catch { /* silent */ }
  }, [projectId, fetchSkills]);

  const removeSkill = useCallback(async (skillId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/skills?skillId=${skillId}`, { method: "DELETE" });
      if (res.ok) setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch { /* silent */ }
  }, [projectId]);

  return { skills, isLoading, addSkill, removeSkill, refresh: fetchSkills };
}

// ── Project Variables ───────────────────────────────────────────────────────

export interface ProjectVariableEntry {
  project_id: string;
  key: string;
  value: string;
}

export function useProjectVariables(projectId: string | null) {
  const [variables, setVariables] = useState<ProjectVariableEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchVariables = useCallback(async () => {
    if (!projectId) { setVariables([]); setIsLoading(false); return; }
    try {
      const res = await fetch(`/api/projects/${projectId}/variables`);
      if (!res.ok) return;
      const data = await res.json();
      setVariables(data.variables ?? []);
    } catch { /* silent */ } finally { setIsLoading(false); }
  }, [projectId]);

  useEffect(() => { void fetchVariables(); }, [fetchVariables]);

  const setVariable = useCallback(async (key: string, value: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/variables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) await fetchVariables();
    } catch { /* silent */ }
  }, [projectId, fetchVariables]);

  const deleteVariable = useCallback(async (key: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/variables?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (res.ok) setVariables((prev) => prev.filter((v) => v.key !== key));
    } catch { /* silent */ }
  }, [projectId]);

  return { variables, isLoading, setVariable, deleteVariable, refresh: fetchVariables };
}

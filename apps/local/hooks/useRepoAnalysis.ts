// hooks/useRepoAnalysis.ts
"use client";

import { useEffect, useState } from "react";

export interface RepoAnalysis {
  isGit: boolean;
  branch?: string;
  status?: { modified: number; untracked: number; staged: number };
  languages: Record<string, number>;
}

export function useRepoAnalysis(folderPath: string | null) {
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!folderPath) { setAnalysis(null); return; }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/filesystem/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath }),
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setAnalysis(data.analysis);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [folderPath]);

  return { analysis, loading };
}

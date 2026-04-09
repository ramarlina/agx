import { useEffect, useMemo, useState } from "react";

type Provider = { id: string; label: string };

const FALLBACK: Provider[] = [
  { id: "gemini", label: "Gemini" },
  { id: "claude", label: "Claude" },
  { id: "ollama", label: "Ollama" },
  { id: "codex", label: "Codex" },
  { id: "zai", label: "Z.AI" },
];

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/providers");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const list = Array.isArray(data?.providers) ? data.providers : [];
        const normalized = list
          .filter((p: any) => p && typeof p.id === "string" && typeof p.label === "string")
          .map((p: any) => ({ id: p.id, label: p.label }));
        if (!cancelled && normalized.length > 0) setProviders(normalized);
      } catch {
        // Non-fatal: fall back to full list.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const providerIds = useMemo(() => providers.map((p) => p.id), [providers]);

  return { providers, providerIds, loading };
}


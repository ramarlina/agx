// app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const projects = Array.isArray(data?.projects) ? data.projects : [];
          if (projects.length === 0) {
            router.replace("/setup");
          } else {
            router.replace(`/projects/${projects[0].slug}`);
          }
          return;
        }
      } catch { /* fall through */ }
      if (!cancelled) {
        router.replace("/setup");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (!checking) return null;

  return (
    <div className="h-screen w-full flex items-center justify-center bg-[var(--background)]">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--muted-foreground)]" />
    </div>
  );
}

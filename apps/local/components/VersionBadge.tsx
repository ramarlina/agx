'use client';

import { useEffect, useState } from 'react';

export default function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.cliVersion) setVersion(data.cliVersion);
      })
      .catch((err) => console.error("[version] failed to fetch status:", err));
  }, []);

  if (!version) return null;

  return (
    <div className="fixed bottom-2 right-2 text-[10px] text-[var(--foreground)] opacity-30 hover:opacity-70 transition-opacity pointer-events-none select-none z-50">
      agx {version}
    </div>
  );
}

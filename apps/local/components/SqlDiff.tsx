'use client';

import { useState } from 'react';

interface SqlDiffProps {
  pgSql: string;
  sqliteSql: string;
}

export function SqlDiff({ pgSql, sqliteSql }: SqlDiffProps) {
  const [view, setView] = useState<'side' | 'inline'>('side');

  return (
    <div className="rounded-lg border overflow-hidden" role="region" aria-label="SQL comparison" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs" role="tablist" aria-label="View mode" style={{ background: 'var(--muted)' }}>
        <button
          role="tab"
          aria-selected={view === 'side'}
          onClick={() => setView('side')}
          className="px-2 py-0.5 rounded"
          style={{
            background: view === 'side' ? 'var(--primary)' : 'transparent',
            color: view === 'side' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Side by Side
        </button>
        <button
          role="tab"
          aria-selected={view === 'inline'}
          onClick={() => setView('inline')}
          className="px-2 py-0.5 rounded"
          style={{
            background: view === 'inline' ? 'var(--primary)' : 'transparent',
            color: view === 'inline' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          Inline
        </button>
      </div>
      {view === 'side' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x" role="tabpanel" style={{ borderColor: 'var(--border)' }}>
          <SqlBlock label="PostgreSQL" sql={pgSql} variant="remove" />
          <SqlBlock label="SQLite" sql={sqliteSql} variant="add" />
        </div>
      ) : (
        <div className="p-3 font-mono text-xs space-y-1" role="tabpanel" style={{ background: 'var(--card-bg)' }}>
          {pgSql.split('\n').map((line, i) => (
            <div key={`r-${i}`} className="px-2 py-0.5 rounded" aria-label={`Removed: ${line}`} style={{ background: 'var(--destructive-muted)', color: 'var(--destructive)' }}>
              - {line}
            </div>
          ))}
          {sqliteSql.split('\n').map((line, i) => (
            <div key={`a-${i}`} className="px-2 py-0.5 rounded" aria-label={`Added: ${line}`} style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
              + {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SqlBlock({ label, sql, variant }: { label: string; sql: string; variant: 'add' | 'remove' }) {
  const bg = variant === 'remove' ? 'var(--destructive-muted)' : 'var(--success-muted)';
  return (
    <div>
      <div className="px-3 py-1 text-xs font-medium" style={{ color: 'var(--muted-foreground)', background: 'var(--muted)' }}>
        {label}
      </div>
      <pre className="p-3 text-xs overflow-x-auto whitespace-pre-wrap" style={{ background: bg, margin: 0 }}>
        {sql}
      </pre>
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback, useRef, Fragment, type KeyboardEvent } from 'react';
import { SqlDiff } from './SqlDiff';

// --- Data Types ---

type PatternStatus = 'rewritten' | 'partial' | 'unsupported';
type PatternCategory = 'query' | 'json' | 'procedure' | 'type' | 'error-code' | 'idempotency';

interface CompatibilityEntry {
  pattern: string;
  category: PatternCategory;
  status: PatternStatus;
  pgSql: string;
  sqliteSql: string;
  notes: string;
}

// --- Compatibility Data ---

const MATRIX_DATA: CompatibilityEntry[] = [
  // Query patterns
  {
    pattern: 'ILIKE (case-insensitive match)',
    category: 'query',
    status: 'rewritten',
    pgSql: `SELECT * FROM tasks\nWHERE title ILIKE '%search%';`,
    sqliteSql: `SELECT * FROM tasks\nWHERE title LIKE '%search%' COLLATE NOCASE;`,
    notes: 'SQLite LIKE is case-insensitive for ASCII by default; COLLATE NOCASE makes it explicit.',
  },
  {
    pattern: 'RETURNING clause (INSERT)',
    category: 'query',
    status: 'rewritten',
    pgSql: `INSERT INTO tasks (title, status)\nVALUES ('New', 'queued')\nRETURNING id, created_at;`,
    sqliteSql: `INSERT INTO tasks (title, status)\nVALUES ('New', 'queued');\n\nSELECT id, created_at FROM tasks\nWHERE rowid = last_insert_rowid();`,
    notes: 'SQLite 3.35+ supports RETURNING. For older versions, use last_insert_rowid().',
  },
  {
    pattern: 'RETURNING clause (UPDATE)',
    category: 'query',
    status: 'rewritten',
    pgSql: `UPDATE tasks SET status = 'done'\nWHERE id = $1\nRETURNING *;`,
    sqliteSql: `UPDATE tasks SET status = 'done'\nWHERE id = ?;\n\nSELECT * FROM tasks WHERE id = ?;`,
    notes: 'Wrap in a transaction for atomicity. SQLite 3.35+ supports RETURNING natively.',
  },
  {
    pattern: 'RETURNING clause (DELETE)',
    category: 'query',
    status: 'rewritten',
    pgSql: `DELETE FROM tasks\nWHERE status = 'expired'\nRETURNING id;`,
    sqliteSql: `-- Capture IDs first\nSELECT id FROM tasks WHERE status = 'expired';\n\nDELETE FROM tasks WHERE status = 'expired';`,
    notes: 'Must capture in transaction before delete. SQLite 3.35+ supports RETURNING.',
  },
  // JSON patterns
  {
    pattern: '@> JSON containment',
    category: 'json',
    status: 'rewritten',
    pgSql: `SELECT * FROM tasks\nWHERE metadata @> '{"priority": "high"}';`,
    sqliteSql: `SELECT * FROM tasks\nWHERE json_extract(metadata, '$.priority') = 'high';`,
    notes: 'For nested containment, use multiple json_extract calls or json_each for arrays.',
  },
  {
    pattern: 'JSON array contains value (@>)',
    category: 'json',
    status: 'rewritten',
    pgSql: `SELECT * FROM tasks\nWHERE tags @> '["urgent"]';`,
    sqliteSql: `SELECT t.* FROM tasks t\nWHERE EXISTS (\n  SELECT 1 FROM json_each(t.tags)\n  WHERE json_each.value = 'urgent'\n);`,
    notes: 'json_each() table-valued function iterates JSON array elements.',
  },
  {
    pattern: 'jsonb_set / jsonb update',
    category: 'json',
    status: 'rewritten',
    pgSql: `UPDATE tasks\nSET metadata = jsonb_set(\n  metadata, '{priority}', '"low"'\n)\nWHERE id = $1;`,
    sqliteSql: `UPDATE tasks\nSET metadata = json_set(\n  metadata, '$.priority', 'low'\n)\nWHERE id = ?;`,
    notes: 'json_set() in SQLite uses JSON path syntax ($.key) instead of PG array path.',
  },
  {
    pattern: 'jsonb_array_length',
    category: 'json',
    status: 'rewritten',
    pgSql: `SELECT * FROM tasks\nWHERE jsonb_array_length(tags) > 0;`,
    sqliteSql: `SELECT * FROM tasks\nWHERE json_array_length(tags) > 0;`,
    notes: 'Direct equivalent exists in SQLite.',
  },
  // Stored procedures
  {
    pattern: 'increment_version stored procedure',
    category: 'procedure',
    status: 'rewritten',
    pgSql: `-- Stored procedure\nCREATE FUNCTION increment_version(task_id UUID)\nRETURNS INTEGER AS $$\n  UPDATE tasks\n  SET version = version + 1\n  WHERE id = task_id\n  RETURNING version;\n$$ LANGUAGE sql;\n\nSELECT increment_version($1);`,
    sqliteSql: `-- Application-level CAS (Compare-And-Swap)\nUPDATE tasks\nSET version = version + 1\nWHERE id = ? AND version = ?;\n\n-- Check changes() = 1, else retry\nSELECT version FROM tasks WHERE id = ?;`,
    notes: 'No stored procedures in SQLite. Use application-level optimistic locking with version check.',
  },
  // Type patterns
  {
    pattern: 'UUID type',
    category: 'type',
    status: 'rewritten',
    pgSql: `CREATE TABLE tasks (\n  id UUID DEFAULT gen_random_uuid()\n);`,
    sqliteSql: `CREATE TABLE tasks (\n  id TEXT NOT NULL DEFAULT (\n    lower(hex(randomblob(4))) || '-' ||\n    lower(hex(randomblob(2))) || '-4' ||\n    substr(lower(hex(randomblob(2))),2) || '-' ||\n    substr('89ab', abs(random()) % 4 + 1, 1) ||\n    substr(lower(hex(randomblob(2))),2) || '-' ||\n    lower(hex(randomblob(6)))\n  )\n);`,
    notes: 'SQLite has no native UUID. Generate in application layer or use randomblob-based default.',
  },
  {
    pattern: 'ARRAY type (text[])',
    category: 'type',
    status: 'rewritten',
    pgSql: `CREATE TABLE tasks (\n  tags TEXT[] DEFAULT '{}'\n);\n\nSELECT * FROM tasks\nWHERE 'urgent' = ANY(tags);`,
    sqliteSql: `CREATE TABLE tasks (\n  tags TEXT DEFAULT '[]' -- JSON array\n);\n\nSELECT * FROM tasks\nWHERE EXISTS (\n  SELECT 1 FROM json_each(tags)\n  WHERE value = 'urgent'\n);`,
    notes: 'Store arrays as JSON text. Use json_each() for membership tests.',
  },
  {
    pattern: 'TIMESTAMP WITH TIME ZONE',
    category: 'type',
    status: 'rewritten',
    pgSql: `CREATE TABLE tasks (\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);`,
    sqliteSql: `CREATE TABLE tasks (\n  created_at TEXT DEFAULT (\n    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\n  )\n);`,
    notes: 'Store as ISO-8601 TEXT. Use strftime() for date arithmetic.',
  },
  {
    pattern: 'BOOLEAN type',
    category: 'type',
    status: 'rewritten',
    pgSql: `SELECT * FROM tasks WHERE is_active = TRUE;`,
    sqliteSql: `SELECT * FROM tasks WHERE is_active = 1;`,
    notes: 'SQLite uses 0/1 integers for booleans.',
  },
  // Error codes
  {
    pattern: 'Unique violation (23505)',
    category: 'error-code',
    status: 'rewritten',
    pgSql: `-- PG error code: 23505\n-- PG error class: IntegrityConstraintViolation\n-- Node pg: error.code === '23505'`,
    sqliteSql: `-- SQLite: SQLITE_CONSTRAINT_UNIQUE (2067)\n-- better-sqlite3: err.code === 'SQLITE_CONSTRAINT_UNIQUE'\n-- Check: err.message.includes('UNIQUE constraint failed')`,
    notes: 'Map PG 23505 → SQLite SQLITE_CONSTRAINT_UNIQUE (extended code 2067).',
  },
  {
    pattern: 'Foreign key violation (23503)',
    category: 'error-code',
    status: 'rewritten',
    pgSql: `-- PG error code: 23503\n-- PG error: foreign_key_violation\n-- Node pg: error.code === '23503'`,
    sqliteSql: `-- SQLite: SQLITE_CONSTRAINT_FOREIGNKEY (787)\n-- better-sqlite3: err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'\n-- Requires: PRAGMA foreign_keys = ON;`,
    notes: 'SQLite FK enforcement must be enabled per-connection with PRAGMA foreign_keys = ON.',
  },
  {
    pattern: 'Not null violation (23502)',
    category: 'error-code',
    status: 'rewritten',
    pgSql: `-- PG error code: 23502\n-- PG error: not_null_violation\n-- Node pg: error.code === '23502'`,
    sqliteSql: `-- SQLite: SQLITE_CONSTRAINT_NOTNULL (1299)\n-- better-sqlite3: err.code === 'SQLITE_CONSTRAINT_NOTNULL'`,
    notes: 'Direct mapping. Check extended error code for specificity.',
  },
  {
    pattern: 'Check constraint violation (23514)',
    category: 'error-code',
    status: 'rewritten',
    pgSql: `-- PG error code: 23514\n-- PG error: check_violation\n-- Node pg: error.code === '23514'`,
    sqliteSql: `-- SQLite: SQLITE_CONSTRAINT_CHECK (275)\n-- better-sqlite3: err.code === 'SQLITE_CONSTRAINT_CHECK'`,
    notes: 'Direct mapping between PG check violation and SQLite constraint check.',
  },
  // Idempotency patterns
  {
    pattern: 'Idempotent enqueue (ON CONFLICT)',
    category: 'idempotency',
    status: 'rewritten',
    pgSql: `INSERT INTO job_queue (id, payload, status)\nVALUES ($1, $2, 'queued')\nON CONFLICT (id) DO NOTHING\nRETURNING id;`,
    sqliteSql: `INSERT OR IGNORE INTO job_queue (id, payload, status)\nVALUES (?, ?, 'queued');\n\n-- Check if inserted or already existed\nSELECT id, status FROM job_queue WHERE id = ?;`,
    notes: 'INSERT OR IGNORE is SQLite equivalent of ON CONFLICT DO NOTHING. Check changes() for insert detection.',
  },
  {
    pattern: 'Idempotent retry (CAS update)',
    category: 'idempotency',
    status: 'rewritten',
    pgSql: `UPDATE job_queue\nSET status = 'queued',\n    retry_count = retry_count + 1,\n    updated_at = NOW()\nWHERE id = $1\n  AND status IN ('failed', 'expired')\nRETURNING *;`,
    sqliteSql: `UPDATE job_queue\nSET status = 'queued',\n    retry_count = retry_count + 1,\n    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')\nWHERE id = ?\n  AND status IN ('failed', 'expired');\n\n-- Check changes() = 1 for success\nSELECT * FROM job_queue WHERE id = ?;`,
    notes: 'Idempotent: re-running when status is already "queued" is a no-op (WHERE clause guards).',
  },
  {
    pattern: 'Crash recovery dequeue',
    category: 'idempotency',
    status: 'rewritten',
    pgSql: `-- pg-boss uses advisory locks\nSELECT * FROM job_queue\nWHERE status = 'queued'\nORDER BY created_at\nFOR UPDATE SKIP LOCKED\nLIMIT 1;`,
    sqliteSql: `-- SQLite: use application-level locking\nBEGIN IMMEDIATE;\n\nUPDATE job_queue\nSET status = 'active',\n    started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')\nWHERE id = (\n  SELECT id FROM job_queue\n  WHERE status = 'queued'\n  ORDER BY created_at\n  LIMIT 1\n);\n\nSELECT * FROM job_queue\nWHERE status = 'active'\n  AND started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');\n\nCOMMIT;`,
    notes: 'No row-level locking in SQLite. BEGIN IMMEDIATE provides write exclusion. Use timeout-based expiry for crash recovery.',
  },
  {
    pattern: 'Stale job reaping',
    category: 'idempotency',
    status: 'rewritten',
    pgSql: `UPDATE job_queue\nSET status = 'expired'\nWHERE status = 'active'\n  AND started_at < NOW() - INTERVAL '5 minutes'\nRETURNING id;`,
    sqliteSql: `UPDATE job_queue\nSET status = 'expired'\nWHERE status = 'active'\n  AND started_at < strftime(\n    '%Y-%m-%dT%H:%M:%fZ',\n    'now', '-5 minutes'\n  );\n\nSELECT id FROM job_queue\nWHERE status = 'expired'\n  AND started_at < strftime(\n    '%Y-%m-%dT%H:%M:%fZ',\n    'now', '-5 minutes'\n  );`,
    notes: 'INTERVAL syntax replaced with strftime modifier. Run periodically to recover from crashes.',
  },
];

// --- Status Badge ---

const STATUS_CONFIG: Record<PatternStatus, { label: string; bg: string; fg: string; border: string }> = {
  rewritten: { label: 'Rewritten', bg: 'var(--status-completed-bg)', fg: 'var(--status-completed)', border: 'var(--status-completed-border)' },
  partial: { label: 'Partial', bg: 'var(--warning-muted)', fg: 'var(--warning)', border: 'var(--warning)' },
  unsupported: { label: 'Unsupported', bg: 'var(--status-failed-bg)', fg: 'var(--status-failed)', border: 'var(--status-failed-border)' },
};

function StatusBadge({ status }: { status: PatternStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </span>
  );
}

// --- Category labels ---

const CATEGORY_LABELS: Record<PatternCategory, string> = {
  query: 'Query Patterns',
  json: 'JSON Operations',
  procedure: 'Stored Procedures',
  type: 'Data Types',
  'error-code': 'Error Codes',
  idempotency: 'Idempotency & Crash Recovery',
};

// --- Sorting ---

type SortKey = 'pattern' | 'category' | 'status';
type SortDir = 'asc' | 'desc';

// --- Loading Skeleton ---

function SkeletonRow() {
  return (
    <tr>
      {[...Array(4)].map((_, i) => (
        <td key={i} className="px-4 py-2.5">
          <div
            className="h-4 rounded animate-pulse"
            style={{ background: 'var(--muted)', width: i === 0 ? '60%' : i === 3 ? '80%' : '40%' }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-lg border p-4 space-y-2 animate-pulse"
      style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}
    >
      <div className="h-4 rounded" style={{ background: 'var(--muted)', width: '60%' }} />
      <div className="h-3 rounded" style={{ background: 'var(--muted)', width: '40%' }} />
      <div className="h-3 rounded" style={{ background: 'var(--muted)', width: '80%' }} />
    </div>
  );
}

export function CompatibilityMatrixSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading compatibility matrix">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-64 rounded animate-pulse" style={{ background: 'var(--muted)' }} />
          <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--muted)' }} />
        </div>
      </div>
      <div className="flex gap-3">
        {[200, 150, 120].map((w, i) => (
          <div key={i} className="h-8 rounded-lg animate-pulse" style={{ background: 'var(--muted)', width: `${w}px` }} />
        ))}
      </div>
      {/* Desktop skeleton */}
      <div className="hidden md:block rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <tbody>
            {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
          </tbody>
        </table>
      </div>
      {/* Mobile skeleton */}
      <div className="md:hidden space-y-3">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

// --- Main Component ---

export function CompatibilityMatrix({ isLoading = false }: { isLoading?: boolean }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PatternCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PatternStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('category');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const filtered = useMemo(() => {
    let items = MATRIX_DATA;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.pattern.toLowerCase().includes(q) ||
          e.pgSql.toLowerCase().includes(q) ||
          e.sqliteSql.toLowerCase().includes(q) ||
          e.notes.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') items = items.filter((e) => e.category === categoryFilter);
    if (statusFilter !== 'all') items = items.filter((e) => e.status === statusFilter);

    items = [...items].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return items;
  }, [search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  const hasActiveFilters = search !== '' || categoryFilter !== 'all' || statusFilter !== 'all';

  const resetFilters = useCallback(() => {
    setSearch('');
    setCategoryFilter('all');
    setStatusFilter('all');
  }, []);

  const counts = useMemo(() => {
    const c = { rewritten: 0, partial: 0, unsupported: 0 };
    MATRIX_DATA.forEach((e) => c[e.status]++);
    return c;
  }, []);

  const handleRowKeyDown = useCallback((e: KeyboardEvent<HTMLTableRowElement>, originalIndex: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpandedRow((prev) => (prev === originalIndex ? null : originalIndex));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = e.currentTarget.nextElementSibling as HTMLElement | null;
      // Skip expanded detail rows
      const target = next?.getAttribute('role') === 'row' ? next : next?.nextElementSibling as HTMLElement | null;
      target?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = e.currentTarget.previousElementSibling as HTMLElement | null;
      const target = prev?.getAttribute('role') === 'row' ? prev : prev?.previousElementSibling as HTMLElement | null;
      target?.focus();
    }
  }, []);

  if (isLoading) return <CompatibilityMatrixSkeleton />;

  return (
    <div className="space-y-4" role="region" aria-label="PG to SQLite Compatibility Matrix">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            PG → SQLite Compatibility Matrix
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {MATRIX_DATA.length} patterns cataloged
          </p>
        </div>
        <div className="flex gap-3 text-sm" aria-label="Pattern status summary">
          <span style={{ color: 'var(--success)' }}>● {counts.rewritten} rewritten</span>
          <span style={{ color: 'var(--warning)' }}>● {counts.partial} partial</span>
          <span style={{ color: 'var(--destructive)' }}>● {counts.unsupported} unsupported</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3" role="search" aria-label="Filter patterns">
        <input
          type="text"
          placeholder="Search patterns, SQL, or notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search patterns"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border text-sm outline-none"
          style={{
            background: 'var(--input)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
          }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as PatternCategory | 'all')}
          aria-label="Filter by category"
          className="px-3 py-1.5 rounded-lg border text-sm"
          style={{ background: 'var(--input)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PatternStatus | 'all')}
          aria-label="Filter by status"
          className="px-3 py-1.5 rounded-lg border text-sm"
          style={{ background: 'var(--input)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          <option value="all">All Statuses</option>
          <option value="rewritten">Rewritten</option>
          <option value="partial">Partial</option>
          <option value="unsupported">Unsupported</option>
        </select>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <table ref={tableRef} className="w-full text-sm" role="grid" aria-label="Compatibility patterns">
          <thead>
            <tr role="row" style={{ background: 'var(--muted)' }}>
              <th
                className="text-left px-4 py-2 cursor-pointer select-none font-medium"
                style={{ color: 'var(--muted-foreground)' }}
                onClick={() => toggleSort('pattern')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('pattern'); } }}
                tabIndex={0}
                role="columnheader"
                aria-sort={sortKey === 'pattern' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Pattern{sortIndicator('pattern')}
              </th>
              <th
                className="text-left px-4 py-2 cursor-pointer select-none font-medium"
                style={{ color: 'var(--muted-foreground)' }}
                onClick={() => toggleSort('category')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('category'); } }}
                tabIndex={0}
                role="columnheader"
                aria-sort={sortKey === 'category' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Category{sortIndicator('category')}
              </th>
              <th
                className="text-left px-4 py-2 cursor-pointer select-none font-medium"
                style={{ color: 'var(--muted-foreground)' }}
                onClick={() => toggleSort('status')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort('status'); } }}
                tabIndex={0}
                role="columnheader"
                aria-sort={sortKey === 'status' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Status{sortIndicator('status')}
              </th>
              <th className="text-left px-4 py-2 font-medium" role="columnheader" style={{ color: 'var(--muted-foreground)' }}>
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const originalIndex = MATRIX_DATA.indexOf(entry);
              const isExpanded = expandedRow === originalIndex;
              return (
                <Fragment key={originalIndex}>
                  <tr
                    role="row"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    className="cursor-pointer transition-colors"
                    style={{
                      background: isExpanded ? 'var(--primary-muted)' : 'var(--card-bg)',
                      borderBottom: `1px solid var(--border)`,
                    }}
                    onClick={() => setExpandedRow(isExpanded ? null : originalIndex)}
                    onKeyDown={(e) => handleRowKeyDown(e, originalIndex)}
                    onMouseEnter={(e) => {
                      if (!isExpanded) e.currentTarget.style.background = 'var(--item-hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isExpanded ? 'var(--primary-muted)' : 'var(--card-bg)';
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--foreground)' }}>
                      {entry.pattern}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--muted-foreground)' }}>
                      {CATEGORY_LABELS[entry.category]}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {entry.notes}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr role="row" aria-label={`SQL diff for ${entry.pattern}`}>
                      <td colSpan={4} className="px-4 py-3" style={{ background: 'var(--muted)' }}>
                        <SqlDiff pgSql={entry.pgSql} sqliteSql={entry.sqliteSql} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <div className="space-y-3" role="status">
                    <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      No patterns match your filters.
                    </p>
                    {hasActiveFilters && (
                      <button
                        onClick={resetFilters}
                        className="px-3 py-1.5 rounded-lg border text-sm transition-colors"
                        style={{
                          borderColor: 'var(--border)',
                          color: 'var(--primary)',
                          background: 'var(--card-bg)',
                        }}
                      >
                        Reset all filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-3" role="list" aria-label="Compatibility patterns">
        {filtered.map((entry) => {
          const originalIndex = MATRIX_DATA.indexOf(entry);
          const isExpanded = expandedRow === originalIndex;
          return (
            <div
              key={originalIndex}
              role="listitem"
              className="rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--card-bg)' }}
            >
              <button
                className="w-full text-left px-4 py-3 space-y-1.5"
                aria-expanded={isExpanded}
                aria-label={`${entry.pattern} - ${STATUS_CONFIG[entry.status].label}`}
                onClick={() => setExpandedRow(isExpanded ? null : originalIndex)}
                style={{ background: isExpanded ? 'var(--primary-muted)' : 'var(--card-bg)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                    {entry.pattern}
                  </span>
                  <StatusBadge status={entry.status} />
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <span>{CATEGORY_LABELS[entry.category]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="line-clamp-1">{entry.notes}</span>
                </div>
              </button>
              {isExpanded && (
                <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
                  <SqlDiff pgSql={entry.pgSql} sqliteSql={entry.sqliteSql} />
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12" role="status">
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              No patterns match your filters.
            </p>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="mt-3 px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: 'var(--border)', color: 'var(--primary)', background: 'var(--card-bg)' }}
              >
                Reset all filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


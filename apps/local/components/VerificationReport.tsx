"use client";

import { useState } from "react";

interface VerifyData {
  passed: boolean;
  rowCounts: { table: string; pg: number; sqlite: number; match: boolean }[];
  checksums: { table: string; pgChecksum: string; sqliteChecksum: string; match: boolean }[];
  fkViolations: { table: string; rowid: number; parent: string; fkid: number }[];
  jsonInvalid: { table: string; column: string; count: number }[];
  summary: {
    tablesChecked: number;
    rowCountMismatches: number;
    checksumMismatches: number;
    fkViolationCount: number;
    invalidJsonCount: number;
  };
}

interface Props {
  data: VerifyData;
}

function Badge({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        pass
          ? "bg-green-500/15 text-green-400"
          : "bg-red-500/15 text-red-400"
      }`}
    >
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

function Section({
  title,
  pass,
  count,
  children,
}: {
  title: string;
  pass: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!pass);
  return (
    <div className="border border-[var(--card-border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--card-bg)]/50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-[var(--muted-foreground)]">({count})</span>
        </div>
        <Badge pass={pass} />
      </button>
      {open && <div className="border-t border-[var(--card-border)] p-3">{children}</div>}
    </div>
  );
}

export default function VerificationReport({ data }: Props) {
  const { summary, rowCounts, checksums, fkViolations, jsonInvalid } = data;

  return (
    <div className="space-y-3">
      {/* Overall verdict */}
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold">Verification</span>
        <Badge pass={data.passed} />
      </div>

      {/* Row counts */}
      <Section
        title="Row Counts"
        pass={summary.rowCountMismatches === 0}
        count={summary.tablesChecked}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="text-[var(--muted-foreground)] text-xs">
                <th className="text-left pb-2">Table</th>
                <th className="text-right pb-2">PG</th>
                <th className="text-right pb-2">SQLite</th>
                <th className="text-right pb-2">Match</th>
              </tr>
            </thead>
            <tbody>
              {rowCounts.map((r) => (
                <tr key={r.table} className={r.match ? "" : "text-red-400"}>
                  <td className="py-1">{r.table}</td>
                  <td className="text-right tabular-nums">{r.pg.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{r.sqlite.toLocaleString()}</td>
                  <td className="text-right">{r.match ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Checksums */}
      <Section
        title="Checksums"
        pass={summary.checksumMismatches === 0}
        count={summary.tablesChecked}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="text-[var(--muted-foreground)] text-xs">
                <th className="text-left pb-2">Table</th>
                <th className="text-right pb-2">Match</th>
              </tr>
            </thead>
            <tbody>
              {checksums.map((r) => (
                <tr key={r.table} className={r.match ? "" : "text-red-400"}>
                  <td className="py-1">{r.table}</td>
                  <td className="text-right">{r.match ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* FK violations */}
      <Section
        title="Foreign Key Integrity"
        pass={summary.fkViolationCount === 0}
        count={summary.fkViolationCount}
      >
        {fkViolations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No violations</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="text-[var(--muted-foreground)] text-xs">
                  <th className="text-left pb-2">Table</th>
                  <th className="text-right pb-2">Row ID</th>
                  <th className="text-left pb-2">Parent</th>
                </tr>
              </thead>
              <tbody>
                {fkViolations.slice(0, 50).map((v, i) => (
                  <tr key={i} className="text-red-400">
                    <td className="py-1">{v.table}</td>
                    <td className="text-right tabular-nums">{v.rowid}</td>
                    <td>{v.parent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fkViolations.length > 50 && (
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                Showing 50 of {fkViolations.length} violations
              </p>
            )}
          </div>
        )}
      </Section>

      {/* JSON validity */}
      <Section
        title="JSON Validity"
        pass={summary.invalidJsonCount === 0}
        count={summary.invalidJsonCount}
      >
        {jsonInvalid.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">All JSON columns valid</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="text-[var(--muted-foreground)] text-xs">
                  <th className="text-left pb-2">Table</th>
                  <th className="text-left pb-2">Column</th>
                  <th className="text-right pb-2">Invalid</th>
                </tr>
              </thead>
              <tbody>
                {jsonInvalid.map((r, i) => (
                  <tr key={i} className="text-red-400">
                    <td className="py-1">{r.table}</td>
                    <td>{r.column}</td>
                    <td className="text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

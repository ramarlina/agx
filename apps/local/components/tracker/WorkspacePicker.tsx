"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { GitWorkspace } from "@/lib/git-workspaces";
// type-only import; runtime module is server-only.

interface Props {
  workspaces: GitWorkspace[];
  selected: { repoPath: string; ref: string } | null;
  onSelect: (sel: { repoPath: string; ref: string }) => void;
  onRescan: () => void;
  rescanning: boolean;
}

function basename(p: string): string {
  if (!p) return p;
  const cleaned = p.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function WorkspacePicker({
  workspaces,
  selected,
  onSelect,
  onRescan,
  rescanning,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<string, GitWorkspace[]>();
    for (const ws of workspaces) {
      const list = map.get(ws.repoPath) ?? [];
      list.push(ws);
      map.set(ws.repoPath, list);
    }
    return Array.from(map.entries());
  }, [workspaces]);

  const selectedLabel = useMemo(() => {
    if (!selected) return "Select workspace";
    if (selected.ref === "WORKING_TREE") {
      return `${basename(selected.repoPath)} · working tree`;
    }
    const match = workspaces.find(
      (w) => w.repoPath === selected.repoPath && w.branch === selected.ref,
    );
    if (match) {
      return `${basename(match.repoPath)} · ${match.branch}`;
    }
    return `${basename(selected.repoPath)} · ${selected.ref}`;
  }, [selected, workspaces]);

  const choose = (sel: { repoPath: string; ref: string }) => {
    onSelect(sel);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          borderRadius: 4,
          border: "1px solid var(--card-border)",
          background: "var(--card-bg)",
          color: "var(--foreground)",
          fontFamily: "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          maxWidth: 320,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 280,
          }}
        >
          {selectedLabel}
        </span>
        <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Select workspace"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 50,
            marginTop: 4,
            minWidth: 320,
            maxHeight: 420,
            overflowY: "auto",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: 4,
          }}
        >
          {grouped.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--muted-foreground)",
              }}
            >
              No matching workspaces.
            </div>
          ) : null}
          {grouped.map(([repoPath, items]) => {
            const repoName = basename(repoPath);
            const isWorkingTreeSelected =
              selected?.repoPath === repoPath && selected.ref === "WORKING_TREE";
            return (
              <div key={repoPath} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    padding: "6px 10px 4px",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--muted-foreground)",
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
                  }}
                  title={repoPath}
                >
                  {repoName}
                </div>
                <button
                  type="button"
                  role="option"
                  aria-selected={isWorkingTreeSelected}
                  onClick={() => choose({ repoPath, ref: "WORKING_TREE" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "6px 10px",
                    border: "none",
                    background: isWorkingTreeSelected
                      ? "var(--background)"
                      : "transparent",
                    color: "var(--foreground)",
                    cursor: "pointer",
                    borderRadius: 6,
                    textAlign: "left",
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    Working tree
                  </span>
                  <Chip>working tree</Chip>
                </button>
                {items.map((ws) => {
                  const isSel =
                    selected?.repoPath === ws.repoPath &&
                    selected.ref === ws.branch;
                  return (
                    <button
                      key={`${ws.repoPath}::${ws.kind}::${ws.branch}::${ws.path ?? ""}`}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() =>
                        choose({ repoPath: ws.repoPath, ref: ws.branch })
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        width: "100%",
                        padding: "6px 10px",
                        border: "none",
                        background: isSel ? "var(--background)" : "transparent",
                        color: "var(--foreground)",
                        cursor: "pointer",
                        borderRadius: 6,
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          minWidth: 0,
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            fontFamily:
                              "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
                            fontSize: 11,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 220,
                          }}
                        >
                          {ws.branch || "(detached)"}
                        </span>
                        <Chip>{ws.kind}</Chip>
                        {ws.isCurrent ? <Chip accent>current</Chip> : null}
                      </div>
                      {ws.path ? (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--muted-foreground)",
                            fontFamily:
                              "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 280,
                          }}
                          title={ws.path}
                        >
                          {basename(ws.path)}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div
            style={{
              borderTop: "1px solid var(--card-border)",
              padding: "6px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => onRescan()}
              disabled={rescanning}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "transparent",
                border: "none",
                color: "var(--muted-foreground)",
                fontSize: 11,
                cursor: rescanning ? "default" : "pointer",
              }}
            >
              <RefreshCw
                size={11}
                className={rescanning ? "animate-spin" : undefined}
              />
              Rescan ~
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        height: 16,
        borderRadius: 999,
        border: "1px solid var(--card-border)",
        background: accent ? "var(--primary)" : "transparent",
        color: accent ? "var(--primary-foreground)" : "var(--muted-foreground)",
        fontSize: 9,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily:
          "var(--font-jetbrains-mono), ui-monospace, Menlo, monospace",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}


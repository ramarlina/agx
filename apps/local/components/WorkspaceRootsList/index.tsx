import React, { useRef, useState } from "react";
import DirectoryBrowser from "@/components/DirectoryBrowser";

export interface WorkspaceRootsListProps {
  roots: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";

export const WorkspaceRootsList: React.FC<WorkspaceRootsListProps> = ({
  roots,
  onAdd,
  onRemove,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [inputVisible, setInputVisible] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const openInput = () => {
    setInputVisible(true);
    // Focus happens via autoFocus on the input
  };

  const closeInput = () => {
    setInputVisible(false);
    setInputValue("");
    setBrowsing(false);
    // Return focus to the add-folder button
    addBtnRef.current?.focus();
  };

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !roots.includes(trimmed)) {
      onAdd(trimmed);
      setInputValue("");
      setInputVisible(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") closeInput();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* List of existing roots */}
      {roots.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Configured workspace folders">
          {roots.map((root) => (
            <li
              key={root}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--app-shell-subtle)] px-3 py-2"
            >
              <span className="truncate text-sm font-mono text-[var(--foreground)]" title={root}>
                {root}
              </span>
              <button
                type="button"
                aria-label={`Remove ${root}`}
                onClick={() => onRemove(root)}
                className={`shrink-0 rounded text-xs font-medium text-[var(--muted-foreground)] hover:text-red-600 hover:bg-red-50 px-2 py-1 transition-colors ${focusRing}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {roots.length === 0 && !inputVisible && (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--app-shell-subtle)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--muted-foreground)] mb-3">No workspace folders configured.</p>
          <button
            type="button"
            onClick={openInput}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors ${focusRing}`}
          >
            Add a folder
          </button>
        </div>
      )}

      {/* Inline input row */}
      {inputVisible && (
        <div className="flex flex-col gap-2" role="group" aria-label="Add workspace folder">
          <div className="flex flex-wrap gap-2 items-center">
            <label htmlFor="workspace-root-input" className="sr-only">
              Folder path
            </label>
            <input
              ref={inputRef}
              id="workspace-root-input"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="~/Projects"
              autoFocus
              className={`flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] px-3 py-2 text-sm font-mono text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] shadow-sm ${focusRing}`}
            />
            <button
              type="button"
              onClick={() => setBrowsing(!browsing)}
              className={`rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)] transition-colors ${focusRing}`}
            >
              Browse
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className={`rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors ${focusRing}`}
            >
              Add
            </button>
            <button
              type="button"
              onClick={closeInput}
              className={`rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)] transition-colors ${focusRing}`}
            >
              Cancel
            </button>
          </div>
          {browsing && (
            <DirectoryBrowser
              initialPath={inputValue || ""}
              onSelect={(selectedPath) => {
                setInputValue(selectedPath);
                setBrowsing(false);
              }}
              onCancel={() => setBrowsing(false)}
            />
          )}
        </div>
      )}

      {/* Add another folder button (when list is non-empty and input is hidden) */}
      {roots.length > 0 && !inputVisible && (
        <button
          ref={addBtnRef}
          type="button"
          onClick={openInput}
          className={`self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--app-shell-subtle)] transition-colors ${focusRing}`}
        >
          + Add folder
        </button>
      )}
    </div>
  );
};

export default WorkspaceRootsList;

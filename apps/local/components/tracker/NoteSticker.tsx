"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, X } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

interface NoteStickerProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: (value: string) => void;
}

export function NoteSticker({ anchorRef, value, onChange, onClose, onSave }: NoteStickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute position centered below the anchor button
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 6,
      left: rect.left + window.scrollX + rect.width / 2,
    });
  }, [anchorRef]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Add a note…",
        emptyEditorClass:
          "is-editor-empty before:content-[attr(data-placeholder)] before:text-[var(--muted-foreground)]/50 before:float-left before:pointer-events-none before:h-0",
      }),
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    immediatelyRender: false,
    content: value,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[80px] px-3 py-2 text-xs text-[var(--foreground)] prose prose-sm max-w-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange((editor.storage as Record<string, any>).markdown?.getMarkdown() ?? value);
    },
  });

  useEffect(() => {
    if (!editor) return;

    const current = (editor.storage as Record<string, any>).markdown?.getMarkdown() ?? "";
    if (current !== value && !editor.isFocused) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  // Focus on mount
  useEffect(() => {
    if (editor) {
      setTimeout(() => editor.commands.focus("end"), 0);
    }
  }, [editor]);

  // Close + save on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        const md = editor
          ? (editor.storage as Record<string, any>).markdown?.getMarkdown() ?? value
          : value;
        onSave(md);
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const md = editor
          ? (editor.storage as Record<string, any>).markdown?.getMarkdown() ?? value
          : value;
        onSave(md);
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, value, anchorRef, onSave, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        transform: "translateX(-50%)",
        zIndex: 9999,
        width: 288,
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl">
        <div className="flex h-6 w-full items-center justify-end gap-0.5 rounded-t-lg bg-[var(--primary)]/40 px-1.5">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              const md = editor
                ? (editor.storage as Record<string, any>).markdown?.getMarkdown() ?? value
                : value;
              onSave(md);
              onClose();
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-[var(--foreground)]/60 hover:text-emerald-400 transition-colors"
            title="Save"
          >
            <Check size={11} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onClose();
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-[var(--foreground)]/60 hover:text-red-400 transition-colors"
            title="Discard"
          >
            <X size={11} />
          </button>
        </div>
        <EditorContent editor={editor} />
        <div className="flex justify-end px-1.5 pb-1.5">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSave("");
              onClose();
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-[var(--foreground)]/40 hover:text-red-400 transition-colors"
            title="Delete note"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <style>{`
        .ProseMirror { outline: none !important; }
      `}</style>
    </div>,
    document.body
  );
}

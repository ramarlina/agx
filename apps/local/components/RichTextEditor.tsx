"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";

interface RichTextEditorProps {
  content: string;
  editable?: boolean;
  onChange?: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
}

const MenuBar = ({ editor }: { editor: any }) => {
  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b border-[var(--card-border)] mb-2 sticky top-0 bg-[var(--card-bg)] z-10 opacity-90 backdrop-blur-sm">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("bold") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Bold"
      >
        <span className="font-bold font-serif">B</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("italic") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Italic"
      >
        <span className="italic font-serif">I</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("strike") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Strike"
      >
        <span className="line-through font-serif">S</span>
      </button>
      <div className="w-px h-4 bg-[var(--card-border)] mx-1" />
      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={!editor.can().chain().focus().toggleCode().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("code") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Code"
      >
        <span className="font-mono text-xs">{"<>"}</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("codeBlock") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Code Block"
      >
        <span className="font-mono text-xs">CB</span>
      </button>
      <div className="w-px h-4 bg-[var(--card-border)] mx-1" />
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("heading", { level: 1 }) ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="H1"
      >
        <span className="font-bold text-xs">H1</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("heading", { level: 2 }) ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="H2"
      >
        <span className="font-bold text-xs">H2</span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("heading", { level: 3 }) ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="H3"
      >
        <span className="font-bold text-xs">H3</span>
      </button>
      <div className="w-px h-4 bg-[var(--card-border)] mx-1" />
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("bulletList") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Bullet List"
      >
        <span className="text-xs">
           • List
        </span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("orderedList") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Ordered List"
      >
        <span className="text-xs">
           1. List
        </span>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-1.5 rounded hover:bg-[var(--muted)] ${
          editor.isActive("blockquote") ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
        }`}
        title="Quote"
      >
        <span className="text-xs serif italic">
           &quot;&quot;
        </span>
      </button>
    </div>
  );
};

export default function RichTextEditor({
  content,
  editable = true,
  onChange,
  onBlur,
  placeholder = "Add a description...",
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty before:content-[attr(data-placeholder)] before:text-[var(--muted-foreground)] before:float-left before:pointer-events-none before:h-0",
      }),
      Markdown.configure({
        html: false, // Don't allow HTML input/output
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    immediatelyRender: false,
    content, // Tiptap with Markdown extension can handle markdown string here
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[100px] text-[var(--foreground)]",
      },
    },
    onUpdate: ({ editor }) => {
      // Return markdown instead of HTML
      onChange?.((editor.storage as any).markdown.getMarkdown());
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  // Update editor content if content prop changes externally
  useEffect(() => {
    if (editor && content !== (editor.storage as any).markdown.getMarkdown()) {
      if (!editor.isFocused) {
        editor.commands.setContent(content);
      }
    }
  }, [content, editor]);

  return (
    <div className="relative group">
      {editable && <MenuBar editor={editor} />}
      <EditorContent editor={editor} className="rich-text-editor" />
      <style>{`
        .rich-text-editor .ProseMirror {
          min-height: 100px;
          outline: none;
        }
        .rich-text-editor .ProseMirror p {
          margin-bottom: 0.75em;
          line-height: 1.6;
        }
        .rich-text-editor .ProseMirror h1 {
          font-size: 1.5em;
          font-weight: 700;
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        .rich-text-editor .ProseMirror h2 {
          font-size: 1.25em;
          font-weight: 600;
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        .rich-text-editor .ProseMirror h3 {
          font-size: 1.1em;
          font-weight: 600;
          margin-top: 1em;
          margin-bottom: 0.5em;
        }
        .rich-text-editor .ProseMirror ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin-bottom: 0.75em;
        }
        .rich-text-editor .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin-bottom: 0.75em;
        }
        .rich-text-editor .ProseMirror blockquote {
          border-left: 3px solid var(--card-border);
          padding-left: 1em;
          font-style: italic;
          color: var(--muted-foreground);
        }
        .rich-text-editor .ProseMirror pre {
          background: var(--muted);
          padding: 0.75em;
          border-radius: var(--radius-sm);
          font-family: monospace;
          overflow-x: auto;
          margin-bottom: 0.75em;
        }
        .rich-text-editor .ProseMirror code {
          background: var(--muted);
          padding: 0.2em 0.4em;
          border-radius: var(--radius-sm);
          font-family: monospace;
          font-size: 0.85em;
        }
        .rich-text-editor .ProseMirror a {
          color: var(--primary);
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}

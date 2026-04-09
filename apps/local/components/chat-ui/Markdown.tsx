"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface Props {
  content: string;
  isUser?: boolean;
}

function isBlockCode(className?: string, children?: React.ReactNode) {
  if (className?.includes("language-")) return true;
  const text = React.Children.toArray(children).join("");
  return text.includes("\n");
}

function codeBlockClasses(isUser?: boolean) {
  return isUser
    ? "bg-[var(--card-bg)]/[0.12] rounded-lg p-3 my-3 overflow-x-auto border border-white/[0.08]"
    : "bg-black/[0.06] rounded-lg p-3 my-3 overflow-x-auto border border-black/[0.06]";
}

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
  h1: ({ children }) => (
    <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0">{children}</h3>
  ),
  code: ({ children, className }) => {
    const isBlock = isBlockCode(className, children);
    if (isBlock) {
      return (
        <code className={`text-[13px] leading-relaxed font-mono whitespace-pre ${className ?? ""}`.trim()}>{children}</code>
      );
    }
    return (
      <code className="bg-black/[0.07] rounded-md px-1.5 py-0.5 text-[13px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className={codeBlockClasses(false)}>{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-[var(--border)] pl-3 my-3 text-[var(--muted-foreground)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--border)]" />,
  a: ({ children, href }) => (
    <a href={href} className="text-blue-600 underline underline-offset-2" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--muted)]">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-[var(--border)] px-3 py-1.5 text-left text-xs font-semibold text-[var(--muted-foreground)]">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--border)] px-3 py-1.5">{children}</td>
  ),
};

const userComponents: Components = {
  ...components,
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-3 last:mb-0 space-y-1.5 marker:text-white/60">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-3 last:mb-0 space-y-1.5 marker:text-white/60">{children}</ol>
  ),
  code: ({ children, className }) => {
    const isBlock = isBlockCode(className, children);
    if (isBlock) {
      return (
        <code className={`text-[13px] leading-relaxed font-mono whitespace-pre ${className ?? ""}`.trim()}>{children}</code>
      );
    }
    return (
      <code className="bg-[var(--card-bg)]/[0.15] rounded-md px-1.5 py-0.5 text-[13px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className={codeBlockClasses(true)}>{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-white/30 pl-3 my-3 text-white/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-white/20" />,
  a: ({ children, href }) => (
    <a href={href} className="text-blue-400 underline underline-offset-2 hover:text-blue-300" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--card-bg)]/[0.08]">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-white/20 px-3 py-1.5 text-left text-xs font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-white/20 px-3 py-1.5">{children}</td>
  ),
};

type Segment =
  | { type: "text"; content: string }
  | { type: "thought"; content: string };

function parseThoughts(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(?:^|\n)Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.?\s*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    const thought = match[0]
      .replace(/^[\n]*Thinking\.\.\.\s*/, "")
      .replace(/\s*\.\.\.done thinking\.?\s*$/, "")
      .trim();
    if (thought) {
      segments.push({ type: "thought", content: thought });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}

const REACTION_TAG_RE = /\[reaction\s+[^\]]*\]/gi;

export function Markdown({ content, isUser }: Props) {
  const comps = isUser ? userComponents : components;
  // Strip any reaction protocol tags that leaked through
  const cleaned = content.replace(REACTION_TAG_RE, "").trim();
  const segments = parseThoughts(cleaned);

  // No thought blocks found — render directly
  if (segments.length === 1 && segments[0].type === "text") {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={comps}>{cleaned}</ReactMarkdown>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "thought") {
          return (
            <details
              key={i}
              className="my-2 rounded-lg bg-[var(--muted)] border border-[var(--border)]/60"
            >
              <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--muted-foreground)] transition-colors">
                Thought process
              </summary>
              <div className="px-3 pb-2.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={comps}>{seg.content}</ReactMarkdown>
              </div>
            </details>
          );
        }
        const trimmed = seg.content.trim();
        if (!trimmed) return null;
        return (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={comps}>
            {trimmed}
          </ReactMarkdown>
        );
      })}
    </>
  );
}

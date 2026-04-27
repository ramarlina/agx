"use client";

import React from "react";

const PROVIDER_DOT: Record<string, string> = {
  claude: "#c98f5b",
  codex: "#a8a293",
  gemini: "#9ab8d8",
  ollama: "#7dd97b",
};

interface Props {
  name: string;
  provider?: string;
  size?: number;
}

export function AgentChip({ name, provider = "claude", size = 18 }: Props) {
  const initials = name
    .split(/[\s-]/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      title={`${name} · ${provider}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 3,
        background: "var(--bg-inset)",
        border: "1px solid var(--line-strong)",
        color: "var(--fg)",
        fontSize: Math.round(size * 0.52),
        fontWeight: 600,
        position: "relative",
        fontFamily: "var(--font-mono)",
      }}
    >
      {initials}
      <span
        style={{
          position: "absolute",
          bottom: -2,
          right: -2,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: PROVIDER_DOT[provider] ?? "var(--fg-mute)",
          border: "1.5px solid var(--bg-card)",
        }}
      />
    </span>
  );
}

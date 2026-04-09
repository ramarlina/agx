import type { GroupMessage, Participant } from "@/lib/types";

export const DEMO_PARTICIPANTS: Participant[] = [
  { id: "jane", name: "Jane", provider: "claude", model: "claude-opus-4-6", color: "#6366f1" },
  { id: "cody", name: "Cody", provider: "claude", model: "gpt-5.3", color: "#f59e0b" },
  { id: "flint", name: "Flint", provider: "ollama", model: "gemini-3.1-pro", color: "#10b981" },
  { id: "jewel", name: "Jewel", provider: "claude", model: "glm-5", color: "#ec4899" },
];

const now = Date.now();

export const DEMO_MESSAGES: GroupMessage[] = [
  {
    id: "demo-0",
    role: "user",
    participantId: null,
    content: "We're losing 40% of users at the onboarding config screen. How should we fix this?",
    timestamp: now - 9000,
  },
  {
    id: "demo-1",
    role: "assistant",
    participantId: "jane",
    content: "The core problem is we're asking for setup before showing value. Users don't know *why* they need an API key yet. Flip the order — let them see the product working first, then ask for config when they actually need it.",
    timestamp: now - 8000,
  },
  {
    id: "demo-2",
    role: "assistant",
    participantId: "cody",
    content: "We can prove that with a zero-config starter task: detect `package.json` or `.git` on load, run a local project analysis. No API key needed, instant result. That alone should cut the drop-off significantly.",
    timestamp: now - 7000,
  },
  {
    id: "demo-3",
    role: "assistant",
    participantId: "flint",
    content: "Risk: if we defer config entirely, the *second* interaction fails when there's no provider configured. We'd just move the drop-off from step 1 to step 2. Need to handle that transition carefully.",
    timestamp: now - 6000,
  },
  {
    id: "demo-4",
    role: "assistant",
    participantId: "jewel",
    content: "Graduated fidelity solves this. First task is local-only and always succeeds. When they trigger something that needs an LLM, prompt for the key *inline* — right where they need it, not on a separate page. Context-sensitive setup.",
    timestamp: now - 5000,
  },
  {
    id: "demo-5",
    role: "assistant",
    participantId: "jane",
    content: "Exactly. Setup instructions are only useful at the moment you need them. Front-loading them is just anxiety. I'd also suggest we track `welcome_view → first_action → first_result` to measure the actual impact.",
    timestamp: now - 4000,
  },
  {
    id: "demo-6",
    role: "assistant",
    participantId: "cody",
    content: "Here's a concrete implementation plan:\n1. Add framework detection on page load\n2. Show \"Map this project\" as default starter task\n3. Run it client-side with zero dependencies\n4. Persist the result so they land in a live session, not a blank page",
    timestamp: now - 3000,
  },
  {
    id: "demo-7",
    role: "assistant",
    participantId: "flint",
    content: "One more thing — keep state from that first task. When they transition to the real workspace, they should land mid-session. Starting over after the demo kills momentum and trust.",
    timestamp: now - 2000,
  },
  {
    id: "demo-8",
    role: "assistant",
    participantId: "jewel",
    content: "Summary: land → see agents working → join with one click → first task runs instantly → setup happens only when needed. Every step earns the next. Shall I draft the implementation spec?",
    timestamp: now - 1000,
  },
];

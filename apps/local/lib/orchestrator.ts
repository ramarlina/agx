/**
 * Orchestrator - Engine selection and task routing
 * 
 * This module handles intelligent routing of tasks to the most
 * appropriate AI engine based on task characteristics.
 */

export type Engine = "claude" | "gemini" | "ollama" | "zai";

export interface EngineConfig {
  name: Engine;
  label: string;
  description: string;
  strengths: string[];
  maxTokens: number;
  available: boolean;
}

export const engines: Record<Engine, EngineConfig> = {
  claude: {
    name: "claude",
    label: "Claude",
    description: "Anthropic's Claude - excellent for complex reasoning and code",
    strengths: ["coding", "analysis", "long-form", "reasoning"],
    maxTokens: 200000,
    available: true,
  },
  gemini: {
    name: "gemini",
    label: "Gemini",
    description: "Google's Gemini - strong multimodal capabilities",
    strengths: ["multimodal", "research", "summarization"],
    maxTokens: 1000000,
    available: true,
  },
  ollama: {
    name: "ollama",
    label: "Ollama (Local)",
    description: "Local models via Ollama - private and fast",
    strengths: ["privacy", "speed", "offline"],
    maxTokens: 8000,
    available: false, // Requires local setup
  },
  zai: {
    name: "zai",
    label: "Z.AI",
    description: "Z.AI (Zhipu) - OpenAI-compatible endpoint for GLM models",
    strengths: ["coding", "reasoning", "chinese-language"],
    maxTokens: 128000,
    available: true,
  },
};

/**
 * Select the best engine for a given task based on keywords and characteristics
 */
export function selectEngine(taskDescription: string): Engine {
  const lower = taskDescription.toLowerCase();

  // Code-heavy tasks → Claude
  if (
    lower.includes("code") ||
    lower.includes("api") ||
    lower.includes("function") ||
    lower.includes("implement") ||
    lower.includes("debug") ||
    lower.includes("refactor")
  ) {
    return "claude";
  }

  // Research/summarization → Gemini
  if (
    lower.includes("research") ||
    lower.includes("summarize") ||
    lower.includes("analyze document") ||
    lower.includes("compare")
  ) {
    return "gemini";
  }

  // Default to Claude for general tasks
  return "claude";
}

/**
 * Get engine configuration
 */
export function getEngineConfig(engine: Engine): EngineConfig {
  return engines[engine];
}

/**
 * List all available engines
 */
export function listEngines(): EngineConfig[] {
  return Object.values(engines).filter((e) => e.available);
}

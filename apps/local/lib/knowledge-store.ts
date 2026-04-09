import { vaultStore, type VaultKnowledgeDraft, type VaultKnowledgeEntry, type VaultKnowledgeEvidence } from "./vault-store";

export type KnowledgeScope = "global" | "agent" | "repo" | "project";
export type KnowledgeSourceType = "reflection" | "thread_transition" | "task_completion" | "manual";
export type KnowledgeKind =
  | "outcome"
  | "decision"
  | "pattern"
  | "gotcha"
  | "preference"
  | "constraint"
  | "convention"
  | "lesson";

export interface KnowledgeEvidence extends VaultKnowledgeEvidence {}

export interface KnowledgeEntry extends VaultKnowledgeEntry {}

export interface KnowledgeDraft extends VaultKnowledgeDraft {}

export function listKnowledgeEntries(input: {
  scope: KnowledgeScope;
  subjectId: string;
  limit?: number;
}): KnowledgeEntry[] {
  return vaultStore.listKnowledgeEntries(input);
}

export function storeKnowledgeEntries(drafts: KnowledgeDraft[]): number {
  return vaultStore.storeKnowledgeEntries(drafts);
}

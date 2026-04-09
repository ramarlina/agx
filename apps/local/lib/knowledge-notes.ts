import { vaultStore, type VaultKnowledgeNote, type VaultKnowledgeNoteInput, type VaultKnowledgeScope } from "./vault-store";

export type KnowledgeNoteScope = VaultKnowledgeScope;

export interface KnowledgeNote extends VaultKnowledgeNote {}

export interface UpsertKnowledgeNoteInput extends VaultKnowledgeNoteInput {}

export function getKnowledgeNote(scope: KnowledgeNoteScope, subjectId: string): KnowledgeNote | null {
  return vaultStore.getKnowledgeNote(scope, subjectId);
}

export function upsertKnowledgeNote(input: UpsertKnowledgeNoteInput): { note: KnowledgeNote; changed: boolean } {
  return vaultStore.upsertKnowledgeNote(input);
}

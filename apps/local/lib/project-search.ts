export type ProjectSearchResultKind =
  | "objective"
  | "linear_issue"
  | "scheduled_task"
  | "team"
  | "agent"
  | "chat_thread"
  | "chat_message";

export interface ProjectSearchResult {
  id: string;
  kind: ProjectSearchResultKind;
  title: string;
  href: string;
  label: string;
  context?: string;
  description?: string;
}

export interface ProjectSearchSection {
  id: string;
  label: string;
  results: ProjectSearchResult[];
}

export interface ProjectSearchResponse {
  query: string;
  sections: ProjectSearchSection[];
  total: number;
}

"use client";

import { useState, useCallback, useMemo } from "react";
import type { Participant } from "@/lib/types";
import type { ProjectWithAgents } from "@/hooks/useProjects";

export type MentionMode = "sequential" | "parallel";

export interface MentionToken {
  /** Start position of the @ token in the text */
  startIndex: number;
  /** End position (cursor position) */
  endIndex: number;
  /** The query text after @ (or @@) */
  query: string;
  /** Whether this is @ (sequential) or @@ (parallel) */
  mode: MentionMode;
  /** Whether this is a @@ trigger */
  isParallel: boolean;
}

export interface MentionProject {
  id: string;
  name: string;
  slug: string;
}

export interface MentionLinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  url: string | null;
  assignee: string | null;
  updatedAt: string;
}

export type MentionItem =
  | { kind: "agent"; participant: Participant; group: string }
  | { kind: "project-group"; project: ProjectWithAgents; group: string }
  | { kind: "project"; project: MentionProject; group: string }
  | { kind: "ticket"; issue: MentionLinearIssue; group: string };

export type MentionSuggestion = MentionItem;

export interface UseMentionAutocompleteOptions {
  /** List of participants to filter */
  participants: Participant[];
  /** Projects with agent rosters (for @project-name mentions) */
  projectGroups?: ProjectWithAgents[];
  /** Mentionable projects */
  projects?: MentionProject[];
  /** Cached Linear tickets available for @ mentions */
  linearIssues?: MentionLinearIssue[];
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
}

export interface UseMentionAutocompleteReturn {
  /** Whether the autocomplete dropdown is open */
  isOpen: boolean;
  /** Current query string (without @ prefix) */
  query: string;
  /** Filtered suggestions matching the query */
  filteredSuggestions: MentionSuggestion[];
  /** Index of the currently highlighted suggestion */
  activeIndex: number;
  /** The current mention token being edited, if any */
  token: MentionToken | null;
  /** Whether IME composition is active (suppress autocomplete) */
  isComposing: boolean;

  /** Handle input change - call this from onChange */
  handleInput: (text: string, cursorPos: number) => void;
  /** Handle keydown - returns true if key was handled */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  /** Select a suggestion - returns the text replacement info */
  selectSuggestion: (suggestion: MentionSuggestion) => { text: string; startIndex: number; endIndex: number } | null;
  /** Close the dropdown */
  close: () => void;
  /** Mark composition start (call from onCompositionStart) */
  startComposition: () => void;
  /** Mark composition end (call from onCompositionEnd) */
  endComposition: (text: string, cursorPos: number) => void;
}

const MENTION_QUERY_PATTERN = /^[A-Za-z0-9_\-:]*$/;

/**
 * Detects if cursor is inside a mention token at a valid boundary.
 * Valid boundaries are: start of text, or preceded by whitespace.
 * Exported for testing.
 */
export function detectMentionToken(text: string, cursorPos: number): MentionToken | null {
  if (cursorPos < 0 || cursorPos > text.length) {
    return null;
  }

  // Find the start of the current token by scanning to the nearest whitespace.
  let tokenStart = cursorPos;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) {
    tokenStart--;
  }

  const tokenText = text.slice(tokenStart, cursorPos);
  if (!tokenText.startsWith("@")) {
    return null;
  }

  // Allow only @ or @@ prefixes.
  if (tokenText.startsWith("@@@")) {
    return null;
  }

  // @# is reserved for thread mentions — skip it here
  if (tokenText.startsWith("@#")) {
    return null;
  }

  const isParallel = tokenText.startsWith("@@");
  const atSymbolCount = isParallel ? 2 : 1;
  const query = tokenText.slice(atSymbolCount);

  // Stop autocomplete once non-mention characters are present.
  if (!MENTION_QUERY_PATTERN.test(query)) {
    return null;
  }

  const mode: MentionMode = isParallel ? "parallel" : "sequential";

  return {
    startIndex: tokenStart,
    endIndex: cursorPos,
    query: query.toLowerCase(),
    mode,
    isParallel,
  };
}

/**
 * Filters suggestions by query using case-insensitive prefix matching.
 * Sorts by best match then alphabetically by name/title.
 * Exported for testing.
 */
/** Virtual @all participant that addresses every agent */
export const ALL_PARTICIPANT: Participant = {
  id: "all",
  name: "All",
  provider: "claude" as Participant["provider"],
  model: null,
  color: "#6B7280",
};

function scoreMatch(name: string, id: string, lowerQuery: string): number | null {
  if (!lowerQuery) return 0;
  if (name.startsWith(lowerQuery)) return 3;
  if (id.startsWith(lowerQuery)) return 2;
  if (name.includes(lowerQuery)) return 1;
  return null;
}

export function filterSuggestions(
  participants: Participant[],
  query: string,
  maxSuggestions: number,
  projectGroups: ProjectWithAgents[] = [],
  projects: MentionProject[] = [],
  linearIssues: MentionLinearIssue[] = []
): MentionSuggestion[] {
  const lowerQuery = query.toLowerCase();
  const participantById = new Map(participants.map((p) => [p.id, p]));

  // Build set of agents that belong to a project
  const projectAgentIds = new Set<string>();
  for (const project of projectGroups) {
    for (const agent of project.agents) {
      projectAgentIds.add(agent.agent_id);
    }
  }

  const result: MentionSuggestion[] = [];

  // 1. @All always at the top
  const allScore = scoreMatch("all", "all", lowerQuery);
  if (allScore !== null) {
    result.push({ kind: "agent", participant: ALL_PARTICIPANT, group: "" });
  }

  // 2. For each project: show project header then its member agents
  for (const project of projectGroups) {
    const projectScore = scoreMatch(project.name.toLowerCase(), project.id.toLowerCase(), lowerQuery);

    // Gather matching members
    const matchingMembers: { participant: Participant; score: number }[] = [];
    for (const agent of project.agents) {
      const p = participantById.get(agent.agent_id);
      if (!p) continue;
      const s = scoreMatch(p.name.toLowerCase(), p.id.toLowerCase(), lowerQuery);
      if (s !== null) matchingMembers.push({ participant: p, score: s });
    }

    // Show project + members if the project name matches OR any member matches
    if (projectScore !== null || matchingMembers.length > 0) {
      if (projectScore !== null) {
        result.push({ kind: "project-group", project, group: project.name });
      }

      const membersToShow = projectScore !== null && lowerQuery
        ? project.agents
            .map((a) => participantById.get(a.agent_id))
            .filter((p): p is Participant => !!p)
            .map((p) => ({ participant: p, score: 0 }))
        : matchingMembers;

      membersToShow
        .sort((a, b) => a.participant.name.localeCompare(b.participant.name))
        .forEach(({ participant }) => {
          result.push({ kind: "agent", participant, group: project.name });
        });
    }
  }

  // 3. Projects (for @~project:slug scope mentions)
  for (const proj of projects) {
    const projectName = proj.name.toLowerCase();
    const projectSlug = proj.slug.toLowerCase();
    const score = scoreMatch(projectName, projectSlug, lowerQuery);
    if (score !== null) {
      result.push({ kind: "project", project: proj, group: "Projects" });
    }
  }

  // 4. Linear tickets (only once the user has started typing)
  if (lowerQuery) {
    linearIssues
      .map((issue) => ({
        issue,
        score: scoreIssueMatch(issue, lowerQuery),
      }))
      .filter((entry): entry is { issue: MentionLinearIssue; score: number } => entry.score !== null)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.issue.identifier.localeCompare(right.issue.identifier);
      })
      .forEach(({ issue }) => {
        result.push({ kind: "ticket", issue, group: "Tickets" });
      });
  }

  // 5. Ungrouped agents (not in any project)
  const ungrouped: { participant: Participant; score: number }[] = [];
  for (const p of participants) {
    if (projectAgentIds.has(p.id)) continue;
    const s = scoreMatch(p.name.toLowerCase(), p.id.toLowerCase(), lowerQuery);
    if (s !== null) ungrouped.push({ participant: p, score: s });
  }
  ungrouped
    .sort((a, b) => a.participant.name.localeCompare(b.participant.name))
    .forEach(({ participant }) => {
      result.push({ kind: "agent", participant, group: "" });
    });

  return result.slice(0, maxSuggestions);
}

export function useMentionAutocomplete({
  participants,
  projectGroups = [],
  projects = [],
  linearIssues = [],
  maxSuggestions = 6,
}: UseMentionAutocompleteOptions): UseMentionAutocompleteReturn {
  const [token, setToken] = useState<MentionToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  const isOpen = token !== null && !isComposing;
  const query = token?.query ?? "";

  const filteredSuggestions = useMemo(() => {
    return filterSuggestions(participants, query, maxSuggestions, projectGroups, projects, linearIssues);
  }, [participants, query, maxSuggestions, projectGroups, projects, linearIssues]);

  const updateTokenFromInput = useCallback((text: string, cursorPos: number) => {
    const newToken = detectMentionToken(text, cursorPos);

    setToken((prevToken) => {
      const changed =
        prevToken?.startIndex !== newToken?.startIndex ||
        prevToken?.isParallel !== newToken?.isParallel ||
        prevToken?.query !== newToken?.query;

      if (changed) {
        setActiveIndex(0);
      }

      return newToken;
    });
  }, []);

  const handleInput = useCallback((text: string, cursorPos: number) => {
    if (isComposing) {
      return;
    }

    updateTokenFromInput(text, cursorPos);
  }, [isComposing, updateTokenFromInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!isOpen || filteredSuggestions.length === 0) {
      return false;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
        return true;

      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
        return true;

      case "Enter":
      case "Tab":
        e.preventDefault();
        return true;

      case "Escape":
        e.preventDefault();
        setToken(null);
        return true;

      default:
        return false;
    }
  }, [isOpen, filteredSuggestions.length]);

  const selectSuggestion = useCallback(
    (suggestion: MentionSuggestion): { text: string; startIndex: number; endIndex: number } | null => {
      if (!token) {
        return null;
      }

      const name =
        suggestion.kind === "project-group"
          ? suggestion.project.name
          : suggestion.kind === "project"
            ? suggestion.project.name
            : suggestion.kind === "ticket"
              ? suggestion.issue.identifier
              : suggestion.participant.name;
      const atPrefix = token.isParallel ? "@@" : "@";
      const replacement = `${atPrefix}${name} `;

      return {
        text: replacement,
        startIndex: token.startIndex,
        endIndex: token.endIndex,
      };
    },
    [token]
  );

  const close = useCallback(() => {
    setToken(null);
    setActiveIndex(0);
  }, []);

  const startComposition = useCallback(() => {
    setIsComposing(true);
  }, []);

  const endComposition = useCallback((text: string, cursorPos: number) => {
    setIsComposing(false);
    updateTokenFromInput(text, cursorPos);
  }, [updateTokenFromInput]);

  return {
    isOpen,
    query,
    filteredSuggestions,
    activeIndex,
    token,
    isComposing,
    handleInput,
    handleKeyDown,
    selectSuggestion,
    close,
    startComposition,
    endComposition,
  };
}

function scoreIssueMatch(issue: MentionLinearIssue, lowerQuery: string): number | null {
  const identifier = issue.identifier.toLowerCase();
  const title = issue.title.toLowerCase();

  if (identifier === lowerQuery) return 5;
  if (identifier.startsWith(lowerQuery)) return 4;
  if (title.startsWith(lowerQuery)) return 3;
  if (identifier.includes(lowerQuery)) return 2;
  if (title.includes(lowerQuery)) return 1;
  return null;
}

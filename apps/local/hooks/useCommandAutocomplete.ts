"use client";

import { useState, useCallback, useMemo } from "react";

export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  execute: () => void;
}

export interface CommandToken {
  startIndex: number;
  endIndex: number;
  query: string;
}

export interface UseCommandAutocompleteOptions {
  commands: SlashCommand[];
  maxSuggestions?: number;
}

export interface UseCommandAutocompleteReturn {
  isOpen: boolean;
  query: string;
  filteredCommands: SlashCommand[];
  activeIndex: number;
  token: CommandToken | null;

  handleInput: (text: string, cursorPos: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectCommand: (command: SlashCommand) => boolean;
  close: () => void;
}

const COMMAND_QUERY_PATTERN = /^[a-zA-Z0-9_-]*$/;

/**
 * Detects if cursor is inside a slash command token.
 * Only triggers at the start of input (after trim) — slash commands
 * must be the sole content.
 */
export function detectCommandToken(text: string, cursorPos: number): CommandToken | null {
  if (cursorPos < 0 || cursorPos > text.length) return null;

  // Only trigger when `/` is at position 0 (beginning of input)
  if (!text.startsWith("/")) return null;

  // Only match if the entire text so far is just the command (no spaces yet)
  const textUpToCursor = text.slice(0, cursorPos);
  if (/\s/.test(textUpToCursor)) return null;

  const query = textUpToCursor.slice(1);
  if (!COMMAND_QUERY_PATTERN.test(query)) return null;

  return {
    startIndex: 0,
    endIndex: cursorPos,
    query: query.toLowerCase(),
  };
}

export function filterCommands(
  commands: SlashCommand[],
  query: string,
  maxSuggestions: number
): SlashCommand[] {
  const lowerQuery = query.toLowerCase();

  if (!lowerQuery) return commands.slice(0, maxSuggestions);

  return commands
    .filter((cmd) => {
      if (cmd.name.slice(1).toLowerCase().startsWith(lowerQuery)) return true;
      return cmd.aliases?.some((a) => a.toLowerCase().startsWith(lowerQuery)) ?? false;
    })
    .slice(0, maxSuggestions);
}

export function useCommandAutocomplete({
  commands,
  maxSuggestions = 6,
}: UseCommandAutocompleteOptions): UseCommandAutocompleteReturn {
  const [token, setToken] = useState<CommandToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const isOpen = token !== null;
  const query = token?.query ?? "";

  const filteredCommands = useMemo(
    () => filterCommands(commands, query, maxSuggestions),
    [commands, query, maxSuggestions]
  );

  const handleInput = useCallback(
    (text: string, cursorPos: number) => {
      const newToken = detectCommandToken(text, cursorPos);
      setToken((prev) => {
        if (prev?.query !== newToken?.query) setActiveIndex(0);
        return newToken;
      });
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || filteredCommands.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          );
          return true;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
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
    },
    [isOpen, filteredCommands.length]
  );

  const selectCommand = useCallback(
    (command: SlashCommand): boolean => {
      if (!token) return false;
      command.execute();
      setToken(null);
      setActiveIndex(0);
      return true;
    },
    [token]
  );

  const close = useCallback(() => {
    setToken(null);
    setActiveIndex(0);
  }, []);

  return {
    isOpen,
    query,
    filteredCommands,
    activeIndex,
    token,
    handleInput,
    handleKeyDown,
    selectCommand,
    close,
  };
}

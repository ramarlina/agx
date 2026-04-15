"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  useMentionAutocomplete,
  type MentionLinearIssue,
  type MentionProject,
  type MentionSuggestion,
} from "@/hooks/useMentionAutocomplete";
import { useCommandAutocomplete, type SlashCommand } from "@/hooks/useCommandAutocomplete";
import { useAttachments, type Attachment } from "@/hooks/useAttachments";
import { useFileMention } from "@/hooks/useFileMention";
import { useThreadMention, type Discussion } from "@/hooks/useThreadMention";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useComposerHistory } from "@/hooks/useComposerHistory";
import { useLinearIssueMentions } from "@/hooks/useLinearIssueMentions";
import { buildAgentContext } from "@/lib/chat/agentContextBuilder";
import {
  buildLinearIssueContextPrefix,
  extractMentionedLinearIssueIds,
} from "@/lib/chat/linear-issue-context";
import {
  extractComposerRouting,
  type ComposerRoutingMetadata,
} from "@/lib/chat/composer-routing";
import {
  clipboardMayContainImageAttachments,
  getClipboardAttachmentFiles,
  readClipboardAttachmentFiles,
} from "@/lib/chat/paste-attachments";
import type { ThreadRef } from "@/lib/thread-export";
import {
  ParticipantMention,
  ProjectMention,
  FileMention,
  ThreadMention,
  LinearIssueMention,
} from "@/lib/tiptap/composer-mentions";
import { serializeToPlainText } from "@/lib/tiptap/serialize-composer";
import { getCurrentParagraphText, plainTextRangeToPos } from "@/lib/tiptap/editor-utils";
import { MentionPopover } from "./MentionPopover";
import { CommandPopover } from "./CommandPopover";
import { FileMentionPopover } from "./FileMentionPopover";
import { ThreadMentionPopover } from "./ThreadMentionPopover";
import { AttachmentTray } from "./AttachmentTray";
import { ComposerDropZone } from "./ComposerDropZone";
import type { Participant, GroupMessage } from "@/lib/types";
import type { ProjectWithAgents, ProjectRepo } from "@/hooks/useProjects";
import { Paperclip, Rocket, FolderGit2, ChevronDown, X } from "lucide-react";

import "@/styles/composer-pills.css";

const MENTION_LISTBOX_ID = "composer-mention-listbox";
const MENTION_OPTION_ID_PREFIX = "composer-mention-option";
const COMMAND_LISTBOX_ID = "composer-command-listbox";
const COMMAND_OPTION_ID_PREFIX = "composer-command-option";
const FILE_MENTION_LISTBOX_ID = "composer-file-mention-listbox";
const FILE_MENTION_OPTION_ID_PREFIX = "composer-file-mention-option";
const THREAD_MENTION_LISTBOX_ID = "composer-thread-mention-listbox";
const THREAD_MENTION_OPTION_ID_PREFIX = "composer-thread-mention-option";

interface Props {
  onSend: (
    message: string,
    maxRounds: number,
    attachmentIds?: string[],
    attachments?: Attachment[],
    pinnedParticipantId?: string,
    promptPrefix?: string,
    routing?: ComposerRoutingMetadata
  ) => void;
  onStop: () => void;
  loading: boolean;
  activityStatus?: "ready" | "queued" | "working";
  sendInterruptsBusy?: boolean;
  /** Whether autonomous mode is currently active */
  autoMode?: boolean;
  /** Called when user toggles autonomous mode */
  onAutoModeChange?: (enabled: boolean) => void;
  participants: Participant[];
  projects?: MentionProject[];
  /** Projects with agent rosters */
  projectGroups?: ProjectWithAgents[];
  /** Active project id, used for scoping Linear issue pulls to the project's Linear token */
  projectId?: string;
  /** Active project slug, used for scoping cached Linear issue pulls */
  projectSlug?: string;
  /** All messages in the current thread — used for @# discussion mentions */
  messages?: GroupMessage[];
  commands: SlashCommand[];
  placeholder?: string;
  /** Workspace roots currently configured by the user */
  workspaceRoots?: string[];
  /** Called when user clicks "Configure roots" from the inline prompt */
  onConfigureRoots?: () => void;
  /** Pending thread insert from "Add to chat" button */
  pendingThreadInsert?: { title: string; threadId: string; messages: GroupMessage[] } | null;
  /** Clear the pending thread insert after processing */
  onClearPendingThread?: () => void;
  /** Repos from the active project, available for scoping */
  repos?: ProjectRepo[];
  /** Controlled selected repo IDs (persisted per thread) */
  selectedRepoIds?: Set<string>;
  /** Called when repo selection changes */
  onRepoSelectionChange?: (next: Set<string>) => void;
  /** Pre-pin a participant when the composer mounts */
  initialPinnedParticipantId?: string;
}

/**
 * Replace a plain-text range in the current paragraph with a Tiptap node or text.
 * Used by all mention selection handlers.
 */
function replaceRangeWithNode(
  editor: ReturnType<typeof useEditor>,
  blockStart: number,
  startIndex: number,
  endIndex: number,
  content: any // Tiptap JSONContent or text string
) {
  if (!editor) return;
  const range = plainTextRangeToPos(editor, blockStart, startIndex, endIndex);
  if (!range) return;
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent(content)
    .insertContent(" ")
    .run();
}

export function Composer({
  onSend,
  onStop,
  loading,
  activityStatus,
  sendInterruptsBusy = false,
  participants,
  projects = [],
  projectGroups = [],
  projectId,
  projectSlug,
  messages: allMessages = [],
  commands,
  placeholder = "Message — @name to mention, /search, /summarize",
  workspaceRoots = [],
  onConfigureRoots,
  pendingThreadInsert,
  onClearPendingThread,
  autoMode = false,
  onAutoModeChange,
  repos = [],
  selectedRepoIds: controlledSelectedRepoIds,
  onRepoSelectionChange,
  initialPinnedParticipantId,
}: Props) {
  const effectiveActivityStatus =
    activityStatus ?? (loading ? "working" : "ready");
  const isBusy = effectiveActivityStatus !== "ready";

  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(initialPinnedParticipantId ?? null);
  const [internalSelectedRepoIds, setInternalSelectedRepoIds] = useState<Set<string>>(new Set());
  const selectedRepoIds = controlledSelectedRepoIds ?? internalSelectedRepoIds;
  const selectedRepoIdsRef = useRef(selectedRepoIds);
  selectedRepoIdsRef.current = selectedRepoIds;
  const setSelectedRepoIds = useCallback(
    (update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof update === "function" ? update(selectedRepoIdsRef.current) : update;
      if (onRepoSelectionChange) {
        onRepoSelectionChange(next);
      } else {
        setInternalSelectedRepoIds(next);
      }
    },
    [onRepoSelectionChange]
  );
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const repoDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const stageFilesRef = useRef<(files: FileList | File[]) => void>(() => {});

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const [threadRefs, setThreadRefs] = useState<ThreadRef[]>([]);
  const { issues: cachedLinearIssues } = useLinearIssueMentions({
    projectId: projectId ?? "",
    projectSlug,
    enabled: Boolean(projectId),
  });
  const linearIssues = cachedLinearIssues as MentionLinearIssue[];

  const mention = useMentionAutocomplete({
    participants,
    projectGroups,
    projects,
    linearIssues,
    maxSuggestions: 8,
  });
  const command = useCommandAutocomplete({ commands, maxSuggestions: 6 });
  const fileMention = useFileMention({ maxSuggestions: 8 });
  const threadMention = useThreadMention({ messages: allMessages, maxSuggestions: 8 });
  const attachments = useAttachments();
  stageFilesRef.current = attachments.stageFiles;
  const fileAttachments = useComposerAttachments();
  const composerHistory = useComposerHistory();

  useEffect(() => {
    if (pinnedParticipantId && !participants.some((participant) => participant.id === pinnedParticipantId)) {
      setPinnedParticipantId(null);
    }
  }, [participants, pinnedParticipantId]);

  // Close repo dropdown on click outside
  useEffect(() => {
    if (!repoDropdownOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, [repoDropdownOpen]);

  // Clear stale repo selections when available repos change (uncontrolled mode only).
  // In controlled mode, the parent (ChatContainer) owns the state and handles cleanup.
  useEffect(() => {
    if (controlledSelectedRepoIds != null) return; // skip in controlled mode
    if (internalSelectedRepoIds.size === 0) return;
    const validIds = new Set(repos.map((r) => r.id));
    const filtered = new Set([...internalSelectedRepoIds].filter((id) => validIds.has(id)));
    if (filtered.size < internalSelectedRepoIds.size) {
      setInternalSelectedRepoIds(filtered);
    }
  }, [repos, controlledSelectedRepoIds, internalSelectedRepoIds]);

  // ─── Tiptap editor ─────────────────────────────────────────────────────────

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: {
          keepMarks: false,
        },
      }),
      Placeholder.configure({ placeholder }),
      ParticipantMention,
      ProjectMention,
      FileMention,
      ThreadMention,
      LinearIssueMention,
    ],
    editorProps: {
      attributes: {
        class: "composer-editor",
        role: "combobox",
        "aria-autocomplete": "list",
      },
      handleDOMEvents: {
        compositionstart: () => {
          isComposingRef.current = true;
          mention.startComposition();
          return false;
        },
        compositionend: (_view, event) => {
          isComposingRef.current = false;
          // Re-extract text after composition ends
          setTimeout(() => {
            if (!editor) return;
            const info = getCurrentParagraphText(editor);
            if (info) {
              mention.endComposition(info.text, info.cursorPos);
            }
          }, 0);
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const files = getClipboardAttachmentFiles(event.clipboardData);
        if (files.length > 0) {
          stageFilesRef.current(files);
          return true;
        }
        if (clipboardMayContainImageAttachments(event.clipboardData)) {
          const clipboardReader = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
          if (typeof clipboardReader?.read === "function") {
            void readClipboardAttachmentFiles(event.clipboardData, clipboardReader)
              .then((attachmentFiles) => {
                if (attachmentFiles.length > 0) {
                  stageFilesRef.current(attachmentFiles);
                }
              })
              .catch((error) => {
                console.error("Failed to read pasted clipboard attachments:", error);
              });
            return true;
          }
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        // Tab or Enter selects the active autocomplete item
        if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
          if (command.isOpen && command.filteredCommands.length > 0) {
            event.preventDefault();
            const active = command.filteredCommands[command.activeIndex];
            if (active) applyCommandSelection(active);
            return true;
          }
          if (fileMention.isOpen && fileMention.suggestions.length > 0) {
            event.preventDefault();
            const active = fileMention.suggestions[fileMention.activeIndex];
            if (active) {
              if (active.type === "folder") {
                applyFileDrillDown(active);
              } else {
                applyFileSelection(active);
              }
            }
            return true;
          }
          if (threadMention.isOpen && threadMention.suggestions.length > 0) {
            event.preventDefault();
            const active = threadMention.suggestions[threadMention.activeIndex];
            if (active) applyThreadSelection(active);
            return true;
          }
          if (mention.isOpen && mention.filteredSuggestions.length > 0) {
            event.preventDefault();
            const active = mention.filteredSuggestions[mention.activeIndex];
            if (active) applyMentionSelection(active);
            return true;
          }
        }

        // Arrow keys / Escape delegated to hooks
        const syntheticEvent = { key: event.key, preventDefault: () => event.preventDefault() } as React.KeyboardEvent;
        if (command.isOpen && command.handleKeyDown(syntheticEvent)) return true;
        if (fileMention.isOpen && fileMention.handleKeyDown(syntheticEvent)) return true;
        if (threadMention.isOpen && threadMention.handleKeyDown(syntheticEvent)) return true;
        if (mention.handleKeyDown(syntheticEvent)) return true;

        // ArrowUp/ArrowDown for composer history navigation
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !mention.isOpen &&
          !command.isOpen &&
          !fileMention.isOpen &&
          !threadMention.isOpen
        ) {
          const currentText = serializeToPlainText(editor!.getJSON()).trim();
          const { state } = editor!.view;
          const isUp = event.key === "ArrowUp";
          // Only activate when cursor is at the boundary (start for up, end for down)
          const cursorAtBoundary = isUp
            ? state.selection.from <= 1
            : state.selection.to >= state.doc.content.size - 1;

          const result = composerHistory.navigate(
            isUp ? "up" : "down",
            currentText,
            cursorAtBoundary
          );
          if (result !== null) {
            event.preventDefault();
            editor!.commands.setContent(result);
            // Move cursor to end
            editor!.commands.focus("end");
            return true;
          }
        }

        // Enter to send
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleSubmit();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isComposingRef.current) return;
      // Reset history navigation when user types new content
      if (composerHistory.historyIndex !== -1) {
        composerHistory.resetNavigation();
      }
      const info = getCurrentParagraphText(ed);
      if (!info) return;
      mention.handleInput(info.text, info.cursorPos);
      command.handleInput(info.text, info.cursorPos);
      fileMention.handleInput(info.text, info.cursorPos);
      threadMention.handleInput(info.text, info.cursorPos);
    },
    onBlur: () => {
      mention.close();
      command.close();
      fileMention.close();
      threadMention.close();
    },
  });

  // ─── Handle "Add to chat" button insertions ────────────────────────────────

  useEffect(() => {
    if (!pendingThreadInsert || !editor) return;

    const { title, threadId, messages: discMsgs } = pendingThreadInsert;

    editor
      .chain()
      .focus()
      .insertContent({
        type: "threadMention",
        attrs: { threadId, title },
      })
      .insertContent(" ")
      .run();

    const rootMessage = discMsgs[0];
    if (rootMessage) {
      const discussion: Discussion = {
        rootMessageId: threadId,
        title,
        rootMessage,
        replies: discMsgs.slice(1),
        participantIds: [...new Set(discMsgs.map((m) => m.participantId || "user"))],
        lastActivityAt: Math.max(...discMsgs.map((m) => m.timestamp)),
      };
      threadMention.exportDiscussion(discussion)
        .then((ref) => setThreadRefs((prev) => [...prev, ref]))
        .catch((err) => console.error("Failed to export discussion for Add to chat:", err));
    }

    onClearPendingThread?.();
  }, [pendingThreadInsert]);

  // ─── Refresh mention state on click/selection ──────────────────────────────

  const refreshMentionState = useCallback(() => {
    if (!editor) return;
    const info = getCurrentParagraphText(editor);
    if (info) {
      mention.handleInput(info.text, info.cursorPos);
    }
  }, [editor, mention]);

  // Image paste is handled by ProseMirror's handlePaste in the editor config above,
  // using stageFilesRef for fresh closure access.

  // ─── Selection handlers ────────────────────────────────────────────────────

  const applyMentionSelection = useCallback((suggestion: MentionSuggestion) => {
    if (!editor) return;
    const replacement = mention.selectSuggestion(suggestion);
    if (!replacement) return;

    const info = getCurrentParagraphText(editor);
    if (!info) return;

    const isParallel = replacement.text.startsWith("@@");

    const content =
      suggestion.kind === "project-group"
        ? {
            type: "participantMention",
            attrs: {
              id: suggestion.project.id,
              name: suggestion.project.name,
              mode: isParallel ? "parallel" : "sequential",
              kind: "project",
            },
          }
        : suggestion.kind === "project"
          ? {
              type: "projectMention",
              attrs: {
                id: suggestion.project.id,
                slug: suggestion.project.slug,
                name: suggestion.project.name,
              },
            }
          : suggestion.kind === "ticket"
            ? {
                type: "linearIssueMention",
                attrs: {
                  id: suggestion.issue.id,
                  identifier: suggestion.issue.identifier,
                  title: suggestion.issue.title,
                  status: suggestion.issue.status,
                  url: suggestion.issue.url,
                },
              }
          : {
              type: "participantMention",
              attrs: {
                id: suggestion.participant.id,
                name: suggestion.participant.name,
                mode: isParallel ? "parallel" : "sequential",
                kind: "agent",
              },
            };

    replaceRangeWithNode(editor, info.blockStart, replacement.startIndex, replacement.endIndex, content);
    mention.close();
  }, [editor, mention]);

  const applyFileSelection = useCallback((suggestion: any) => {
    if (!editor) return;
    const replacement = fileMention.selectSuggestion(suggestion);
    if (!replacement) return;

    const info = getCurrentParagraphText(editor);
    if (!info) return;

    const content = {
      type: "fileMention",
      attrs: {
        path: suggestion.path,
        relativePath: suggestion.relativePath ?? suggestion.path,
        trigger: fileMention.token?.trigger ?? "@/",
        attachMode: suggestion.attachMode,
      },
    };

    replaceRangeWithNode(editor, info.blockStart, replacement.startIndex, replacement.endIndex, content);

    fileAttachments.addFilePath(
      suggestion.path,
      suggestion.relativePath ?? suggestion.path,
      suggestion.attachMode
    );
  }, [editor, fileMention, fileAttachments]);

  const applyFileDrillDown = useCallback((suggestion: any) => {
    if (!editor) return;
    const info = getCurrentParagraphText(editor);
    if (!info) return;

    const replacement = fileMention.drillDown(suggestion);
    if (!replacement) return;

    const range = plainTextRangeToPos(editor, info.blockStart, replacement.startIndex, replacement.endIndex);
    if (!range) return;

    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent(replacement.text)
      .run();
  }, [editor, fileMention]);

  const applyThreadSelection = useCallback(async (discussion: Discussion) => {
    if (!editor) return;
    const replacement = threadMention.selectSuggestion(discussion);
    if (!replacement) return;

    const info = getCurrentParagraphText(editor);
    if (!info) return;

    const content = {
      type: "threadMention",
      attrs: {
        threadId: discussion.rootMessageId,
        title: discussion.title,
      },
    };

    replaceRangeWithNode(editor, info.blockStart, replacement.startIndex, replacement.endIndex, content);

    try {
      const ref = await threadMention.exportDiscussion(discussion);
      setThreadRefs((prev) => [...prev, ref]);
    } catch (err) {
      console.error("Failed to export discussion:", err);
    }
  }, [editor, threadMention]);

  const applyCommandSelection = useCallback((cmd: SlashCommand) => {
    command.selectCommand(cmd);
    if (editor) {
      editor.commands.clearContent();
    }
  }, [command, editor]);

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!editor) return;

    const doc = editor.getJSON();
    const plainText = serializeToPlainText(doc);
    const trimmed = plainText.trim();

    if (!trimmed && !attachments.hasUploaded && !fileAttachments.hasFilePaths) return;
    if (!attachments.canSend) return;

    // Check for exact slash command match on submit
    if (trimmed) {
      const matchedCommand = commands.find(
        (c) => c.name === trimmed || c.aliases?.some((a) => `/${a}` === trimmed)
      );
      if (matchedCommand) {
        matchedCommand.execute();
        editor.commands.clearContent();
        command.close();
        mention.close();
        return;
      }
    }

    let messageText = trimmed || "(attached files)";

    // Build prompt prefix — context injected into the API prompt but NOT shown in the chat thread
    const prefixParts: string[] = [];

    // Inject focused repos context
    if (selectedRepoIds.size > 0) {
      const selectedRepos = repos.filter((r) => selectedRepoIds.has(r.id));
      if (selectedRepos.length > 0) {
        const repoLines = selectedRepos
          .map((r) => {
            const parts = [r.name];
            if (r.path) parts.push(`path: ${r.path}`);
            if (r.notes) parts.push(r.notes);
            return `- ${parts.join(" | ")}`;
          })
          .join("\n");
        prefixParts.push(`Focused repos (the user is specifically talking about these repositories):\n${repoLines}`);
      }
    }

    // Inject thread references
    if (threadRefs.length > 0) {
      const threadContext = threadRefs
        .map((ref) => `- "${ref.title}" — ${ref.summary} (full transcript: ${ref.filePath})`)
        .join("\n");
      prefixParts.push(`Referenced threads:\n${threadContext}`);
    }

    if (fileAttachments.hasFilePaths) {
      const ctx = await buildAgentContext(fileAttachments.filePaths);
      if (ctx.contextPrefix) {
        prefixParts.push(ctx.contextPrefix.trimEnd());
      }
    }

    const mentionedLinearIssueIds = extractMentionedLinearIssueIds(doc);
    if (mentionedLinearIssueIds.length > 0) {
      try {
        const response = await fetch("/api/linear/issues/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueIds: mentionedLinearIssueIds }),
        });
        if (!response.ok) {
          throw new Error(`Failed to load issue context: ${response.status}`);
        }
        const data = await response.json().catch(() => ({}));
        const issues = Array.isArray(data.issues) ? data.issues : [];
        const issueContext = buildLinearIssueContextPrefix(issues);
        if (issueContext) {
          prefixParts.push(issueContext.trimEnd());
        }
      } catch (error) {
        console.error("Failed to load Linear issue mention context:", error);
      }
    }

    const promptPrefix = prefixParts.length > 0 ? prefixParts.join("\n\n") + "\n\n" : undefined;
    const routing = extractComposerRouting(doc, pinnedParticipantId);

    // Save to composer history before sending
    if (trimmed) composerHistory.pushEntry(trimmed);

    const ids = attachments.attachmentIds.length > 0 ? attachments.attachmentIds : undefined;
    const metas = ids ? attachments.getAttachmentMetas() : undefined;
    onSend(
      messageText,
      10,
      ids,
      metas,
      pinnedParticipantId ?? undefined,
      promptPrefix,
      routing
    );

    editor.commands.clearContent();
    setThreadRefs([]);
    attachments.clear();
    fileAttachments.clearFilePaths();
    mention.close();
    command.close();
    threadMention.close();
  }, [editor, mention, command, commands, onSend, attachments, fileAttachments, threadRefs, threadMention, composerHistory, selectedRepoIds, repos, pinnedParticipantId]);

  // ─── ARIA helpers ──────────────────────────────────────────────────────────

  const mentionHasSuggestions = mention.isOpen && mention.filteredSuggestions.length > 0;
  const commandHasSuggestions = command.isOpen && command.filteredCommands.length > 0;
  const fileMentionHasSuggestions = fileMention.isOpen && fileMention.suggestions.length > 0;
  const threadMentionHasSuggestions = threadMention.isOpen && threadMention.suggestions.length > 0;

  const activeOption = mentionHasSuggestions
    ? mention.filteredSuggestions[mention.activeIndex]
    : null;

  const uploadsInProgress = attachments.staged.some((s) => s.status === "uploading");

  // Compute whether editor has content for disabled state
  const editorIsEmpty = !editor || editor.isEmpty;
  const pinnedParticipant = participants.find((participant) => participant.id === pinnedParticipantId) ?? null;

  return (
    <div className="pb-6">
      <div className="max-w-3xl mx-auto">
        <ComposerDropZone onDrop={attachments.stageFiles}>
          <div className="bg-[var(--app-shell-surface)] border border-[var(--app-shell-border)] shadow-[var(--shadow-sm)] focus-within:border-[var(--app-shell-border-strong)] focus-within:ring-1 focus-within:ring-[var(--ring)] transition-all flex flex-col rounded-2xl">
          {/* Ship Mode header */}
          {onAutoModeChange && (
            <div className={`relative overflow-hidden border-b transition-all duration-500 ${autoMode ? "border-orange-200/50 dark:border-orange-500/30" : "border-gray-100 dark:border-gray-800/60"}`}>
              {/* Animated gradient background when active */}
              <div
                className={`absolute inset-0 transition-opacity duration-700 ${autoMode ? "opacity-100" : "opacity-0"}`}
                style={{
                  background: "linear-gradient(120deg, var(--warning-muted) 0%, transparent 50%, var(--warning-muted) 100%)",
                  backgroundSize: "200% 100%",
                  animation: autoMode ? "shipBgSweep 4s ease-in-out infinite" : "none",
                }}
              />
              {/* Speed lines when active */}
              {autoMode && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute h-[1.5px] rounded-full"
                      style={{
                        top: `${12 + i * 10}%`,
                        right: "-10%",
                        width: `${20 + (i % 3) * 15}%`,
                        background: `linear-gradient(to left, transparent, var(--warning))`,
                        opacity: 0.3 + (i % 3) * 0.1,
                        animation: `shipSpeedLine ${0.8 + (i % 4) * 0.3}s ${i * 0.1}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="relative px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`p-1 rounded-md transition-all duration-300 ${autoMode ? "bg-[var(--warning)] text-[var(--warning-muted)] shadow-md" : "bg-[var(--app-shell-subtle)] text-[var(--app-shell-muted)]"}`}
                      style={autoMode ? { animation: "shipPulse 2s ease-in-out infinite" } : {}}
                    >
                      <Rocket size={14} />
                    </div>
                    <span className={`text-sm font-semibold transition-colors duration-300 ${autoMode ? "text-[var(--warning)]" : "text-[var(--foreground)]"}`}>Ship Mode</span>
                    <span className={`text-xs transition-colors duration-300 ${autoMode ? "text-[var(--warning)] opacity-60" : "text-[var(--app-shell-muted)] opacity-60"}`}>|</span>
                    <span className={`text-xs font-medium transition-colors duration-300 ${autoMode ? "text-[var(--warning)] opacity-80" : "text-[var(--app-shell-muted)]"}`}>
                      {autoMode
                        ? "Continuous execution is active for this thread"
                        : "Continuous execution stays off until you enable it"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAutoModeChange(!autoMode)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--warning)] focus:ring-offset-2 focus:ring-offset-[var(--background)] ${autoMode ? "bg-[var(--warning)]" : "bg-[var(--app-shell-border-strong)]"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-[var(--app-shell-elevated)] shadow-sm transition-transform duration-200 ${autoMode ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="p-1.5 transition-all">

            {attachments.staged.length > 0 && (
              <div className="mx-2 mt-2 mb-1">
                <AttachmentTray
                  attachments={attachments.staged}
                  onRemove={attachments.remove}
                  onRetry={attachments.retry}
                />
              </div>
            )}

            {/* Input Area */}
            <div className="p-2 relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    attachments.stageFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />

              <div className="flex-1 relative" onClick={refreshMentionState}>
                <EditorContent editor={editor} className="composer-editor" />
                <MentionPopover
                  isOpen={mention.isOpen && !command.isOpen}
                  suggestions={mention.filteredSuggestions}
                  activeIndex={mention.activeIndex}
                  listboxId={MENTION_LISTBOX_ID}
                  optionIdPrefix={MENTION_OPTION_ID_PREFIX}
                  onSelect={applyMentionSelection}
                />
                <CommandPopover
                  isOpen={command.isOpen}
                  commands={command.filteredCommands}
                  activeIndex={command.activeIndex}
                  listboxId={COMMAND_LISTBOX_ID}
                  optionIdPrefix={COMMAND_OPTION_ID_PREFIX}
                  onSelect={applyCommandSelection}
                />
                <FileMentionPopover
                  isOpen={fileMention.isOpen}
                  suggestions={fileMention.suggestions}
                  activeIndex={fileMention.activeIndex}
                  isLoading={fileMention.isLoading}
                  error={fileMention.error}
                  listboxId={FILE_MENTION_LISTBOX_ID}
                  optionIdPrefix={FILE_MENTION_OPTION_ID_PREFIX}
                  onSelect={(suggestion) => {
                    if (suggestion.type === "folder") {
                      applyFileDrillDown(suggestion);
                      return;
                    }
                    applyFileSelection(suggestion);
                  }}
                  onAttachContents={fileMention.onAttachContents}
                />
                <ThreadMentionPopover
                  isOpen={threadMention.isOpen && !command.isOpen && !fileMention.isOpen}
                  suggestions={threadMention.suggestions}
                  activeIndex={threadMention.activeIndex}
                  listboxId={THREAD_MENTION_LISTBOX_ID}
                  optionIdPrefix={THREAD_MENTION_OPTION_ID_PREFIX}
                  onSelect={applyThreadSelection}
                />
              </div>
            </div>

            {/* Bottom Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--app-shell-border)] transition-colors">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAttachClick}
                  className="p-1.5 text-[var(--app-shell-muted)] hover:text-[var(--foreground)] hover:bg-[var(--app-shell-subtle)] rounded-lg transition-colors"
                  aria-label="Attach file"
                  title="Attach file"
                >
                  <Paperclip className="h-4 w-4" strokeWidth={1.75} />
                </button>

                <div className="w-px h-4 bg-[var(--app-shell-border)]" />

                {/* Agent Selectors */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-[var(--app-shell-muted)] uppercase tracking-wider mr-1">Agents</span>
                  <div className="flex items-center -space-x-1.5">
                    {participants.length === 0 ? (
                      <span className="text-[10px] font-medium text-[var(--app-shell-muted)]">No agents</span>
                    ) : (
                      participants.map(p => (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={pinnedParticipantId === p.id}
                          onClick={() => setPinnedParticipantId((current) => current === p.id ? null : p.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setPinnedParticipantId((current) => current === p.id ? null : p.id);
                            }
                          }}
                          className={`relative w-6 h-6 rounded-full bg-[var(--app-shell-subtle)] border-2 border-[var(--app-shell-elevated)] shadow-sm flex items-center justify-center overflow-visible shrink-0 transition-all cursor-pointer ${
                            pinnedParticipantId === p.id
                              ? "-translate-y-0.5 ring-2 ring-[var(--ring)] ring-offset-1 ring-offset-[var(--background)]"
                              : "hover:-translate-y-0.5"
                          }`}
                          title={p.name}
                        >
                          <img
                            src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${p.id}&backgroundColor=${p.color ? p.color.replace('#', '') : 'e2e8f0'}`}
                            alt={p.name}
                            className="w-full h-full rounded-full object-cover"
                          />
                          {isBusy && (
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 border border-[var(--app-shell-elevated)] rounded-full ${
                                effectiveActivityStatus === "queued"
                                  ? "bg-amber-400"
                                  : "bg-emerald-400"
                              }`}
                            />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {pinnedParticipant && (
                  <>
                    <div className="w-px h-4 bg-[var(--app-shell-border)]" />
                    <span className="text-[10px] font-medium text-[var(--app-shell-muted)]">
                      Pinned: <span className="text-[var(--foreground)]">{pinnedParticipant.name}</span>
                    </span>
                  </>
                )}

                {/* Repo Select + Pills */}
                {repos.length > 0 && (
                  <>
                    <div className="w-px h-4 bg-[var(--app-shell-border)]" />
                    <div className="flex items-center gap-1.5">
                      {/* Dropdown trigger */}
                      <div className="relative" ref={repoDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setRepoDropdownOpen((v) => !v)}
                          className="composer-repo-select-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={repoDropdownOpen}
                        >
                          <FolderGit2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span>Folders</span>
                          <ChevronDown className={`h-3 w-3 transition-transform ${repoDropdownOpen ? "rotate-180" : ""}`} />
                        </button>
                        {repoDropdownOpen && (
                          <div className="composer-repo-dropdown" role="listbox" aria-multiselectable="true">
                            {repos.map((repo) => {
                              const isSelected = selectedRepoIds.has(repo.id);
                              return (
                                <button
                                  key={repo.id}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  className={`composer-repo-dropdown__item ${isSelected ? "composer-repo-dropdown__item--selected" : ""}`}
                                  onClick={() =>
                                    setSelectedRepoIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(repo.id)) {
                                        next.delete(repo.id);
                                      } else {
                                        next.add(repo.id);
                                      }
                                      return next;
                                    })
                                  }
                                >
                                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-emerald-500 border-emerald-500 text-white" : "border-[var(--app-shell-border-strong)]"}`}>
                                    {isSelected && (
                                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    )}
                                  </span>
                                  <span className="truncate">{repo.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {/* Selected repo pills (max 3 visible, then +N) */}
                      {(() => {
                        const selected = repos.filter((r) => selectedRepoIds.has(r.id));
                        const visible = selected.slice(0, 1);
                        const overflow = selected.length - 1;
                        return (
                          <>
                            {visible.map((repo) => (
                              <span
                                key={repo.id}
                                className="composer-repo-pill"
                                title={repo.path || repo.name}
                              >
                                <FolderGit2 className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                                <span className="composer-repo-pill__name">{repo.name}</span>
                                <button
                                  type="button"
                                  className="composer-repo-pill__remove"
                                  onClick={() =>
                                    setSelectedRepoIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(repo.id);
                                      return next;
                                    })
                                  }
                                  aria-label={`Remove ${repo.name}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                            {overflow > 0 && (
                              <span className="composer-repo-pill composer-repo-pill--overflow">
                                +{overflow}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>

              {/* Send / Stop Button */}
              {isBusy && !sendInterruptsBusy ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex items-center gap-2 bg-[var(--destructive-muted)] text-[var(--destructive)] border border-[var(--status-failed-border)] px-4 py-1.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={(editorIsEmpty && !attachments.hasUploaded && !fileAttachments.hasFilePaths) || uploadsInProgress}
                  className="flex items-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  Send
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
              )}
            </div>

          </div>
          </div>
        </ComposerDropZone>
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--app-shell-muted)] px-1">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                effectiveActivityStatus === "working"
                  ? "bg-emerald-400 animate-pulse"
                  : effectiveActivityStatus === "queued"
                    ? "bg-amber-400"
                    : "bg-emerald-400"
              }`}
            />
            <span>
              {effectiveActivityStatus === "working"
                ? "Working"
                : effectiveActivityStatus === "queued"
                  ? "Queued"
                  : "Ready"}
            </span>
          </div>
          <span>
            Press <kbd className="px-1 py-0.5 rounded bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] text-[var(--app-shell-muted)] shadow-sm text-[10px]">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] text-[var(--app-shell-muted)] shadow-sm text-[10px]">Shift</kbd> + <kbd className="px-1 py-0.5 rounded bg-[var(--app-shell-elevated)] border border-[var(--app-shell-border)] text-[var(--app-shell-muted)] shadow-sm text-[10px]">Enter</kbd> for new line
          </span>
        </div>
      </div>
    </div>
  );
}

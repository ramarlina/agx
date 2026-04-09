import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Participant mention pill — renders @Name (sequential) or @@Name (parallel).
 * Inline atom node: backspace deletes the whole pill.
 */
export const ParticipantMention = Node.create({
  name: "participantMention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: "" },
      mode: { default: "sequential" }, // "sequential" | "parallel"
      kind: { default: "agent" }, // "agent" | "team"
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-participant-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isParallel = node.attrs.mode === "parallel";
    const prefix = isParallel ? "@@" : "@";
    const cssClass = isParallel
      ? "composer-pill composer-pill--participant-parallel"
      : "composer-pill composer-pill--participant";

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-participant-mention": "",
        "data-id": node.attrs.id,
        "data-mode": node.attrs.mode,
        class: cssClass,
        contenteditable: "false",
      }),
      `${prefix}${node.attrs.name}`,
    ];
  },
});

/**
 * Project mention pill — renders @ProjectName.
 */
export const ProjectMention = Node.create({
  name: "projectMention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      slug: { default: "" },
      name: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-project-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-project-mention": "",
        "data-id": node.attrs.id,
        "data-slug": node.attrs.slug,
        class: "composer-pill composer-pill--project",
        contenteditable: "false",
      }),
      `@${node.attrs.name}`,
    ];
  },
});

/**
 * File mention pill — renders @/path or @~/path.
 */
export const FileMention = Node.create({
  name: "fileMention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      path: { default: "" },
      relativePath: { default: "" },
      trigger: { default: "@/" }, // "@/" | "@~"
      attachMode: { default: undefined }, // "manifest" | "contents" | undefined
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-file-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const display = node.attrs.relativePath || node.attrs.path;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-file-mention": "",
        "data-path": node.attrs.path,
        class: "composer-pill composer-pill--file",
        contenteditable: "false",
      }),
      `@${display}`,
    ];
  },
});

/**
 * Thread/discussion mention pill — renders #title.
 */
export const ThreadMention = Node.create({
  name: "threadMention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      threadId: { default: "" },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-thread-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-thread-mention": "",
        "data-thread-id": node.attrs.threadId,
        class: "composer-pill composer-pill--thread",
        contenteditable: "false",
      }),
      `#${node.attrs.title}`,
    ];
  },
});

/**
 * Linear issue mention pill — renders @ENG-123.
 */
export const LinearIssueMention = Node.create({
  name: "linearIssueMention",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      identifier: { default: "" },
      title: { default: "" },
      status: { default: "" },
      url: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-linear-issue-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-linear-issue-mention": "",
        "data-id": node.attrs.id,
        "data-identifier": node.attrs.identifier,
        class: "composer-pill composer-pill--linear-issue",
        contenteditable: "false",
      }),
      `@${node.attrs.identifier}`,
    ];
  },
});
